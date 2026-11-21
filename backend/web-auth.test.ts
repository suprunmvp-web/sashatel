import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {WebAuth,type MailPort} from './web-auth.ts';
import {createApi} from './http.ts';

assert(process.env.DATABASE_URL&&process.env.TEST_ADMIN_URL);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const admin=new pg.Pool({connectionString:process.env.TEST_ADMIN_URL});
const messages=new Map<string,{email:string;code:string|null}>();
let failMail=false;
const mail:MailPort={async send(message) {if(failMail) throw Error('sink unavailable');messages.set(message.id,message);}};
const auth=new WebAuth(pool,randomBytes(32),mail,{async lookup(inn) {
  if(inn==='7707083893') return {legal_name:'Test organization',legal_address:'Test address'};
  return null;
}});
const profile={first_name:'Иван',last_name:'Иванов',email:'',phone:'+7 (926) 123-45-67',password:'long-test-password'};
const code=(value:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===value;

async function actor() {
  const browser=await auth.browser();
  return {browser,requestId:randomUUID(),access:undefined as string|undefined,refresh:undefined as string|undefined};
}
async function registered() {
  const ctx=await actor(),email=randomUUID()+'@example.test';
  const result=await auth.register(ctx,{...profile,email},randomUUID());
  const id=(result.body as any).challenge_id;
  for(let i=0;i<30&&!messages.has(id);i++) await auth.deliverOne();
  const verification=await auth.verify(ctx,{challenge_id:id,code:messages.get(id)!.code});
  ctx.access=verification.cookies!.access;ctx.refresh=verification.cookies!.refresh;
  return {ctx,email,id};
}
test('Web onboarding with real PostgreSQL',async t=>{
  t.after(async()=>{await Promise.all([pool.end(),admin.end()]);});
  await t.test('validation, durable sink error/retry and per-challenge attempts survive failures',async()=>{
    const ctx=await actor(),email=randomUUID()+'@example.test';
    await assert.rejects(auth.register(ctx,{...profile,email,phone:'+123'},randomUUID()),code('INVALID_PHONE'));
    await assert.rejects(auth.register(ctx,{...profile,email,password:'short7!'},randomUUID()),code('INVALID_PASSWORD'));
    const eightCharPassword='eight123';
    const minimum=await auth.register(await actor(),{...profile,email:randomUUID()+'@example.test',password:eightCharPassword},randomUUID());
    assert.equal(minimum.status,202);

    const key=randomUUID();
    const [a,b]=await Promise.all([auth.register(ctx,{...profile,email},key),auth.register(ctx,{...profile,email},key)]);
    assert.deepEqual(a.body,b.body);
    const id=(a.body as any).challenge_id;
    failMail=true;await auth.deliverOne();failMail=false;
    const failed=await auth.tx(ctx,db=>auth.challengeStatus(db,ctx,id));
    assert.equal(failed.delivery.state,'failed');
    await admin.query('UPDATE web_auth.mail_jobs SET available_at=clock_timestamp() WHERE challenge_id=$1',[id]);
    await auth.deliverOne();
    assert.equal(messages.get(id)?.email,email);
    for(let i=0;i<5;i++) await assert.rejects(auth.verify(ctx,{challenge_id:id,code:'invalid'.slice(0,6).replace(/./g,'9')}),code('CODE_INVALID_OR_EXPIRED'));
    await assert.rejects(auth.verify(ctx,{challenge_id:id,code:messages.get(id)!.code}),code('CODE_INVALID_OR_EXPIRED'));
    assert.equal((await admin.query('SELECT attempts FROM web_auth.challenges WHERE id=$1',[id])).rows[0].attempts,5);
  });
  await t.test('one verify wins, lost response restores same family and logout fences receipt',async()=>{
    const ctx=await actor(),email=randomUUID()+'@example.test';
    const result=await auth.register(ctx,{...profile,email},randomUUID());
    const id=(result.body as any).challenge_id;
    await auth.deliverOne();
    const outcomes=await Promise.allSettled([auth.verify(ctx,{challenge_id:id,code:messages.get(id)!.code}),auth.verify(ctx,{challenge_id:id,code:messages.get(id)!.code})]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await auth.bootstrap(ctx)).body && ((await auth.bootstrap(ctx)).body as any).verification_completion_available,true);
    const first=await auth.complete(ctx),second=await auth.complete(ctx);
    assert.deepEqual(first.cookies,second.cookies);
    const families=await admin.query('SELECT count(*)::int AS count FROM web_auth.families WHERE browser_hash=(SELECT browser_hash FROM web_auth.challenges WHERE id=$1)',[id]);
    assert.equal(families.rows[0].count,1);
    await auth.logout(ctx);
    await assert.rejects(auth.complete(ctx),code('CODE_INVALID_OR_EXPIRED'));
  });
  await t.test('expiry, resend and corrected email preserve scoped challenges',async()=>{
    const ctx=await actor(),foreign=await actor(),email=randomUUID()+'@example.test';
    const original=await auth.register(ctx,{...profile,email},randomUUID()),id=(original.body as any).challenge_id;
    await assert.rejects(auth.tx(foreign,db=>auth.challengeStatus(db,foreign,id)),code('RESOURCE_NOT_FOUND'));
    await assert.rejects(auth.resend(ctx,{challenge_id:id},randomUUID()),code('RATE_LIMITED'));
    await admin.query("UPDATE web_auth.challenges SET created_at=clock_timestamp()-interval '61 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    await assert.rejects(auth.verify(ctx,{challenge_id:id,code:'123456'}),code('CODE_INVALID_OR_EXPIRED'));
    const next=await auth.resend(ctx,{challenge_id:id},randomUUID());
    assert.notEqual((next.body as any).challenge_id,id);
    const corrected=await auth.register(ctx,{...profile,email:randomUUID()+'@example.test'},randomUUID());
    await assert.rejects(auth.verify(ctx,{challenge_id:(next.body as any).challenge_id,code:'123456'}),code('CODE_INVALID_OR_EXPIRED'));
    assert((corrected.body as any).challenge_id);
  });
  await t.test('register → verify → create org → logout/login preserves contact fields and organization',async()=>{
    const {ctx,email}=await registered();
    const boot=await auth.bootstrap(ctx);
    assert.deepEqual((boot.body as any).account,{
      id:(boot.body as any).account.id,email,email_verified:true,first_name:'Иван',last_name:'Иванов',
      phone:'+79261234567',phone_verified:false,display_name:'Иван',
    });
    const lookup=await auth.lookupOrganization(ctx,{inn:'7707083893'});
    const payload={lookup_id:(lookup.body as any).lookup_id,confirm:true},key=randomUUID();
    const [one,two]=await Promise.all([auth.createOrganization(ctx,payload,key),auth.createOrganization(ctx,payload,key)]);
    assert.deepEqual(one.body,two.body);
    assert.deepEqual([one.status,two.status].sort(),[200,201]);
    const org=(one.body as any).organization;
    assert.equal(org.role,'owner');assert.equal(org.verification_status,'unverified');
    const {rows:[owner]}=await admin.query('SELECT owner_membership_id FROM control.organizations WHERE id=$1',[org.id]);
    assert.equal(owner.owner_membership_id,org.membership_id);
    await admin.query("UPDATE web_auth.lookups SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[payload.lookup_id]);
    assert.equal((await auth.createOrganization(ctx,payload,key)).status,200);
    assert.deepEqual((await auth.creationStatus(ctx,key)).body,one.body);
    await auth.logout(ctx);
    await assert.rejects(auth.organizations(ctx),code('SESSION_REVOKED'));
    const login=await auth.login(ctx,{email,password:profile.password,device_id:randomUUID()});
    ctx.access=login.cookies!.access;ctx.refresh=login.cookies!.refresh;
    assert.equal((login.body as any).account.last_name,'Иванов');
    assert.equal((login.body as any).account.phone,'+79261234567');
    assert.deepEqual(((await auth.organizations(ctx)).body as any).items,[org]);
    const {ctx:other}=await registered();
    assert.deepEqual(((await auth.organizations(other)).body as any).items,[]);
    await assert.rejects(auth.selectOrganization(other,{organization_id:org.id,expected_context_epoch:null}),code('RESOURCE_NOT_FOUND'));
    await assert.rejects(auth.creationStatus(other,key),code('RESOURCE_NOT_FOUND'));
    const audit=await admin.query("SELECT actor_user_id,organization_id FROM web_auth.audit WHERE action='organization.created' AND target_id=$1",[org.id]);
    assert.equal(audit.rowCount,1);assert.equal(audit.rows[0].organization_id,org.id);
    const scope=await pool.query('SELECT id FROM control.organizations WHERE id=$1',[org.id]);
    assert.equal(scope.rowCount,0);
  });
  await t.test('strict refresh reuse, logout with used refresh, expiry and concurrent logout',async()=>{
    const {ctx}=await registered();
    const previous=ctx.refresh;
    const [rotated,parallel]=await Promise.all([auth.refresh(ctx),auth.refresh(ctx)]);
    assert.deepEqual(rotated.cookies,parallel.cookies);
    await assert.rejects(auth.refresh(ctx),code('REFRESH_REUSED'));
    ctx.access=rotated.cookies!.access;ctx.refresh=rotated.cookies!.refresh;
    await assert.rejects(auth.bootstrap(ctx),code('SESSION_REVOKED'));
    const second=await registered(),old=second.ctx.refresh;
    const next=await auth.refresh(second.ctx);
    await auth.logout({...second.ctx,refresh:old,access:undefined});
    await assert.rejects(auth.refresh({...second.ctx,refresh:next.cookies!.refresh}),code('SESSION_REVOKED'));
    assert(previous);
    const third=await registered();
    await Promise.allSettled([auth.logout(third.ctx),auth.refresh(third.ctx)]);
    await assert.rejects(auth.refresh(third.ctx),code('SESSION_REVOKED'));
  });
  await t.test('audit failure rolls organization creation back',async()=>{
    const {ctx}=await registered();
    const lookupId=randomUUID();
    const user=((await auth.bootstrap(ctx)).body as any).account.id;
    await admin.query("INSERT INTO web_auth.lookups VALUES($1,$2,'500100732259','Rollback company','Address',clock_timestamp()+interval '15 minutes')",[lookupId,user]);
    await admin.query('REVOKE INSERT ON web_auth.audit FROM control_runtime');
    try {
      await assert.rejects(auth.createOrganization(ctx,{lookup_id:lookupId,confirm:true},randomUUID()));
      assert.equal((await admin.query("SELECT id FROM control.organizations WHERE inn='500100732259'")).rowCount,0);
    } finally {await admin.query('GRANT INSERT ON web_auth.audit TO control_runtime');}
  });

  await t.test('HTTP cookie/CSRF wire and real sink path',async()=>{
    const control=(await import('./control.ts')).ControlPlane;
    const api=createApi(new control(pool),()=>pool.query('SELECT 1'),undefined,{auth,origin:'https://platform.example.test'});
    api.listen(0,'127.0.0.1');await once(api,'listening');
    try {
      const address=api.address();assert(address&&typeof address!=='string');
      const base='http://127.0.0.1:'+address.port;
      const bootstrap=await fetch(base+'/v1/auth/csrf');
      const {csrf_token}=await bootstrap.json();
      const cookie=bootstrap.headers.getSetCookie()[0].split(';')[0];
      assert(bootstrap.headers.getSetCookie()[0].includes('HttpOnly'));
      const input={...profile,email:randomUUID()+'@example.test'};
      const invalid=await fetch(base+'/v1/auth/register',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(input)});
      assert.equal(invalid.status,403);
      const response=await fetch(base+'/v1/auth/register',{method:'POST',headers:{cookie,origin:'https://platform.example.test','x-csrf-token':csrf_token,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify(input)});
      assert.equal(response.status,202);assert.equal(response.headers.get('cache-control'),'no-store');
      const {challenge_id}=await response.json();
      for(let i=0;i<30&&!messages.has(challenge_id);i++) await auth.deliverOne();
      const verified=await fetch(base+'/v1/auth/email/verify',{method:'POST',headers:{cookie,origin:'https://platform.example.test','x-csrf-token':csrf_token,'content-type':'application/json'},body:JSON.stringify({challenge_id,code:messages.get(challenge_id)!.code})});
      assert.equal(verified.status,200);assert.equal(verified.headers.getSetCookie().length,3);
      const accountCookies=verified.headers.getSetCookie().map(value=>value.split(';')[0]);
      const signedCookie=[cookie,...accountCookies].join('; ');
      const headers={cookie:signedCookie,origin:'https://platform.example.test','x-csrf-token':csrf_token,'content-type':'application/json'};
      const looked=await fetch(base+'/v1/organizations/lookup',{method:'POST',headers,body:JSON.stringify({inn:'7707083893'})});
      assert.equal(looked.status,200);
      // This INN belongs to an earlier test. The HTTP route must preserve the stable conflict.
      const lookupReceipt=await looked.json();
      const created=await fetch(base+'/v1/organizations',{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify({lookup_id:lookupReceipt.lookup_id,confirm:true})});
      assert.equal(created.status,409);
      assert.equal((await created.json()).code,'ORGANIZATION_ALREADY_EXISTS');
      const logout=await fetch(base+'/v1/auth/logout',{method:'POST',headers,body:'{}'});
      assert.equal(logout.status,204);
      const login=await fetch(base+'/v1/auth/login',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({email:input.email,password:input.password,device_id:randomUUID()})});
      assert.equal(login.status,200);
      assert.equal((await login.json()).account.phone,'+79261234567');
    } finally {await new Promise<void>(resolve=>api.close(()=>resolve()));}
  });
});
