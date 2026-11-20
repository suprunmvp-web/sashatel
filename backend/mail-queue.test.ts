import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {WebAuth,type MailPort} from './web-auth.ts';

assert(process.env.DATABASE_URL && process.env.TEST_ADMIN_URL);
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
const admin = new pg.Pool({connectionString:process.env.TEST_ADMIN_URL});

const profile = {
  first_name:'Тест',
  last_name:'Очереди',
  phone:'+79261234567',
  password:'a-long-test-password',
};
const neverLookup = {async lookup():Promise<null> {return null;}};
const actor = async (auth:WebAuth) => ({
  browser:await auth.browser(),
  requestId:randomUUID(),
});
const register = async (auth:WebAuth) => {
  const ctx = await actor(auth);
  const email = randomUUID()+'@example.test';
  const result = await auth.register(ctx,{...profile,email},randomUUID());
  return {ctx,email,id:(result.body as {challenge_id:string}).challenge_id};
};
function deferred() {
  let resolve!:()=>void;
  const promise = new Promise<void>(r=>{resolve=r;});
  return {promise,resolve};
}
async function job(id:string) {
  const {rows:[row]} = await admin.query(
    'SELECT challenge_id,attempts,completed_at,lease_token,lease_until,envelope FROM web_auth.mail_jobs WHERE challenge_id=$1',
    [id],
  );
  return row;
}

test('mail outbox lease, concurrency, recovery and invalidated challenges (PostgreSQL)',async t=>{
  t.after(async()=>{await Promise.all([pool.end(),admin.end()]);});

  await t.test('only one worker claims an active job and sending holds no SQL transaction',async()=>{
    const entered=deferred(),release=deferred();
    const sent:string[]=[];
    const mail:MailPort={async send(message) {
      sent.push(message.id);
      entered.resolve();
      await release.promise;
    }};
    const auth=new WebAuth(pool,randomBytes(32),mail,neverLookup);
    const {id}=await register(auth);
    const first=auth.deliverOne();
    try {
      await entered.promise;
      const claimed=await job(id);
      assert(claimed.lease_token);
      assert(claimed.lease_until);
      assert.equal(claimed.completed_at,null);

      // The competing worker must return while the first provider request is blocked.
      // SQL claim must have committed: a separate admin connection can inspect the row.
      await auth.deliverOne();
      assert.deepEqual(sent,[id]);
    } finally {
      release.resolve();
      await first;
    }
    const finished=await job(id);
    assert.equal(finished.completed_at instanceof Date,true);
    assert.equal(finished.envelope,null);
    assert.equal(finished.lease_token,null);
    assert.equal(finished.lease_until,null);
    assert.equal(finished.attempts,0);
  });

  await t.test('expired lease permits recovery; stale worker cannot finalize a newer claim',async()=>{
    const entered=deferred(),release=deferred();
    let sends=0;
    const mail:MailPort={async send() {
      sends++;
      if(sends===1) {
        entered.resolve();
        await release.promise;
      }
    }};
    const auth=new WebAuth(pool,randomBytes(32),mail,neverLookup);
    const {id}=await register(auth);
    const first=auth.deliverOne();
    try {
      await entered.promise;
      const previous=(await job(id)).lease_token;
      // Simulate elapsed lease after a worker hangs or loses its process.
      await admin.query("UPDATE web_auth.mail_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE challenge_id=$1",[id]);
      await auth.deliverOne();
      assert.equal(sends,2);
      const recovered=await job(id);
      assert(recovered.completed_at instanceof Date);
      assert.equal(recovered.envelope,null);
      assert.equal(recovered.lease_token,null);
      assert.notEqual(previous,null);
    } finally {
      release.resolve();
      await first;
    }
    const final=await job(id);
    assert(final.completed_at instanceof Date);
    assert.equal(final.envelope,null);
    assert.equal(final.lease_token,null);
    assert.equal(final.attempts,0);
    // A lease takeover may mean at-least-once delivery. This is expected, not exactly once.
    assert.equal(sends,2);
  });

  await t.test('replaced challenge cannot send its stale code',async()=>{
    const sent:string[]=[];
    const mail:MailPort={async send(message) {sent.push(message.id);}};
    const auth=new WebAuth(pool,randomBytes(32),mail,neverLookup);
    const {ctx,id,email}=await register(auth);

    // A corrected email replaces browser.challenge_id and consumes the original.
    const next=await auth.register(ctx,{...profile,email:randomUUID()+'@example.test'},randomUUID());
    const newId=(next.body as {challenge_id:string}).challenge_id;
    assert.notEqual(id,newId);

    // The oldest pending job is invalidated without calling the provider.
    await auth.deliverOne();
    const old=await job(id);
    assert(old.completed_at instanceof Date);
    assert.equal(old.envelope,null);
    assert(!sent.includes(id));

    await auth.deliverOne();
    assert.deepEqual(sent,[newId]);
  });
});
