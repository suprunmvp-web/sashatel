import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import pg from 'pg';
import { ApiError, ControlPlane, hashPassword } from './control.ts';
import { FakeAri } from './fake-ari.ts';
import { TrunkService } from './trunks.ts';
import { createApi } from './http.ts';

const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_URL;
assert(runtimeUrl && adminUrl, 'Disposable migrated PostgreSQL with runtime and owner URLs required');
const pool = new pg.Pool({ connectionString: runtimeUrl });
const admin = new pg.Pool({ connectionString: adminUrl });
const control = new ControlPlane(pool, undefined, () => true);

async function fixture({ limit = 10, balance = 100, role = 'manager', number = '+74950001001' } = {}) {
  const [tenant, user, member, trunk, device] = Array.from({ length: 5 }, () => randomUUID());
  await admin.query('INSERT INTO control.organizations VALUES ($1,true,$2)', [tenant,limit]);
  await admin.query('INSERT INTO control.users (id,login,password_hash) VALUES ($1,$1::uuid::text,$2)',
    [user,await hashPassword('test-password')]);
  await admin.query('INSERT INTO control.memberships VALUES ($1,$2,$3,$4,true)', [tenant,member,user,role]);
  await admin.query('INSERT INTO control.subscriptions VALUES ($1,true,true)', [tenant]);
  await admin.query("INSERT INTO control.wallets VALUES ($1,'minutes',$2,10)", [tenant,balance]);
  await admin.query('INSERT INTO control.trunks VALUES ($1,$2,true)', [tenant,trunk]);
  await admin.query('INSERT INTO control.phone_numbers VALUES ($1,$2,$3,true)', [tenant,number,trunk]);
  const credentials = await control.login(tenant,user,'test-password',device);
  return { tenant, user, member, token: credentials.token, number };
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

  await t.test('unavailable worker cannot reserve or enqueue', async () => {
    const a = await fixture({number:'+74950001004'});
    const unavailable = new ControlPlane(pool);
    await assert.rejects(unavailable.authorize(a.token,'offline',destination),code('CALL_WORKER_UNAVAILABLE'));
    const {rows:[row]} = await admin.query(
      'SELECT available,(SELECT count(*) FROM control.outbox WHERE organization_id=$1) AS pending FROM control.wallets WHERE organization_id=$1',[a.tenant]);
    assert.deepEqual(row,{available:'100',pending:'0'});
  });

  await t.test('parallel requests enforce concurrency and budget; duplicate returns same call', async () => {
    for (const [index, limits] of [{limit:1,balance:100},{limit:10,balance:10}].entries()) {
      const a = await fixture({...limits,number:'+7495000101' + index});
      const first = await Promise.allSettled([
        control.authorize(a.token,'a',destination),control.authorize(a.token,'b',destination),
      ]);
      assert.equal(first.filter(result => result.status === 'fulfilled').length,1);
      const rejected = first.find(result => result.status === 'rejected');
      assert(rejected && rejected.status === 'rejected');
      assert(code(index === 0 ? 'CALL_CONCURRENCY_LIMIT' : 'INSUFFICIENT_BALANCE')(rejected.reason));
    }
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

  await t.test('ambiguous originate reconciles without redial and terminal delivery charges once', async () => {
    const a = await fixture({number:'+74950001040'});
    const call = await control.authorize(a.token,'timeout',destination);
    const gateway = new FakeAri();
    gateway.timeoutAfterAccept = true;
    await control.processOne(a.tenant,gateway);
    assert.equal((await control.calls(a.token,call.call_id)).state,'reconciling');
    await admin.query("UPDATE control.outbox SET claimed_at=clock_timestamp()-interval '11 seconds' WHERE call_id=$1",[call.call_id]);
    await control.processOne(a.tenant,gateway);
    assert.equal((await control.calls(a.token,call.call_id)).state,'ringing');
    assert.equal(gateway.attempts.size,1);
    await control.event(a.tenant,call.call_id,{id:'cel-1',state:'ended'});
    assert.equal((await control.calls(a.token,call.call_id)).state,'ended');
    await Promise.all([
      control.event(a.tenant,call.call_id,{id:'cel-1', state:'ended',charge:3n}),
      control.event(a.tenant,call.call_id,{id:'cel-1', state:'ended',charge:3n}),
      control.event(a.tenant,call.call_id,{id:'duplicate-terminal', state:'ended',charge:3n}),
    ]);
    const { rows } = await admin.query('SELECT kind,units FROM control.usage_ledger WHERE call_id=$1 ORDER BY kind',[call.call_id]);
    assert.deepEqual(rows,[{kind:'charge',units:'3'},{kind:'release',units:'7'},{kind:'reserve',units:'10'}]);
    const { rows: [wallet] } = await admin.query('SELECT available FROM control.wallets WHERE organization_id=$1',[a.tenant]);
    assert.equal(wallet.available,'97');
  });
});
