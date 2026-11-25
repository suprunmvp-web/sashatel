import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import pg from 'pg';
import { ApiError, ControlPlane, hashPassword } from './control.ts';
import { FakeAri } from './fake-ari.ts';
import { TrunkService } from './trunks.ts';
import { GlobalCarousel } from './global-carousel.ts';
import { createApi } from './http.ts';

const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_URL;
assert(runtimeUrl && adminUrl, 'Disposable migrated PostgreSQL with runtime and owner URLs required');
const pool = new pg.Pool({ connectionString: runtimeUrl });
const admin = new pg.Pool({ connectionString: adminUrl });
const control = new ControlPlane(pool, undefined, () => true);

async function fixture({ limit = 10, balance = 100, role = 'manager', number = '+74950001001' } = {}) {
  const [tenant, user, member, trunk, device] = Array.from({ length: 5 }, () => randomUUID());
  await admin.query("INSERT INTO control.organizations(id,active,max_calls,verification_status) VALUES ($1,true,$2,'verified')", [tenant,limit]);
  await admin.query('INSERT INTO control.users (id,login,password_hash) VALUES ($1,$1::uuid::text,$2)',
    [user,await hashPassword('test-password')]);
  await admin.query('INSERT INTO control.memberships VALUES ($1,$2,$3,$4,true)', [tenant,member,user,role]);
  await admin.query('INSERT INTO control.subscriptions VALUES ($1,true,true)', [tenant]);
  await admin.query("INSERT INTO control.wallets VALUES ($1,'minutes',$2,10)", [tenant,balance]);
  await admin.query('INSERT INTO control.trunks VALUES ($1,$2,true)', [tenant,trunk]);
  await admin.query('INSERT INTO control.phone_numbers VALUES ($1,$2,$3,true)', [tenant,number,trunk]);
  await admin.query("INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",[tenant,number,trunk]);
  const credentials = await control.login(tenant,user,'test-password',device);
  return { tenant, user, member, trunk, token: credentials.token, number };
}

function code(expected: string) {
  return (error: unknown) => error instanceof ApiError && error.code === expected;
}

test('Control Plane against PostgreSQL with a non-owner runtime', async t => {
  t.after(async () => { await Promise.all([pool.end(),admin.end()]); });
  const { rows: [role] } = await pool.query(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
  const destination = '+79260000000';

  await t.test('HTTP authorization, history, tenant IDOR and hangup', async () => {
    const a = await fixture({number:'+74950001002'});
    const b = await fixture({number:'+74950001003'});
    const api = createApi(control, () => pool.query('SELECT 1'));
    api.listen(0,'127.0.0.1');
    await once(api,'listening');
    try {
      const address = api.address();
      assert(address && typeof address !== 'string');
      const base = 'http://127.0.0.1:' + address.port;
      const headers = { authorization:'Bearer ' + a.token, 'content-type':'application/json', 'idempotency-key':'http' };
      const readOperator = async (token: string) => fetch(base + '/v1/operator/telephony',
        {headers:{authorization:'Bearer ' + token}});
      const status = await readOperator(a.token);
      assert.equal(status.status,200);
      assert.equal(status.headers.get('cache-control'),'no-store');
      const {observed_at_ms,...availability} = await status.json();
      assert.deepEqual(availability,{telephony_available:false,caller_id:null,can_call:false});
      assert((await (await readOperator(a.token)).json()).observed_at_ms > observed_at_ms);
      const adminActor = await fixture({role:'organization_admin'});
      assert.equal((await readOperator(adminActor.token)).status,403);
      const response = await fetch(base + '/v1/calls', { method:'POST', headers, body:JSON.stringify({destination}) });
      assert.equal(response.status,202);
      const { call_id } = await response.json();
      const foreign = await fetch(base + '/v1/calls/' + call_id, { headers:{ authorization:'Bearer ' + b.token } });
      assert.equal(foreign.status,404);
      const gateway = new FakeAri();
      await control.processOne(a.tenant,gateway);
      assert.equal((await control.calls(a.token,call_id)).state,'ringing');
      const stop = await fetch(base + '/v1/calls/' + call_id + '/hangup', { method:'POST',headers });
      assert.equal(stop.status,202);
      await control.processOne(a.tenant,gateway);
      assert.equal((await control.calls(a.token,call_id)).state,'ended');
      const visible = await control.transaction(b.tenant, db => db.query('SELECT id FROM calls WHERE id=$1',[call_id]));
      assert.equal(visible.rowCount,0);
      const unscoped = await pool.query('SELECT id FROM control.calls');
      assert.equal(unscoped.rowCount,0);
    } finally {
      await new Promise<void>(resolve => api.close(() => resolve()));
    }
  });

  await t.test('role, logout, organization suspension and replacement across tenants', async () => {
    const a = await fixture({role:'organization_admin'});
    await assert.rejects(control.authorize(a.token,'permission',destination),code('CALL_PERMISSION_REQUIRED'));
    const b = await fixture();
    await admin.query("UPDATE control.memberships SET user_id=$1 WHERE organization_id=$2 AND id=$3",[a.user,b.tenant,b.member]);
    const replacement = await control.login(b.tenant,a.user,'test-password',randomUUID());
    await assert.rejects(control.calls(a.token),code('INVALID_SESSION'));
    await control.logout(replacement.token);
    await assert.rejects(control.calls(replacement.token),code('INVALID_SESSION'));
    const next = await control.login(b.tenant,a.user,'test-password',randomUUID());
    await admin.query('UPDATE control.organizations SET active=false WHERE id=$1',[b.tenant]);
    await assert.rejects(control.authorize(next.token,'suspended',destination),code('ORGANIZATION_SUSPENDED'));
  });

  await t.test('organization verification gates admission and dispatch',async()=>{
    const a=await fixture({number:'+74950002987'});

    await admin.query(
      "UPDATE control.organizations SET verification_status='unverified' WHERE id=$1",
      [a.tenant]
    );

    await assert.rejects(
      control.authorize(a.token,'unverified',destination),
      code('ORGANIZATION_NOT_VERIFIED')
    );

    await assert.rejects(
      control.prepareCommercialCall(a.token,'unverified-prepare',destination),
      code('ORGANIZATION_NOT_VERIFIED')
    );

    await admin.query(
      "UPDATE control.organizations SET verification_status='verified' WHERE id=$1",
      [a.tenant]
    );

    const call=await control.authorize(a.token,'verified',destination);

    await admin.query(
      "UPDATE control.organizations SET verification_status='unverified' WHERE id=$1",
      [a.tenant]
    );

    const gateway=new FakeAri();

    await control.processOne(a.tenant,gateway);

    assert.equal(gateway.attempts.size,0);
    assert.equal((await control.calls(a.token,call.call_id)).state,'failed');

    const {rows:[quota]}=await admin.query(
      'SELECT held,used FROM control.physical_caller_day WHERE e164=$1',
      [a.number]
    );

    assert.deepEqual(quota,{held:0,used:0});
  });

  await t.test('unavailable worker cannot reserve or enqueue', async () => {
    const a = await fixture({number:'+74950001004'});
    const unavailable = new ControlPlane(pool);
    await assert.rejects(unavailable.authorize(a.token,'offline',destination),code('CALL_WORKER_UNAVAILABLE'));
    const {rows:[row]} = await admin.query(
      'SELECT available,(SELECT count(*) FROM control.outbox WHERE organization_id=$1) AS pending FROM control.wallets WHERE organization_id=$1',[a.tenant]);
    assert.deepEqual(row,{available:'100',pending:'0'});
  });

  await t.test('runtime cannot modify superseded prepaid wallet or legacy admission counter',async()=>{
    const a=await fixture({balance:100,number:'+74950002401'});
    await assert.rejects(control.transaction(a.tenant,db=>db.query(
      'UPDATE wallets SET available=0 WHERE organization_id=$1',[a.tenant])),
      /permission denied/);
    await assert.rejects(control.transaction(a.tenant,db=>db.query(
      'INSERT INTO number_attempts(e164,day,used) VALUES($1,CURRENT_DATE,1)',
      [a.number])),/permission denied/);
    await assert.rejects(control.transaction(a.tenant,db=>db.query(
      "INSERT INTO usage_ledger(organization_id,call_id,kind,units) VALUES($1,$2,'charge',3)",
      [a.tenant,randomUUID()])),/permission denied/);
  });

  await t.test('overdue postpaid invoices block only new calls and accept confirmed settlement',async()=>{
    const a=await fixture({balance:0,number:'+74950002400'});
    const invoice=randomUUID();
    await admin.query(
      "INSERT INTO control.billing_obligations(organization_id,id,issued_at,due_at,amount_kopeks,paid_kopeks,state) "+
      "VALUES($1,$2,clock_timestamp()-interval '14 days',clock_timestamp()-interval '1 day',500,0,'issued')",
      [a.tenant,invoice]);
    await assert.rejects(control.authorize(a.token,'unpaid',destination),code('PAYMENT_OVERDUE'));
    await admin.query('UPDATE control.billing_obligations SET paid_kopeks=250 WHERE id=$1',[invoice]);
    await assert.rejects(control.authorize(a.token,'partial',destination),code('PAYMENT_OVERDUE'));
    await admin.query('UPDATE control.billing_obligations SET paid_kopeks=500 WHERE id=$1',[invoice]);
    const accepted=await control.authorize(a.token,'settled',destination);
    // Becoming overdue after reservation invalidates a not-yet-committed
    // dispatch without disrupting any already connected conversation.
    await admin.query('UPDATE control.billing_obligations SET paid_kopeks=0 WHERE id=$1',[invoice]);
    const gateway=new FakeAri();
    await control.processOne(a.tenant,gateway);
    assert.equal(gateway.attempts.size,0);
    assert.equal((await control.calls(a.token,accepted.call_id)).state,'failed');
    const {rows:[quota]}=await admin.query(
      'SELECT held,used FROM control.physical_caller_day WHERE e164=$1',
      [a.number]);
    assert.deepEqual(quota,{held:0,used:0});
  });

  await t.test('default trunk is inherited and member override selects only assigned carrier', async () => {
    const a = await fixture({number:'+74950002001'});
    const [adminUser,adminMember,adminDevice]=Array.from({length:3},()=>randomUUID());
    await admin.query('INSERT INTO control.users(id,login,password_hash) VALUES($1,$1::uuid::text,$2)',
      [adminUser,await hashPassword('test-password')]);
    await admin.query("INSERT INTO control.memberships VALUES($1,$2,$3,'organization_admin',true)",
      [a.tenant,adminMember,adminUser]);
    const supervisor=await control.login(a.tenant,adminUser,'test-password',adminDevice);
    await assert.rejects(control.setDefaultTrunk(a.token,a.trunk),code('TRUNK_PERMISSION_REQUIRED'));
    const secondTrunk=randomUUID();
    const secondNumber='+74950002002';
    await admin.query('INSERT INTO control.trunks(organization_id,id,active) VALUES ($1,$2,true)',
      [a.tenant,secondTrunk]);
    await admin.query('INSERT INTO control.phone_numbers(organization_id,e164,trunk_id,active) VALUES ($1,$2,$3,true)',
      [a.tenant,secondNumber,secondTrunk]);
    await admin.query("INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",[a.tenant,secondNumber,secondTrunk]);

    // More than one eligible trunk without a declared route must fail closed.
    await assert.rejects(control.authorize(a.token,'ambiguous',destination),
      code('TRUNK_ASSIGNMENT_REQUIRED'));
    const {rows:[noDispatch]}=await admin.query(
      'SELECT count(*)::int AS n FROM control.calls WHERE organization_id=$1',[a.tenant]);
    assert.equal(noDispatch.n,0);

    const {rows:[first]}=await admin.query(
      'SELECT id FROM control.trunks WHERE organization_id=$1 AND id<>$2',
      [a.tenant,secondTrunk]);
    const otherTenant = await fixture({number:'+74950002003'});
    await assert.rejects(control.setDefaultTrunk(supervisor.token,otherTenant.trunk),
      code('TRUNK_NOT_READY'));
    await assert.rejects(control.setEmployeeTrunk(supervisor.token,otherTenant.member,secondTrunk),
      code('EMPLOYEE_NOT_FOUND'));
    await control.setDefaultTrunk(supervisor.token,first.id);
    const defaultCall=await control.authorize(a.token,'default-trunk',destination);
    let {rows:[saved]}=await admin.query('SELECT trunk_id,caller_id FROM control.calls WHERE id=$1',
      [defaultCall.call_id]);
    assert.deepEqual(saved,{trunk_id:first.id,caller_id:a.number});

    await control.setEmployeeTrunk(supervisor.token,a.member,secondTrunk);
    const overridden=await control.authorize(a.token,'override-trunk',destination);
    ({rows:[saved]}=await admin.query('SELECT trunk_id,caller_id FROM control.calls WHERE id=$1',
      [overridden.call_id]));
    assert.deepEqual(saved,{trunk_id:secondTrunk,caller_id:secondNumber});

    // REST contract enforces privileged routing updates and validated bodies.
    const api=createApi(control,()=>pool.query('SELECT 1'));
    api.listen(0,'127.0.0.1');
    await once(api,'listening');
    try {
      const address=api.address();
      assert(address&&typeof address!=='string');
      const origin='http://127.0.0.1:'+address.port;
      const headers={authorization:'Bearer '+supervisor.token,'content-type':'application/json'};
      const reset=await fetch(origin+'/v1/trunk-routing/members/'+a.member,
        {method:'PUT',headers,body:JSON.stringify({trunk_id:null})});
      assert.equal(reset.status,200);
      assert.equal((await reset.json()).trunk_override_id,null);
      const assign=await fetch(origin+'/v1/trunk-routing/members/'+a.member,
        {method:'PUT',headers,body:JSON.stringify({trunk_id:secondTrunk})});
      assert.equal(assign.status,200);
      const forbidden=await fetch(origin+'/v1/trunk-routing/default',
        {method:'PUT',headers:{...headers,authorization:'Bearer '+a.token},
          body:JSON.stringify({trunk_id:secondTrunk})});
      assert.equal(forbidden.status,403);
    } finally {
      await new Promise<void>(resolve=>api.close(()=>resolve()));
    }

    // No silent failover when the employee's explicitly assigned trunk goes down.
    await admin.query('UPDATE control.trunks SET active=false WHERE id=$1',[secondTrunk]);
    await assert.rejects(control.authorize(a.token,'no-failover',destination),
      code('NO_CALLER_ID'));
  });

  await t.test('commercial admission uses authenticated route, not prepaid balance or old attempts',async()=>{
    const a=await fixture({balance:0,limit:1,number:'+74950003990'});
    const b=await fixture({balance:0,number:'+74950003991'});
    const prepared=await control.prepareCommercialCall(a.token,'commercial-1',destination);
    assert.equal(prepared.state,'held');
    assert.equal(prepared.caller_id,a.number);
    assert.equal(prepared.trunk_id,a.trunk);
    assert.deepEqual(await control.prepareCommercialCall(a.token,'commercial-1',destination),prepared);
    await assert.rejects(control.prepareCommercialCall(a.token,'commercial-1','+79269990000'),
      code('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(control.prepareCommercialCall(a.token,'commercial-2',destination),
      code('CALL_CONCURRENCY_LIMIT'));
    const {rows:[wallet]}=await admin.query(
      'SELECT available FROM control.wallets WHERE organization_id=$1',[a.tenant]);
    assert.equal(wallet.available,'0');
    const {rows:[oldCounter]}=await admin.query(
      'SELECT count(*)::int AS count FROM control.number_attempts WHERE e164=$1',[a.number]);
    assert.equal(oldCounter.count,0);
    const {rows:[foreign]}=await control.transaction(b.tenant,db=>
      db.query('SELECT id FROM carousel_dispatches WHERE id=$1',[prepared.call_id]));
    assert.equal(foreign,undefined);
    await control.transaction(a.tenant,db=>new GlobalCarousel().finalize(db,{
      organizationId:a.tenant,dispatchId:prepared.call_id,action:'release'}));
    const retried=await control.prepareCommercialCall(a.token,'commercial-2',destination);
    assert.equal(retried.state,'held');
  });

  await t.test('expired uncommitted reservation releases physical quota without dispatch',async()=>{
    const a=await fixture({number:'+74950003992'});
    const carousel=new GlobalCarousel();
    const args={organizationId:a.tenant,membershipId:a.member,
      effectiveTrunkId:a.trunk,requestKey:'expires',destination};
    const first=await control.transaction(a.tenant,db=>carousel.reserve(db,args));
    await admin.query(
      "UPDATE control.carousel_dispatches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [first.id]);
    const second=await control.transaction(a.tenant,db=>carousel.reserve(db,{
      ...args,requestKey:'fresh'}));
    assert.equal(second.state,'held');
    assert.equal((await admin.query(
      'SELECT state FROM control.carousel_dispatches WHERE id=$1',[first.id])).rows[0].state,'released');
    const {rows:[quota]}=await admin.query(
      "SELECT held,used FROM control.physical_caller_day WHERE e164=$1 AND day=(clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date",
      [a.number]);
    assert.deepEqual(quota,{held:1,used:0});
    assert.equal((await admin.query(
      'SELECT COUNT(*)::int AS count FROM control.carousel_outbox WHERE organization_id=$1',
      [a.tenant])).rows[0].count,0);
  });

  await t.test('physical Caller ID quota is shared globally across tenants',async()=>{
    const number='+74950003999';
    const a=await fixture({number}),b=await fixture({number});
    for(const f of [a,b]) {
      await admin.query(
        "INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",
        [f.tenant,number,f.trunk]);
    }
    const carousel=new GlobalCarousel();
    const reserve=(f:typeof a,key:string)=>control.transaction(f.tenant,db=>
      carousel.reserve(db,{organizationId:f.tenant,membershipId:f.member,
        effectiveTrunkId:f.trunk,requestKey:key,destination}));
    const holds:Array<{id:string}>=[];
    for(let i=0;i<8;i++)holds.push(await reserve(i%2?a:b,'global-'+i));
    assert.equal((await admin.query(
      'SELECT held,used FROM control.physical_caller_day WHERE e164=$1 AND day=(clock_timestamp() AT TIME ZONE $2)::date',
      [number,'Europe/Moscow'])).rows[0].held,8);
    await assert.rejects(reserve(a,'global-ninth'),/NUMBER_LIMIT_REACHED/);

    // Two concurrent ninth-slot contenders: one and only one can win.
    await control.transaction(b.tenant,db=>carousel.finalize(db,{
      organizationId:b.tenant,dispatchId:holds[0].id,action:'release'}));
    const results=await Promise.allSettled([reserve(a,'race-a'),reserve(b,'race-b')]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);
    const final=await control.transaction(a.tenant,db=>carousel.finalize(db,{
      organizationId:a.tenant,dispatchId:holds[1].id,action:'commit'}));
    assert.equal(final,'committed');
    assert.equal(await control.transaction(a.tenant,db=>carousel.finalize(db,{
      organizationId:a.tenant,dispatchId:holds[1].id,action:'release'})),'committed');
    const {rows:[global]}=await admin.query(
      'SELECT held,used FROM control.physical_caller_day WHERE e164=$1 AND day=(clock_timestamp() AT TIME ZONE $2)::date',
      [number,'Europe/Moscow']);
    assert.equal(Number(global.held)+Number(global.used),8);
    assert.equal(global.used,1);
    const {rows:[dispatch]}=await admin.query(
      'SELECT attempt_id FROM control.carousel_dispatches WHERE id=$1',[holds[1].id]);
    const {rows:[outbox]}=await admin.query(
      'SELECT attempt_id,state FROM control.carousel_outbox WHERE dispatch_id=$1',[holds[1].id]);
    assert.equal(outbox.attempt_id,dispatch.attempt_id);
    assert.equal(outbox.state,'pending');
    await assert.rejects(control.transaction(a.tenant,db=>
      db.query('UPDATE physical_caller_day SET held=0 WHERE e164=$1',[number])),/permission denied/);
    await assert.rejects(control.transaction(b.tenant,db=>carousel.finalize(db,{
      organizationId:b.tenant,dispatchId:holds[1].id,action:'release'})),/UNKNOWN_DISPATCH/);
  });

  await t.test('fair global rotation, passive fencing and expired holds',async()=>{
    const first='+74950004001',second='+74950004002';
    const f=await fixture({number:first});
    await admin.query('INSERT INTO control.phone_numbers(organization_id,e164,trunk_id,active) VALUES($1,$2,$3,true)',
      [f.tenant,second,f.trunk]);
    for(const n of [first,second]){
      await admin.query(
        "INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",
        [f.tenant,n,f.trunk]);
    }
    const car=new GlobalCarousel();
    const alloc=(key:string)=>control.transaction(f.tenant,db=>car.reserve(db,{
      organizationId:f.tenant,membershipId:f.member,effectiveTrunkId:f.trunk,
      requestKey:key,destination,
    }));
    const a=await alloc('round-1');
    const b=await alloc('round-2');
    assert.equal(a.caller_id,first);
    assert.equal(b.caller_id,second);
    assert.equal((await alloc('round-1')).id,a.id);
    const {rows:[before]}=await admin.query(
      'SELECT count(*)::int AS n FROM control.physical_caller_day WHERE e164=$1',
      [first]);
    assert.equal(before.n,1);

    // A number deactivated before committed dispatch must not be originated.
    await admin.query(
      "UPDATE control.carousel_numbers SET status='passive' WHERE organization_id=$1 AND e164=$2",
      [f.tenant,first]);
    await assert.rejects(control.transaction(f.tenant,db=>car.finalize(db,{
      organizationId:f.tenant,dispatchId:a.id,action:'commit'})),/CALLER_NOT_APPROVED/);
    assert.equal(await control.transaction(f.tenant,db=>car.finalize(db,{
      organizationId:f.tenant,dispatchId:a.id,action:'release'})),'released');
    const {rows:[freed]}=await admin.query('SELECT held,used FROM control.physical_caller_day WHERE e164=$1',[first]);
    assert.deepEqual(freed,{held:0,used:0});

    // Uncommitted abandoned reservation is eventually reclaimed, not billed.
    await admin.query(
      "UPDATE control.carousel_dispatches SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [b.id]);
    assert.equal(await control.transaction(f.tenant,db=>car.expireForTenant(db,f.tenant)),1);
    assert.equal(await control.transaction(f.tenant,db=>car.expireForTenant(db,f.tenant)),0);
    const {rows:[clean]}=await admin.query('SELECT held,used FROM control.physical_caller_day WHERE e164=$1',[second]);
    assert.deepEqual(clean,{held:0,used:0});
    const {rows:[dispatch]}=await admin.query('SELECT state FROM control.carousel_dispatches WHERE id=$1',[b.id]);
    assert.equal(dispatch.state,'released');
  });

  await t.test('028: global LRU breaks equal-load ties across tenants',async()=>{
    const first='+74950004801',second='+74950004802';
    const a=await fixture({number:first});
    const b=await fixture({number:first});

    await admin.query(
      'INSERT INTO control.phone_numbers(organization_id,e164,trunk_id,active) VALUES($1,$2,$3,true)',
      [b.tenant,second,b.trunk]);

    for(const [f,n] of [[a,first],[b,first],[b,second]] as const){
      await admin.query(
        "INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",
        [f.tenant,n,f.trunk]);
    }

    const car=new GlobalCarousel();

    const reserve=(f:typeof a,key:string)=>control.transaction(
      f.tenant,db=>car.reserve(db,{
        organizationId:f.tenant,
        membershipId:f.member,
        effectiveTrunkId:f.trunk,
        requestKey:key,destination
      }));

    const initial=await reserve(a,'lru-first');

    await control.transaction(a.tenant,db=>car.finalize(db,{
      organizationId:a.tenant,
      dispatchId:initial.id,
      action:'commit'
    }));

    const history=await admin.query(
      'SELECT last_initiated_at FROM control.physical_caller_rotation WHERE e164=$1',
      [first]);

    assert.equal(history.rowCount,1);

    const older=await reserve(b,'lru-second');
    assert.equal(older.caller_id,second);

    await control.transaction(b.tenant,db=>car.finalize(db,{
      organizationId:b.tenant,
      dispatchId:older.id,
      action:'commit'
    }));

    // Both numbers now have equal load.
    // Make the larger E.164 explicitly older.
    await admin.query(
      "UPDATE control.physical_caller_rotation SET last_initiated_at=clock_timestamp()-interval '1 day' WHERE e164=$1",
      [second]);

    const next=await reserve(b,'lru-equal-load');
    assert.equal(next.caller_id,second);

    // Lower load must take precedence over older history.
    const lowerLoad=await reserve(b,'lru-load-priority');
    assert.equal(lowerLoad.caller_id,first);
  });

  await t.test('028: rotation advances only on first successful commit',async()=>{
    const number='+74950004803';
    const f=await fixture({number});

    await admin.query(
      "INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",
      [f.tenant,number,f.trunk]);

    const car=new GlobalCarousel();

    const reserve=(key:string)=>control.transaction(
      f.tenant,db=>car.reserve(db,{
        organizationId:f.tenant,
        membershipId:f.member,
        effectiveTrunkId:f.trunk,
        requestKey:key,destination
      }));

    const rotation=async()=>(
      await admin.query(
        'SELECT last_initiated_at::text AS ts FROM control.physical_caller_rotation WHERE e164=$1',
        [number])
    ).rows[0]?.ts;

    const finalize=(id:string,action:'commit'|'release')=>
      control.transaction(f.tenant,db=>car.finalize(db,{
        organizationId:f.tenant,dispatchId:id,action
      }));

    const cancelled=await reserve('rotation-cancel');
    assert.equal(await rotation(),undefined);
    assert.equal(await finalize(cancelled.id,'release'),'released');
    assert.equal(await rotation(),undefined);

    const committed=await reserve('rotation-commit');
    assert.equal(await finalize(committed.id,'commit'),'committed');

    const original=await rotation();
    assert.ok(original);

    await new Promise(resolve=>setTimeout(resolve,20));

    assert.equal(await finalize(committed.id,'commit'),'committed');
    assert.equal(await finalize(committed.id,'release'),'committed');
    assert.equal(await rotation(),original);

    const another=await reserve('rotation-release');
    assert.equal(await finalize(another.id,'release'),'released');
    assert.equal(await rotation(),original);
  });

  await t.test('028: runtime cannot directly read or mutate global rotation',async()=>{
    const f=await fixture({number:'+74950004804'});

    for(const sql of [
      'SELECT * FROM control.physical_caller_rotation',
      'DELETE FROM control.physical_caller_rotation',
      'UPDATE control.physical_caller_rotation SET last_initiated_at=clock_timestamp()'
    ]){
      await assert.rejects(
        control.transaction(f.tenant,db=>db.query(sql)),
        /permission denied/
      );
    }
  });

  await t.test('028: parallel tenants distribute shared physical load evenly',async()=>{
    const numbers=[
      '+74950004811',
      '+74950004812',
      '+74950004813'
    ];

    const tenants=await Promise.all(
      Array.from({length:3},()=>fixture({number:numbers[0]}))
    );

    for(const f of tenants){
      for(const n of numbers){
        await admin.query(
          "INSERT INTO control.phone_numbers(organization_id,e164,trunk_id,active) VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING",
          [f.tenant,n,f.trunk]);
        await admin.query(
          "INSERT INTO control.carousel_numbers(organization_id,e164,trunk_id,status,provider_approved) VALUES($1,$2,$3,'active',true) ON CONFLICT DO NOTHING",
          [f.tenant,n,f.trunk]);
      }
    }

    const car=new GlobalCarousel();

    const reservations=await Promise.all(
      Array.from({length:12},(_,i)=>{
        const f=tenants[i%tenants.length];
        return control.transaction(f.tenant,db=>car.reserve(db,{
          organizationId:f.tenant,
          membershipId:f.member,
          effectiveTrunkId:f.trunk,
          requestKey:'parallel-fair-'+i,
          destination
        }));
      })
    );

    const counts=numbers.map(n=>
      reservations.filter(r=>r.caller_id===n).length
    );

    assert.deepEqual(counts,[4,4,4]);

    const {rows}=await admin.query(
      "SELECT e164,held,used FROM control.physical_caller_day WHERE e164=ANY($1::text[]) ORDER BY e164",
      [numbers]);

    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(r=>r.held),[4,4,4]);
    assert.deepEqual(rows.map(r=>r.used),[0,0,0]);
  });

  await t.test('parallel requests enforce concurrency without wallet gate; duplicate returns same call', async () => {
    const limited=await fixture({limit:1,balance:0,number:'+74950001010'});
    const limitedOutcomes=await Promise.allSettled([
      control.authorize(limited.token,'a',destination),
      control.authorize(limited.token,'b',destination)]);
    assert.equal(limitedOutcomes.filter(r=>r.status==='fulfilled').length,1);
    assert(code('CALL_CONCURRENCY_LIMIT')(
      limitedOutcomes.find(r=>r.status==='rejected')?.reason));
    const postpaid=await fixture({limit:10,balance:0,number:'+74950001011'});
    const [call1,call2]=await Promise.all([
      control.authorize(postpaid.token,'postpaid-1',destination),
      control.authorize(postpaid.token,'postpaid-2',destination)]);
    assert.notEqual(call1.call_id,call2.call_id);
    assert.equal((await admin.query('SELECT available FROM control.wallets WHERE organization_id=$1',
      [postpaid.tenant])).rows[0].available,'0');
    const a = await fixture({number:'+74950001012'});
    const [one,two] = await Promise.all([
      control.authorize(a.token,'same',destination),control.authorize(a.token,'same',destination),
    ]);
    assert.equal(one.call_id,two.call_id);
    await assert.rejects(control.authorize(a.token,'same','+79260000001'),code('IDEMPOTENCY_CONFLICT'));
  });

  await t.test('ninth admission rejected atomically across tenants sharing a physical number', async () => {
    const a = await fixture({number:'+74950001020'});
    const b = await fixture({number:a.number});
    const outcomes = await Promise.allSettled(Array.from({length:9},(_,i) =>
      control.authorize(i % 2 ? a.token : b.token,'burst-' + i,destination)));
    const denied = outcomes.filter(result => result.status === 'rejected');
    assert.equal(denied.length,1);
    assert(code('NUMBER_LIMIT_REACHED')(denied[0].reason));
  });

  await t.test('revocation and expiry between authorization and dispatch release reservation', async () => {
    for (const expired of [false,true]) {
      const a = await fixture({number:expired ? '+74950001031' : '+74950001030'});
      const call = await control.authorize(a.token,'stale',destination);
      if (expired) {
        await admin.query("UPDATE control.calls SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[call.call_id]);
      } else {
        await admin.query('UPDATE control.memberships SET active=false WHERE organization_id=$1 AND id=$2',[a.tenant,a.member]);
        await assert.rejects(control.authorize(a.token,'next',destination),code('USER_REVOKED'));
      }
      const gateway = new FakeAri();
      await control.processOne(a.tenant,gateway);
      assert.equal(gateway.attempts.size,0);
      const { rows: [stored] } = await admin.query(
        'SELECT c.state,w.available FROM control.calls c JOIN control.wallets w USING(organization_id) WHERE c.id=$1',[call.call_id]);
      assert.deepEqual(stored,{ state:expired ? 'expired' : 'failed', available:'100' });
    }
  });

  await t.test('worker expiry sweep closes abandoned call intents and frees global holds',async()=>{
    const f=await fixture({number:'+74950003155'});
    const call=await control.authorize(f.token,'abandoned',destination);
    await admin.query(
      "UPDATE control.carousel_dispatches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [call.call_id]);
    const gateway=new FakeAri();
    await control.processOne(f.tenant,gateway);
    assert.equal(gateway.attempts.size,0);
    assert.equal((await control.calls(f.token,call.call_id)).state,'expired');
    const {rows:[quota]}=await admin.query(
      'SELECT held,used FROM control.physical_caller_day WHERE e164=$1',[f.number]);
    assert.deepEqual(quota,{held:0,used:0});
  });

  await t.test('UIS trunk HTTP API scopes access and redacts credentials through retry and deletion', async () => {
    const owner = await fixture({role:'organization_admin'});
    const other = await fixture({role:'organization_admin'});
    const manager = await fixture();
    const input = {name:'UIS pilot',auth_mode:'registration_credentials',registrar_host:'sip.example.test',
      registrar_port:5060,username:'private-username',password:'private-password'};
    const trunks = new TrunkService(control,randomBytes(32),new Set(['sip.example.test:5060']));
    const api = createApi(control,() => pool.query('SELECT 1'),trunks);
    api.listen(0,'127.0.0.1');
    await once(api,'listening');
    try {
      const address = api.address();
      assert(address && typeof address !== 'string');
      const base = 'http://127.0.0.1:' + address.port + '/v1/trunks';
      const headers = {authorization:'Bearer ' + owner.token,'content-type':'application/json','idempotency-key':'create-uis'};
      const response = await fetch(base,{method:'POST',headers,body:JSON.stringify(input)});
      assert.equal(response.status,202);
      const created = await response.json();
      assert.equal(created.status,'configuring');
      assert(!JSON.stringify(created).includes('private-'));
      assert.equal((await trunks.create(owner.token,'create-uis',input)).id,created.id);
      await assert.rejects(trunks.create(owner.token,'create-uis',{...input,password:'new'}),code('IDEMPOTENCY_CONFLICT'));
      await assert.rejects(trunks.create(owner.token,'other',{...input,registrar_host:'127.0.0.1'}),code('REGISTRAR_NOT_ALLOWED'));
      await assert.rejects(trunks.read(manager.token),code('TRUNK_PERMISSION_REQUIRED'));
      await assert.rejects(trunks.read(other.token,created.id),code('TRUNK_NOT_FOUND'));
      const {rows:[secret]} = await admin.query('SELECT envelope FROM control.trunk_secrets WHERE trunk_id=$1',[created.id]);
      assert(!secret.envelope.includes('private-'));
      assert.equal((await control.transaction(other.tenant,db => db.query('SELECT * FROM trunk_secrets'))).rowCount,0);

      let attempts = 0;
      const adapter = {
        async upsert(job: {trunkId:string;generation:number}, endpoint: {host:string;port:number}, credentials: {username:string;password:string}) {
          attempts++;
          assert.equal(job.trunkId,created.id);
          assert.equal(job.generation,1);
          assert.deepEqual(endpoint,{host:input.registrar_host,port:input.registrar_port});
          assert.deepEqual(credentials,{username:input.username,password:input.password});
          if (attempts === 1) throw new Error('simulated provider outage');
          return 'registered' as const;
        },
        async remove(job: {generation:number}) { assert.equal(job.generation,2); },
      };
      await trunks.provisionNext(owner.tenant,adapter);
      assert.equal((await trunks.read(owner.token,created.id)).status,'degraded');
      await admin.query('UPDATE control.trunk_jobs SET available_at=clock_timestamp() WHERE trunk_id=$1',[created.id]);
      await Promise.all([trunks.provisionNext(owner.tenant,adapter),trunks.provisionNext(owner.tenant,adapter)]);
      assert.equal(attempts,2);
      assert.equal((await trunks.read(owner.token,created.id)).status,'registered');
      assert.equal((await admin.query('SELECT active FROM control.trunks WHERE id=$1',[created.id])).rows[0].active,false);
      for (let i=0;i<2;i++) assert.equal((await fetch(base+'/'+created.id,{method:'DELETE',headers})).status,202);
      await assert.rejects(trunks.read(owner.token,created.id),code('TRUNK_NOT_FOUND'));
      await trunks.provisionNext(owner.tenant,adapter);
      assert.equal((await admin.query('SELECT 1 FROM control.trunk_secrets WHERE trunk_id=$1',[created.id])).rowCount,0);
    } finally {
      await new Promise<void>(resolve => api.close(() => resolve()));
    }
  });


  await t.test('universal SIP authentication and transport',async()=>{
    const owner=await fixture({
      role:'organization_admin',
      number:'+74950004927'
    });

    const trunks=new TrunkService(
      control,randomBytes(32),
      new Set(['sip.example.test:5060','sip.example.test:5061'])
    );

    const base={
      name:'Universal SIP',
      registrar_host:'sip.example.test',
      registrar_port:5060,
      auth_mode:'ip_authentication'
    };

    const ip=await trunks.create(
      owner.token,'ip-auth',{...base,transport:'udp'}
    );

    assert.equal(ip.auth_mode,'ip_authentication');
    assert.equal(ip.transport,'udp');
    assert.equal(ip.desired_active,false);

    const tls=await trunks.create(
      owner.token,'tls-auth',{
        ...base,
        auth_mode:'registration_credentials',
        transport:'tls',
        registrar_port:5061,
        username:'private-user',
        password:'private-secret'
      }
    );

    assert.equal(tls.transport,'tls');
    assert(!JSON.stringify(tls).includes('private-'));

    const tcp=await trunks.create(
      owner.token,'tcp-auth',{...base,transport:'tcp'}
    );

    assert.equal(tcp.transport,'tcp');

    await assert.rejects(
      trunks.create(owner.token,'bad-transport',{
        ...base,transport:'http'
      }),
      code('INVALID_TRUNK')
    );

    await assert.rejects(
      trunks.create(owner.token,'bad-ip-auth',{
        ...base,password:'unexpected'
      }),
      code('INVALID_TRUNK')
    );

    await assert.rejects(
      trunks.create(owner.token,'ip-auth',{
        ...base,transport:'tcp'
      }),
      code('IDEMPOTENCY_CONFLICT')
    );

    const received=new Map<string,{
      endpoint:unknown;credentials:unknown
    }>();

    const adapter={
      supportsUniversalSip:true,
      async upsert(
        job:{trunkId:string},
        endpoint:unknown,
        credentials:unknown
      ){
        received.set(job.trunkId,{endpoint,credentials});
        return 'registered' as const;
      },
      async remove(){}
    };

    for(let i=0;i<3;i++)
      await trunks.provisionNext(owner.tenant,adapter);

    assert.equal(received.size,3);

    assert.deepEqual(received.get(ip.id),{
      endpoint:{
        host:'sip.example.test',port:5060,
        authMode:'ip_authentication',transport:'udp'
      },
      credentials:{username:'',password:''}
    });

    assert.deepEqual(received.get(tls.id),{
      endpoint:{
        host:'sip.example.test',port:5061,
        authMode:'registration_credentials',transport:'tls'
      },
      credentials:{
        username:'private-user',password:'private-secret'
      }
    });

    for(const trunk of [ip,tls,tcp]){
      const result=await trunks.read(owner.token,trunk.id);
      assert.equal(result.status,'registered');
      assert(!JSON.stringify(result).includes('private-'));
    }

    const {rows:[active]}=await admin.query(
      'SELECT count(*)::int AS n FROM control.trunks WHERE id=ANY($1::uuid[]) AND active',
      [[ip.id,tls.id,tcp.id]]
    );

    assert.equal(active.n,0);
  });


  await t.test('SIP activation verification diagnostics and recheck',async()=>{
    const owner=await fixture({
      role:'organization_admin',
      number:'+74950004928'
    });

    const foreign=await fixture({
      role:'organization_admin'
    });

    const trunks=new TrunkService(
      control,randomBytes(32),
      new Set(['sip.example.test:5060'])
    );

    const trunk=await trunks.create(
      owner.token,'lifecycle',{
        name:'Lifecycle SIP',
        auth_mode:'registration_credentials',
        registrar_host:'sip.example.test',
        registrar_port:5060,
        username:'test-user',
        password:'test-password'
      }
    );

    const adapter={
      async upsert(){return 'registered' as const;},
      async remove(){}
    };

    const isActive=async()=>{
      const {rows:[row]}=await admin.query(
        'SELECT active FROM control.trunks WHERE id=$1',
        [trunk.id]
      );
      return row.active;
    };

    await assert.rejects(
      trunks.setActive(owner.token,trunk.id,true),
      code('TRUNK_NOT_READY')
    );

    await assert.rejects(
      trunks.setActive(foreign.token,trunk.id,true),
      code('TRUNK_NOT_FOUND')
    );

    await trunks.provisionNext(owner.tenant,adapter);

    const checked=await trunks.read(owner.token,trunk.id);

    assert.equal(checked.status,'registered');
    assert.equal(checked.diagnostic_code,'CONNECTION_OK');
    assert(checked.last_checked_at);
    assert(checked.last_success_at);
    assert.equal(await isActive(),false);

    await admin.query(
      "UPDATE control.organizations SET verification_status='unverified' WHERE id=$1",
      [owner.tenant]
    );

    await assert.rejects(
      trunks.setActive(owner.token,trunk.id,true),
      code('ORGANIZATION_NOT_VERIFIED')
    );

    await admin.query(
      "UPDATE control.organizations SET verification_status='verified' WHERE id=$1",
      [owner.tenant]
    );

    await trunks.setActive(owner.token,trunk.id,true);

    assert.equal(await isActive(),true);

    await trunks.setActive(owner.token,trunk.id,false);

    assert.equal(await isActive(),false);

    await trunks.setActive(owner.token,trunk.id,true);

    await trunks.recheck(owner.token,trunk.id);

    assert.equal(await isActive(),false);

    await assert.rejects(
      trunks.setActive(owner.token,trunk.id,true),
      code('TRUNK_NOT_READY')
    );

    await trunks.provisionNext(owner.tenant,adapter);

    assert.equal(await isActive(),false);

    await trunks.setActive(owner.token,trunk.id,true);

    assert.equal(await isActive(),true);

    await trunks.remove(owner.token,trunk.id);

    assert.equal(await isActive(),false);

    await trunks.provisionNext(owner.tenant,adapter);

    await assert.rejects(
      trunks.setActive(owner.token,trunk.id,true),
      code('TRUNK_NOT_FOUND')
    );
  });

  await t.test('deleting a UIS trunk fences a late provisioning result', async () => {
    const owner = await fixture({role:'organization_admin'});
    const trunks = new TrunkService(control,randomBytes(32),new Set(['sip.example.test:5060']));
    const trunk = await trunks.create(owner.token,'in-flight',{
      name:'In-flight',auth_mode:'registration_credentials',registrar_host:'sip.example.test',
      registrar_port:5060,username:'test-user',password:'test-secret',
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const adapter = {
      async upsert() {
        entered.resolve();
        await release.promise;
        return 'registered' as const;
      },
      async remove(job: {generation:number}) { assert.equal(job.generation,2); },
    };
    const inflight = trunks.provisionNext(owner.tenant,adapter);
    await Promise.race([entered.promise,inflight.then(() => { throw new Error('Expected an in-flight UPSERT'); })]);
    try {
      assert.equal((await trunks.read(owner.token,trunk.id)).status,'registering');
      await trunks.remove(owner.token,trunk.id);
      await trunks.provisionNext(owner.tenant,adapter);
    } finally {
      release.resolve();
      await inflight;
    }
    await assert.rejects(trunks.read(owner.token,trunk.id),code('TRUNK_NOT_FOUND'));
    const {rows:[record]} = await admin.query(
      'SELECT generation,status FROM control.managed_trunks WHERE id=$1',[trunk.id]);
    assert.deepEqual(record,{generation:2,status:'registering'});
    assert.equal((await admin.query('SELECT 1 FROM control.trunk_secrets WHERE trunk_id=$1',[trunk.id])).rowCount,0);
  });

  await t.test('critical tenant suspension hangs up an active fake call', async () => {
    const a = await fixture({number:'+74950001032'});
    const call = await control.authorize(a.token,'active-revoke',destination);
    const gateway = new FakeAri();
    gateway.timeoutAfterAccept = true;
    await control.processOne(a.tenant,gateway);
    assert.equal((await control.calls(a.token,call.call_id)).state,'reconciling');
    await admin.query('UPDATE control.organizations SET active=false WHERE id=$1',[a.tenant]);
    await control.processOne(a.tenant,gateway);
    assert.deepEqual([...gateway.attempts.values()],['ended']);
    const { rows: [stored] } = await admin.query(
      'SELECT c.state,w.available FROM control.calls c JOIN control.wallets w USING(organization_id) WHERE c.id=$1',
      [call.call_id]);
    assert.deepEqual(stored,{state:'ended',available:'100'});
  });


  await t.test('call reporting counts actual dispatch and human usage',async()=>{
    const a=await fixture({number:'+74950004926'});

    const reader=randomUUID();

    await admin.query(
      "INSERT INTO control.users(id,login,password_hash,email_verified_at) VALUES($1,$2,'test',clock_timestamp())",
      [reader,reader+'@example.test']
    );

    await admin.query(
      "INSERT INTO control.memberships(id,organization_id,user_id,role_id) VALUES($1,$2,$3,'admin')",
      [randomUUID(),a.tenant,reader]
    );

    const gateway=new FakeAri();

    const outcomes=[
      {outcome:'human' as const,billableSeconds:120,evidenceId:'reporting-test-evidence'},
      {outcome:'machine' as const},
      {outcome:'no_answer' as const},
      {outcome:'rejected' as const},
      {outcome:'error' as const},
    ];

    for(const [i,classification] of outcomes.entries()){
      const call=await control.authorize(
        a.token,'reporting-'+i,destination
      );

      await control.processOne(a.tenant,gateway);

      await control.event(a.tenant,call.call_id,{
        id:'reporting-terminal-'+i,
        state:'ended',classification
      });
    }

    const pending=await control.authorize(
      a.token,'reporting-pending',destination
    );

    await control.processOne(a.tenant,gateway);

    const held=await control.authorize(
      a.token,'reporting-not-dispatched',destination
    );

    const {rows:[row]}=await pool.query(
      "SELECT web_auth.organization_call_statistics($1,$2,'2026-01-01','2026-12-31') AS report",
      [reader,a.tenant]
    );

    const r=row.report;

    assert.equal(r.initiations,6);
    assert.equal(r.completed_calls,5);
    assert.equal(r.answered,1);
    assert.equal(r.machine,1);
    assert.equal(r.no_answer,1);
    assert.equal(r.rejected,1);
    assert.equal(r.error,1);
    assert.equal(r.billable_seconds,120);
    assert.equal(r.charges_kopeks,600);
    assert.equal(r.answer_rate,20);

    assert.equal(r.daily.reduce(
      (n:number,d:{initiations:number})=>n+d.initiations,0
    ),6);

    const {rows:[history]}=await pool.query(
      "SELECT web_auth.organization_call_history($1,$2,'2026-01-01','2026-12-31',0,100) AS page",
      [reader,a.tenant]
    );

    assert.equal(history.page.total,7);

    assert(history.page.items.some(
      (c:{id:string;outcome:unknown})=>
       c.id===pending.call_id&&c.outcome===null
    ));

    assert(history.page.items.some(
      (c:{id:string;state:string})=>
       c.id===held.call_id&&c.state==='authorized'
    ));
  });

  await t.test('machine outcome cannot create human billable seconds',async()=>{
    const a=await fixture({balance:0,number:'+74950004101'});
    const call=await control.authorize(a.token,'machine',destination);
    const gateway=new FakeAri();
    await control.processOne(a.tenant,gateway);
    assert.equal((await control.calls(a.token,call.call_id)).state,'ringing');
    await assert.rejects(control.event(a.tenant,call.call_id,{
      id:'invalid-machine',state:'ended',
      classification:{outcome:'machine',billableSeconds:60},
    }),/NON_HUMAN_CANNOT_BE_BILLED/);
    await assert.rejects(control.event(a.tenant,call.call_id,{
      id:'unverified-human',state:'ended',
      classification:{outcome:'human',billableSeconds:60},
    }),/UNVERIFIED_HUMAN_BILLING/);
    await control.event(a.tenant,call.call_id,{
      id:'machine-confirmed',state:'ended',classification:{outcome:'machine'},
    });
    const {rows:[ledger]}=await admin.query(
      'SELECT outcome,billable_seconds,amount_kopeks FROM control.postpaid_usage WHERE call_id=$1',
      [call.call_id]);
    assert.deepEqual(ledger,{outcome:'machine',billable_seconds:0,amount_kopeks:'0'});
    assert.equal((await admin.query('SELECT available FROM control.wallets WHERE organization_id=$1',
      [a.tenant])).rows[0].available,'0');
  });

  await t.test('ambiguous originate reconciles without redial and terminal delivery charges once', async () => {
    const a = await fixture({number:'+74950001040'});
    const call = await control.authorize(a.token,'timeout',destination);
    const gateway = new FakeAri();
    gateway.timeoutAfterAccept = true;
    await control.processOne(a.tenant,gateway);
    assert.equal((await control.calls(a.token,call.call_id)).state,'reconciling');
    await admin.query("UPDATE control.carousel_outbox SET claimed_at=clock_timestamp()-interval '11 seconds' WHERE dispatch_id=$1",[call.call_id]);
    await control.processOne(a.tenant,gateway);
    assert.equal((await control.calls(a.token,call.call_id)).state,'ringing');
    assert.equal(gateway.attempts.size,1);
    const verified={outcome:'human' as const,billableSeconds:60,evidenceId:'classifier-v1:recording-verified'};
    await Promise.all([
      control.event(a.tenant,call.call_id,{id:'cel-1',state:'ended',classification:verified}),
      control.event(a.tenant,call.call_id,{id:'cel-1',state:'ended',classification:verified}),
      control.event(a.tenant,call.call_id,{id:'duplicate-terminal',state:'ended',classification:verified}),
    ]);
    assert.equal((await control.calls(a.token,call.call_id)).state,'ended');
    const {rows:[charged]}=await admin.query(
      'SELECT outcome,billable_seconds,amount_kopeks,evidence_id FROM control.postpaid_usage WHERE call_id=$1',
      [call.call_id]);
    assert.deepEqual(charged,{
      outcome:'human',billable_seconds:60,amount_kopeks:'300',evidence_id:verified.evidenceId,
    });
    const {rows:legacy}=await admin.query('SELECT * FROM control.usage_ledger WHERE call_id=$1',[call.call_id]);
    assert.equal(legacy.length,0);
    const {rows:[wallet]}=await admin.query('SELECT available FROM control.wallets WHERE organization_id=$1',[a.tenant]);
    assert.equal(wallet.available,'100');
  });
});
