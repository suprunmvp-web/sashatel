import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {WebAuth,type MailPort} from './web-auth.ts';

assert(process.env.DATABASE_URL&&process.env.TEST_ADMIN_URL);
const runtime=new pg.Pool({connectionString:process.env.DATABASE_URL});
const admin=new pg.Pool({connectionString:process.env.TEST_ADMIN_URL});
const delivered=new Map<string,string>();
const mail:MailPort={async send(m){if(m.code)delivered.set(m.email,m.code);}};
const auth=new WebAuth(runtime,randomBytes(32),mail,{async lookup(){return null;}});
const error=(code:string)=>(e:unknown)=>e instanceof Error&&'code' in e&&e.code===code;
async function signup(){
 const ctx={browser:await auth.browser(),requestId:randomUUID(),access:undefined as string|undefined,refresh:undefined as string|undefined};
 const email=randomUUID()+'@example.test';
 const reg=await auth.register(ctx,{first_name:'Анна',last_name:'Иванова',phone:'+79261234567',email,password:'strong-password-123'},randomUUID());
 await auth.deliverOne();
 const confirmation=await auth.verify(ctx,{challenge_id:(reg.body as any).challenge_id,code:delivered.get(email)});
 ctx.access=confirmation.cookies?.access;ctx.refresh=confirmation.cookies?.refresh;
 return {ctx,email,user:(await auth.tx(ctx,db=>auth.identity(db,ctx))).user};
}
test('organization review: duplicates, staff gate, verified-only uniqueness and audit',async t=>{
 t.after(async()=>{await runtime.end();await admin.end();});
 const {ctx,user}=await signup();
 const inn='9'+String(BigInt('0x'+randomBytes(5).toString('hex'))%1000000000n).padStart(9,'0');
 const a=randomUUID(),b=randomUUID(),c=randomUUID();
 const insert=async(id:string)=>admin.query('INSERT INTO control.organizations(id,max_calls,inn,legal_name,verification_status) VALUES($1,1,$2,$3,$4)',[id,inn,'ООО Тест','unverified']);
 await insert(a);await insert(b);
 const {rows:[cnt]}=await admin.query("SELECT count(*)::int AS n FROM control.organizations WHERE inn=$1 AND verification_status='unverified'",[inn]);
 assert.equal(cnt.n,2);
 await assert.rejects(auth.internalSession(ctx),error('INTERNAL_ACCESS_DENIED'));
 await assert.rejects(auth.internalOrganizations(ctx),error('INTERNAL_ACCESS_DENIED'));
 await assert.rejects(auth.reviewOrganization(ctx,a,{decision:'verified',evidence_reference:'document-check-123',explanation:'Документы проверены сотрудником'}),error('INTERNAL_ACCESS_DENIED'));
 await admin.query("INSERT INTO web_auth.internal_staff(user_id,role) VALUES($1,'reviewer')",[user.id]);
 assert.equal((await auth.internalSession(ctx)).body.role,'reviewer');
 await admin.query("UPDATE web_auth.internal_staff SET role='owner' WHERE user_id=$1",[user.id]);
 assert.equal((await auth.internalSession(ctx)).body.role,'owner');
 await admin.query("UPDATE web_auth.internal_staff SET role='reviewer' WHERE user_id=$1",[user.id]);
 const list=await auth.internalOrganizations(ctx);
 assert((list.body as any).items.some((o:any)=>o.id===a));
 const page1=(await auth.internalOrganizations(ctx,{limit:1})).body as any;
 assert.equal(page1.items.length,1);
 assert.equal(page1.next_offset,1);
 const page2=(await auth.internalOrganizations(ctx,{limit:1,offset:page1.next_offset})).body as any;
 assert.equal(page2.items.length,1);
 assert.notEqual(page2.items[0].id,page1.items[0].id);
 await assert.rejects(auth.internalOrganizations(ctx,{limit:201}),error('INVALID_PAGE'));
 const decision={decision:'verified',evidence_reference:'document-check-123',explanation:'Документы проверены сотрудником'};
 const approved=await auth.reviewOrganization(ctx,a,decision);
 assert.equal((approved.body as any).verification_status,'verified');
 await assert.rejects(auth.reviewOrganization(ctx,b,decision),error('VERIFIED_ORGANIZATION_EXISTS'));
 await insert(c); // DB permits unverified duplicates; API rejects new claims.
 await assert.rejects(
   admin.query("UPDATE control.organizations SET verification_status='verified' WHERE id=$1",[c]),
   error('23505'),
 );
 const lookup=randomUUID();
 await admin.query(
  "INSERT INTO web_auth.lookups(id,user_id,inn,legal_name,legal_address,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes')",
  [lookup,user.id,inn,'ООО Тест','Москва'],
 );
 await assert.rejects(auth.createOrganization(ctx,{lookup_id:lookup,confirm:true},randomUUID()),error('ORGANIZATION_ALREADY_EXISTS'));
 const rejected=await auth.reviewOrganization(ctx,b,{decision:'rejected',evidence_reference:'document-check-124',explanation:'Полномочия заявителя не подтверждены'});
 assert.equal((rejected.body as any).verification_status,'rejected');
 const appeal={evidence_reference:'new-documents-125',explanation:'Предоставлены новые подтверждения полномочий'};
 await assert.rejects(auth.reopenOrganization(ctx,b,appeal),error('INTERNAL_ACCESS_DENIED'));
 await admin.query("UPDATE web_auth.internal_staff SET role='owner' WHERE user_id=$1",[user.id]);
 const reopened=await auth.reopenOrganization(ctx,b,appeal);
 assert.equal((reopened.body as any).verification_status,'unverified');
 await assert.rejects(auth.reopenOrganization(ctx,b,appeal),error('REOPEN_REQUIRES_REJECTED'));
 const {rows:reviews}=await admin.query("SELECT outcome,evidence_reference FROM web_auth.organization_reviews WHERE organization_id=ANY($1::uuid[]) ORDER BY recorded_at",[ [a,b] ]);
 assert.deepEqual(reviews.map(x=>x.outcome).sort(),['rejected','reopened','verified']);
 const {rows:[subscription]}=await admin.query('SELECT count(*)::int AS n FROM control.subscriptions WHERE organization_id=ANY($1::uuid[]) AND telephony=true',[[a,b]]);
 assert.equal(subscription.n,0);
 await admin.query("UPDATE web_auth.internal_staff SET active=false WHERE user_id=$1",[user.id]);
 await assert.rejects(auth.internalOrganizations(ctx),error('INTERNAL_ACCESS_DENIED'));
 await admin.query("DELETE FROM web_auth.audit WHERE organization_id=ANY($1::uuid[])",[[a,b,c]]);
 await admin.query("DELETE FROM web_auth.organization_reviews WHERE organization_id=ANY($1::uuid[])",[[a,b,c]]);
 await admin.query("DELETE FROM control.organizations WHERE id=ANY($1::uuid[])",[[a,b,c]]);
});
