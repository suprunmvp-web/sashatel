import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {WebAuth,type MailPort} from './web-auth.ts';

assert(process.env.DATABASE_URL&&process.env.TEST_ADMIN_URL);
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const admin=new pg.Pool({connectionString:process.env.TEST_ADMIN_URL});
const messages=new Map<string,{id:string;email:string;code:string|null;purpose?:string}>();
const mail:MailPort={async send(message){messages.set(message.email,{...message});}};
const claimedInn='9'+String(Date.now()%1000000000).padStart(9,'0');
const auth=new WebAuth(db,randomBytes(32),mail,{async lookup(){return null;},async suggest(){return [{inn:claimedInn,legal_name:'ООО Проверка',legal_address:'Москва'}];}});
const profile={first_name:'Анна',last_name:'Иванова',phone:'+79261234567',password:'starting-long-password-123'};
const actor=async()=>({browser:await auth.browser(),requestId:randomUUID(),access:undefined as string|undefined,refresh:undefined as string|undefined});
const codeOf=(error:unknown,name:string)=>error instanceof Error&&'code' in error&&error.code===name;
test('password reset: generic request, one-time code, password change, session revocation',async t=>{
 t.after(async()=>{await Promise.all([db.end(),admin.end()]);});
 const ctx=await actor(),email=randomUUID()+'@example.test';
 const reg=await auth.register(ctx,{...profile,email},randomUUID());
 await auth.deliverOne();
 const confirmation=messages.get(email);
 assert.equal(confirmation?.purpose,undefined);
 assert(confirmation?.code);
 const verified=await auth.verify(ctx,{challenge_id:(reg.body as any).challenge_id,code:confirmation.code});
 ctx.access=verified.cookies!.access;
 ctx.refresh=verified.cookies!.refresh;
 // A claimed verified INN is exposed as a boolean to the authenticated picker.
 // An unverified record with the same INN must not create a lock by itself.
 const firstOrg=randomUUID();
 await admin.query(
   'INSERT INTO control.organizations(id,max_calls,inn,legal_name,verification_status) VALUES($1,1,$2,$3,$4)',
   [firstOrg,claimedInn,'ООО Проверка','unverified'],
 );
 const available=await auth.suggestOrganizations(ctx,{query:claimedInn.slice(0,4)});
 assert.equal((available.body as any).items[0].verified,false);
 await admin.query("UPDATE control.organizations SET verification_status='verified' WHERE id=$1",[firstOrg]);
 const claimed=await auth.suggestOrganizations(ctx,{query:claimedInn.slice(0,4)});
 assert.equal((claimed.body as any).items[0].verified,true);
 await admin.query('DELETE FROM control.organizations WHERE id=$1',[firstOrg]);
 const unknown=await actor();
 const nonexistent=await auth.requestPasswordReset(unknown,{email:randomUUID()+'@example.test'});
 assert.equal(nonexistent.status,202);
 assert.equal(JSON.stringify(nonexistent.body),JSON.stringify({accepted:true,resend_after:60}));
 const initiator=await actor();
 const requested=await auth.requestPasswordReset(initiator,{email});
 assert.deepEqual(requested.body,nonexistent.body);
 await auth.deliverPasswordResetOne();
 const message=messages.get(email);
 assert.equal(message?.purpose,'password_reset');
 assert(message?.code);
 assert.equal((await auth.bootstrap(ctx)).status,200);
 await assert.rejects(auth.verifyPasswordReset(initiator,{email,code:'999999'}),e=>codeOf(e,'CODE_INVALID_OR_EXPIRED'));
 const confirmed=await auth.verifyPasswordReset(initiator,{email,code:message!.code});
 const token=(confirmed.body as any).reset_token;
 assert.equal(typeof token,'string');
 await assert.rejects(auth.verifyPasswordReset(initiator,{email,code:message!.code}),e=>codeOf(e,'CODE_INVALID_OR_EXPIRED'));
 const stranger=await actor();
 await assert.rejects(auth.completePasswordReset(stranger,{email,reset_token:token,password:'new-strong-password-123'}),e=>codeOf(e,'RESET_INVALID_OR_EXPIRED'));
 const completed=await auth.completePasswordReset(initiator,{email,reset_token:token,password:'new-strong-password-123'});
 assert.equal((completed.body as any).password_changed,true);
 await assert.rejects(auth.completePasswordReset(initiator,{email,reset_token:token,password:'new-strong-password-123'}),e=>codeOf(e,'RESET_INVALID_OR_EXPIRED'));
 await assert.rejects(auth.bootstrap(ctx),e=>codeOf(e,'SESSION_REVOKED'));
 const loginCtx=await actor();
 await assert.rejects(auth.login(loginCtx,{email,password:profile.password,device_id:randomUUID()}),e=>codeOf(e,'INVALID_CREDENTIALS'));
 assert.equal((await auth.login(loginCtx,{email,password:'new-strong-password-123',device_id:randomUUID()})).status,200);
});
