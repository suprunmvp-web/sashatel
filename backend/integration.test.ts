import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import pg from 'pg';
import { ApiError, ControlPlane, hashPassword } from './control.ts';
import { FakeAri } from './fake-ari.ts';
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
