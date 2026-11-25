import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { WebAuth } from './web-auth.ts';
import { webHandler } from './web-http.ts';

assert(process.env.DATABASE_URL && process.env.TEST_ADMIN_URL);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const admin=new pg.Pool({connectionString:process.env.TEST_ADMIN_URL});
const auth=new WebAuth(pool,randomBytes(32),{async send(){throw Error('Unexpected email');}},{async lookup(){return null;}});
const error=(code:string)=>(e:unknown)=>e instanceof Error&&'code' in e&&e.code===code;
const newSession=async(userId:string)=>{
 const ctx={browser:await auth.browser(),requestId:randomUUID(),access:undefined as string|undefined};
 const family=await auth.tx(ctx,db=>auth.newFamily(db,ctx,userId,randomUUID()));
 ctx.access=family.access;
 return {ctx,family};
};
const newAccount=async(email=randomUUID()+'@example.test')=>{
 const id=randomUUID();
 await admin.query("INSERT INTO control.users(id,login,password_hash,email_verified_at) VALUES($1,$2,'isolated-test',clock_timestamp())",[id,email]);
 return {id,...await newSession(id)};
};

test('staff transition, company display name and temporary access stay tenant-scoped and audited',async t=>{
 t.after(async()=>{await pool.end();await admin.end();});
 const owner=await newAccount('suprunmvp+isolated-test@example.test');
 const reviewer=await newAccount();
 const manager=await newAccount();
 const internalAdmin=await newAccount();
 const customer=await newAccount();
 const employee=await newAccount();
 const org=randomUUID(),other=randomUUID(),membership=randomUUID();
 await admin.query("INSERT INTO control.organizations(id,max_calls,inn,legal_name,legal_address) VALUES($1,1,'7707083893','ООО Юридическое','Москва'),($2,1,'7707000002','ООО Другая','Тверь')",[org,other]);
 await admin.query("INSERT INTO control.memberships(id,organization_id,user_id,role_id) VALUES($1,$2,$3,'owner'),($4,$2,$5,'employee')",[membership,org,customer.id,randomUUID(),employee.id]);
 await admin.query('UPDATE control.organizations SET owner_membership_id=$1 WHERE id=$2',[membership,org]);
 await admin.query("INSERT INTO web_auth.internal_staff(user_id,role) VALUES($1,'reviewer'),($2,'admin')",[reviewer.id,internalAdmin.id]);
 // Exercise the operator script against a fixture-only verified identity.
 const bootstrap=(await readFile(new URL('./ops/bootstrap-system-owner.sql',import.meta.url),'utf8'))
  .replace('suprunmvp@gmail.com','suprunmvp+isolated-test@example.test');
 await admin.query(bootstrap);
 await admin.query(bootstrap);
 assert.equal((await auth.internalSession(owner.ctx)).body.role,'owner');
 await assert.rejects(auth.setInternalStaff(internalAdmin.ctx,{user_id:manager.id,role:'manager'}),error('INTERNAL_ACCESS_DENIED'));
 await assert.rejects(auth.setInternalStaff(owner.ctx,{user_id:owner.id,role:null}),error('PROTECTED_OWNER'));
 await assert.rejects(admin.query("UPDATE control.users SET active=false WHERE id=$1",[owner.id]),error('42501'));
 await assert.rejects(admin.query("UPDATE web_auth.internal_staff SET role='admin' WHERE user_id=$1",[owner.id]),error('42501'));
 await assert.rejects(admin.query('DELETE FROM web_auth.internal_staff WHERE user_id=$1',[owner.id]),error('42501'));
 assert((await auth.internalStaff(owner.ctx)).body.items.some(row=>row.user_id===reviewer.id&&row.role==='reviewer'));
 await auth.setInternalStaff(owner.ctx,{user_id:manager.id,role:'manager'});
 const decision={decision:'verified',evidence_reference:'evidence-123',explanation:'Проверены документы'};
 assert((await auth.internalSession(manager.ctx)).body.capabilities.includes('organizations:review'));
  assert((await auth.internalSession(manager.ctx)).body.capabilities.includes('staff:list'));
  assert(!(await auth.internalSession(manager.ctx)).body.capabilities.includes('staff:manage'));
 await assert.rejects(auth.openInternalClient(reviewer.ctx,{organization_id:org}),error('INTERNAL_ACCESS_DENIED'));
 assert.equal((await auth.reviewOrganization(manager.ctx,other,decision)).body.verification_status,'verified');
 const directory=(await auth.internalOrganizations(manager.ctx)).body.items.find(row=>row.id===org);
 assert.equal(directory.legal_address,null);
 assert.equal(directory.created_owner_email,null);

 await auth.selectOrganization(customer.ctx,{organization_id:org,expected_context_epoch:null});
 await auth.selectOrganization(employee.ctx,{organization_id:org,expected_context_epoch:null});
 await assert.rejects(auth.renameOrganization(employee.ctx,org,{display_name:'Запрещено'}),error('ORGANIZATION_ACCESS_DENIED'));
 await assert.rejects(auth.renameOrganization(customer.ctx,other,{display_name:'Запрещено'}),error('ORGANIZATION_ACCESS_DENIED'));
 await assert.rejects(auth.renameOrganization(customer.ctx,org,{display_name:'Имя',inn:'7707000002'}),error('INVALID_REQUEST'));
 const origin='https://platform.example.test';
 const handle=webHandler(auth,origin);
 const server=createServer(async(req,res)=>{
  if(!await handle(req,res)){res.writeHead(404);res.end();}
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const address=server.address();
 assert(address&&typeof address!=='string');
 const route='http://127.0.0.1:'+address.port+'/v1/organizations/'+org+'/display-name';
 const headers={
  cookie:'__Host-sashatel-browser='+customer.ctx.browser+'; __Host-sashatel-access='+customer.ctx.access,
  'content-type':'application/json','x-csrf-token':auth.csrf(customer.ctx.browser),origin,
 };
 const sendRename=(overrides:Record<string,string>)=>fetch(route,{
  method:'PATCH',headers:{...headers,...overrides},body:JSON.stringify({display_name:'  Короткое имя  '}),
 });
 assert.equal((await sendRename({origin:'https://other.example.test'})).status,403);
 assert.equal((await sendRename({'x-csrf-token':'wrong-token'})).status,403);
 const renameResponse=await sendRename({});
 assert.equal(renameResponse.status,200);
 const renamed=(await renameResponse.json()).organization;
 assert.equal(renamed.display_name,'Короткое имя');
 assert.equal(renamed.legal_name,'ООО Юридическое');
 const {rows:[requisites]}=await admin.query('SELECT inn,legal_name,legal_address FROM control.organizations WHERE id=$1',[org]);
 assert.deepEqual(requisites,{inn:'7707083893',legal_name:'ООО Юридическое',legal_address:'Москва'});
 assert.equal((await auth.organizations(customer.ctx)).body.items[0].display_name,'Короткое имя');

 await t.test('internal client creation binds the lookup to staff and writes once',async()=>{
  const inn='7736050003',lookupId=randomUUID(),key=randomUUID();
  await admin.query(`INSERT INTO web_auth.lookups VALUES($1,$2,$3,'ООО По ИНН','Москва',clock_timestamp()+interval '10 minutes')`,
    [lookupId,owner.id,inn]);
  const payload={lookup_id:lookupId,inn,display_name:'  Клиент в кабинете  '};
  const endpoint='http://127.0.0.1:'+address.port+'/v1/internal/organizations';
  const post=(ctx:typeof owner.ctx,overrides:Record<string,string>={})=>fetch(endpoint,{
   method:'POST',body:JSON.stringify(payload),
   headers:{'content-type':'application/json',origin,'idempotency-key':key,'x-csrf-token':auth.csrf(ctx.browser),
    cookie:'__Host-sashatel-browser='+ctx.browser+'; __Host-sashatel-access='+ctx.access,...overrides},
  });
  assert((await auth.internalSession(owner.ctx)).body.capabilities.includes('organizations:create'));
  assert((await auth.internalSession(internalAdmin.ctx)).body.capabilities.includes('organizations:create'));
  assert(!(await auth.internalSession(manager.ctx)).body.capabilities.includes('organizations:create'));
  assert.equal((await post(owner.ctx,{origin:'https://other.example.test'})).status,403);
  assert.equal((await post(owner.ctx,{'x-csrf-token':'wrong-token'})).status,403);
  for(const actor of [customer,reviewer,manager])assert.equal((await post(actor.ctx)).status,403);
  assert.equal((await post(internalAdmin.ctx)).status,404);
  await assert.rejects(auth.createInternalOrganization(owner.ctx,{...payload,inn:'7736050001'},key),error('INN_INVALID'));
  const anotherSession=await newSession(owner.id);
  const responses=await Promise.all([post(owner.ctx),post(anotherSession.ctx)]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,201]);
  const [first,second]=await Promise.all(responses.map(response=>response.json()));
  assert.deepEqual(first,second);
  const newId=first.organization.id;
  assert.equal(first.organization.legal_name,'ООО По ИНН');
  assert.equal(first.organization.display_name,'Клиент в кабинете');
  assert.equal(first.organization.verification_status,'unverified');
  await assert.rejects(auth.createInternalOrganization(owner.ctx,{...payload,display_name:'Другое имя'},key),error('IDEMPOTENCY_CONFLICT'));
  const replay=await auth.createInternalOrganization(owner.ctx,{...payload,lookup_id:randomUUID()},key);
  assert.equal(replay.body.organization.id,newId);
  const {rows:[state]}=await admin.query(`SELECT o.owner_membership_id, s.telephony, s.active AS subscription_active,
    (SELECT count(*)::int FROM control.memberships m WHERE m.organization_id=o.id) AS memberships,
    (SELECT count(*)::int FROM web_auth.audit a WHERE a.organization_id=o.id AND a.actor_user_id=$2 AND a.action='internal.organization_created') AS events
    FROM control.organizations o JOIN control.subscriptions s ON s.organization_id=o.id WHERE o.id=$1`,[newId,owner.id]);
  assert.deepEqual(state,{owner_membership_id:null,telephony:false,subscription_active:false,memberships:0,events:1});
  await auth.reviewOrganization(owner.ctx,newId,decision);
  await assert.rejects(auth.createInternalOrganization(owner.ctx,payload,randomUUID()),error('ORGANIZATION_ALREADY_EXISTS'));
 });

 await t.test('responsible manager assignment and audit',async()=>{
  const candidates=(await auth.responsibleManagerCandidates(owner.ctx)).body.items;

  assert(candidates.some(row=>row.user_id===manager.id));
  assert(!candidates.some(row=>row.user_id===customer.id));

  await assert.rejects(
   auth.responsibleManagerCandidates(manager.ctx),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.setResponsibleManager(manager.ctx,{
    organization_id:org,user_id:manager.id
   }),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.setResponsibleManager(owner.ctx,{
    organization_id:org,user_id:customer.id
   }),
   error('INVALID_RESPONSIBLE_MANAGER')
  );

  await auth.setResponsibleManager(owner.ctx,{
   organization_id:org,user_id:manager.id
  });

  await auth.setResponsibleManager(owner.ctx,{
   organization_id:org,user_id:manager.id
  });

  const fresh=await newSession(owner.id);

  const assigned=(await auth.internalOrganizations(
   fresh.ctx,{manager:manager.id}
  )).body.items;

  assert.deepEqual(assigned.map(row=>row.id),[org]);
  assert.equal(assigned[0].responsible_manager_active,true);

  await auth.setResponsibleManager(internalAdmin.ctx,{
   organization_id:org,user_id:internalAdmin.id
  });

  await auth.setResponsibleManager(owner.ctx,{
   organization_id:org,user_id:null
  });

  assert((await auth.internalOrganizations(
   owner.ctx,{manager:'unassigned'}
  )).body.items.some(row=>row.id===org));

  const {rows:[events]}=await admin.query(
   "SELECT count(*)::int AS count FROM web_auth.audit WHERE organization_id=$1 AND action='internal.responsible_manager_changed'",
   [org]
  );

  assert.equal(events.count,3);
 });

 await t.test('internal staff permissions and access restoration',async()=>{
  const admins=(await auth.internalStaff(internalAdmin.ctx)).body.items;
  const managers=(await auth.internalStaff(manager.ctx)).body.items;

  assert(admins.some(row=>row.user_id===manager.id));
  assert(managers.some(row=>row.user_id===internalAdmin.id));

  await assert.rejects(
   auth.internalStaff(customer.ctx),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.setInternalStaff(manager.ctx,{user_id:manager.id,role:'admin'}),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.setInternalStaff(internalAdmin.ctx,{user_id:owner.id,role:'manager'}),
   error('PROTECTED_OWNER')
  );

  await assert.rejects(
   auth.setInternalStaff(internalAdmin.ctx,{user_id:internalAdmin.id,role:null}),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.setInternalStaff(internalAdmin.ctx,{user_id:customer.id,role:'admin'}),
   error('INTERNAL_ACCESS_DENIED')
  );

  await auth.setInternalStaff(internalAdmin.ctx,{user_id:manager.id,role:null});

  await assert.rejects(
   auth.internalSession(manager.ctx),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.reviewOrganization(manager.ctx,org,decision),
   error('INTERNAL_ACCESS_DENIED')
  );

  await auth.setInternalStaff(internalAdmin.ctx,{user_id:manager.id,role:'admin'});
  assert.equal((await auth.internalSession(manager.ctx)).body.role,'admin');

  await auth.setInternalStaff(owner.ctx,{user_id:manager.id,role:'manager'});
  assert.equal((await auth.internalSession(manager.ctx)).body.role,'manager');
 });

 await t.test('verification revocation is scoped and audited',async()=>{
  const payload={
   evidence_reference:'contract-revoked-123',
   explanation:'Договор с организацией расторгнут'
  };

  await assert.rejects(
   auth.revokeOrganizationVerification(customer.ctx,other,payload),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.revokeOrganizationVerification(reviewer.ctx,other,payload),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.revokeOrganizationVerification(manager.ctx,org,payload),
   error('REVOCATION_REQUIRES_VERIFIED')
  );

  assert((await auth.internalSession(manager.ctx)).body.capabilities
    .includes('organizations:revoke_verification'));

  const result=await auth.revokeOrganizationVerification(manager.ctx,other,payload);
  assert.equal(result.body.verification_status,'unverified');

  await assert.rejects(
   auth.revokeOrganizationVerification(manager.ctx,other,payload),
   error('REVOCATION_REQUIRES_VERIFIED')
  );

  const {rows:[history]}=await admin.query(
   "SELECT count(*)::int AS n FROM web_auth.organization_reviews WHERE organization_id=$1 AND outcome='revoked'",
   [other]
  );

  assert.equal(history.n,1);

  const {rows:[event]}=await admin.query(
   "SELECT count(*)::int AS n FROM web_auth.audit WHERE organization_id=$1 AND actor_user_id=$2 AND action='internal.organization_verification_revoked'",
   [other,manager.id]
  );

  assert.equal(event.n,1);

  await auth.reviewOrganization(internalAdmin.ctx,other,decision);
 });

 await t.test('billing payments, debits and due dates are scoped and audited',async()=>{
  const invoice=randomUUID();

  await admin.query(
   "INSERT INTO control.billing_obligations(organization_id,id,issued_at,due_at,amount_kopeks,state) VALUES($1,$2,clock_timestamp()-interval '10 days',clock_timestamp()-interval '1 day',10000,'issued')",
   [org,invoice]
  );

  const payment={
   organization_id:org,kind:'payment',amount_kopeks:'15000',
   reference:'bank-'+randomUUID(),
   reason:'Подтверждено поступление оплаты'
  };

  const key=randomUUID();

  await assert.rejects(
   auth.recordBillingTransaction(manager.ctx,payment,key),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.billingSummary(customer.ctx,org),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.billingHistory(manager.ctx,org),
   error('INTERNAL_ACCESS_DENIED')
  );

  const created=await auth.recordBillingTransaction(owner.ctx,payment,key);
  assert.equal(created.status,201);

  const replay=await auth.recordBillingTransaction(owner.ctx,payment,key);
  assert.equal(replay.status,200);
  assert.equal(replay.body.transaction_id,created.body.transaction_id);

  await assert.rejects(
   auth.recordBillingTransaction(owner.ctx,{...payment,amount_kopeks:'16000'},key),
   error('IDEMPOTENCY_CONFLICT')
  );

  await assert.rejects(
   auth.recordBillingTransaction(owner.ctx,payment,randomUUID()),
   error('PAYMENT_REFERENCE_EXISTS')
  );

  let summary=(await auth.billingSummary(owner.ctx,org)).body.summary;

  assert.equal(summary.payments_kopeks,'15000');
  assert.equal(summary.overdue_kopeks,'0');
  assert.equal(summary.outstanding_invoices_kopeks,'0');
  assert.equal(summary.balance_kopeks,'15000');

  await auth.recordBillingTransaction(internalAdmin.ctx,{
   ...payment,kind:'debit',amount_kopeks:'2000',
   reference:'adjustment-'+randomUUID(),
   reason:'Ручная финансовая корректировка'
  },randomUUID());

  summary=(await auth.billingSummary(owner.ctx,org)).body.summary;
  assert.equal(summary.balance_kopeks,'13000');

  const nextInvoice=randomUUID();
  await admin.query(
   "INSERT INTO control.billing_obligations(organization_id,id,issued_at,due_at,amount_kopeks,state) VALUES($1,$2,clock_timestamp()-interval '10 days',clock_timestamp()-interval '1 day',20000,'issued')",
   [org,nextInvoice]
  );

  const date=new Date(Date.now()+86400000*7).toISOString();

  const change={
   organization_id:org,invoice_id:nextInvoice,
   due_at:date,reason:'Согласована отсрочка платежа'
  };

  await assert.rejects(
   auth.changeBillingDueDate(manager.ctx,change),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.changeBillingDueDate(owner.ctx,{...change,organization_id:other}),
   error('RESOURCE_NOT_FOUND')
  );

  await auth.changeBillingDueDate(internalAdmin.ctx,change);

  summary=(await auth.billingSummary(owner.ctx,org)).body.summary;
  assert.equal(new Date(summary.next_payment_at).toISOString(),date);
  assert.equal(summary.overdue_kopeks,'0');

  const history=(await auth.billingHistory(owner.ctx,org)).body.items;
  assert.equal(history.length,2);

  const {rows:[audit]}=await admin.query(
   "SELECT count(*)::int AS n FROM web_auth.audit WHERE organization_id=$1 AND action='internal.billing_transaction'",
   [org]
  );

  assert.equal(audit.n,2);
 });

 await t.test('billing schedule and invoice reads preserve organization scope',async()=>{
  const date=new Date(Date.now()+86400000*30)
   .toISOString().slice(0,10);

  const input={
   organization_id:org,next_period_end:date,
   reason:'Согласована дата расчётного периода'
  };

  await assert.rejects(
   auth.setBillingSchedule(manager.ctx,input),
   error('INTERNAL_ACCESS_DENIED')
  );

  await auth.setBillingSchedule(owner.ctx,input);

  await auth.setBillingSchedule(owner.ctx,input);

  const summary=(await auth.billingSummary(owner.ctx,org)).body.summary;

  assert.equal(summary.next_period_end,date);
  assert.equal(summary.balance_kopeks,'13000');

  const invoices=(await auth.billingInvoices(owner.ctx,org,true)).body.items;

  assert.equal(invoices.length,2);
  assert(invoices.some((item:{status:string})=>item.status==='paid'));
  assert(invoices.some((item:{status:string})=>item.status==='partially_paid'));

  const foreign=(await auth.billingInvoices(owner.ctx,other,true)).body.items;
  assert.equal(foreign.length,0);

  await assert.rejects(
   auth.billingInvoices(manager.ctx,org,true),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.clientBilling(owner.ctx,org),
   error('ORGANIZATION_ACCESS_DENIED')
  );

  const {rows:[audit]}=await admin.query(
   "SELECT count(*)::int AS n FROM web_auth.audit WHERE organization_id=$1 AND action='internal.billing_schedule_changed'",
   [org]
  );

  assert.equal(audit.n,1);
 });


 await t.test('billing HTTP routes enforce session and organization permissions',async()=>{
  const base='http://127.0.0.1:'+address.port;

  const get=(path:string,ctx:typeof owner.ctx)=>fetch(base+path,{
   headers:{
    cookie:'__Host-sashatel-browser='+ctx.browser+
     '; __Host-sashatel-access='+ctx.access
   }
  });

  const billing='/v1/organizations/'+org+'/billing';

  const response=await get(billing,customer.ctx);
  assert.equal(response.status,200);

  const {summary}=await response.json();
  assert.equal(summary.balance_kopeks,'13000');

  assert.equal((await get(billing,employee.ctx)).status,403);
  assert.equal((await get(billing,manager.ctx)).status,403);
  assert.equal((await get(
   '/v1/organizations/'+other+'/billing',customer.ctx
  )).status,403);

  const invoices=await get(billing+'/invoices',customer.ctx);
  assert.equal(invoices.status,200);
  assert.equal((await invoices.json()).items.length,2);

  const internal='/v1/internal/billing/summary?organization_id='+org;
  assert.equal((await get(internal,owner.ctx)).status,200);
  assert.equal((await get(internal,internalAdmin.ctx)).status,200);
  assert.equal((await get(internal,customer.ctx)).status,403);
  assert.equal((await get(internal,manager.ctx)).status,403);

  const history='/v1/internal/billing/history?organization_id='+org;
  assert.equal((await get(history,owner.ctx)).status,200);

  const post=await fetch(base+'/v1/internal/billing/transactions',{
   method:'POST',
   headers:{
    ...headers,
    'x-csrf-token':'invalid',
    'idempotency-key':randomUUID()
   },
   body:JSON.stringify({})
  });

  assert.equal(post.status,403);
 });


 await t.test('advance allocation and internal overview use actual ledger data',async()=>{
  const {rows:[settled]}=await admin.query(
   "SELECT coalesce(sum(amount_kopeks),0)::text AS total FROM control.billing_payment_allocations WHERE organization_id=$1",
   [org]
  );

  assert.equal(settled.total,'15000');

  const {rows:[invoice]}=await admin.query(
   "SELECT paid_kopeks::text FROM control.billing_obligations WHERE organization_id=$1 AND amount_kopeks=20000",
   [org]
  );

  assert.equal(invoice.paid_kopeks,'5000');

  const {rows:[date]}=await admin.query(
   "SELECT (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date::text AS today"
  );

  const overview=(await auth.billingOverview(
   owner.ctx,date.today,date.today
  )).body.overview;

  assert.equal(overview.payments_kopeks,'15000');
  assert.equal(overview.debits_kopeks,'2000');
  assert.equal(overview.daily.length,1);
  assert.equal(overview.daily[0].payments_kopeks,'15000');
  assert(overview.organizations_count>=2);

  assert.equal((await auth.billingOverview(
   manager.ctx,date.today,date.today
  )).status,200);

  await assert.rejects(
   auth.billingOverview(customer.ctx,date.today,date.today),
   error('INTERNAL_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.billingOverview(owner.ctx,'2026-02-30',date.today),
   error('INVALID_DATE_RANGE')
  );

  const endpoint='http://127.0.0.1:'+address.port+
   '/v1/internal/billing/overview?from='+date.today+'&to='+date.today;

  const response=await fetch(endpoint,{
   headers:{
    cookie:'__Host-sashatel-browser='+owner.ctx.browser+
     '; __Host-sashatel-access='+owner.ctx.access
   }
  });

  assert.equal(response.status,200);
  assert.equal((await response.json()).overview.payments_kopeks,'15000');

  const summary=(await auth.billingSummary(owner.ctx,org)).body.summary;
  assert.equal(summary.balance_kopeks,'13000');
 });


 await t.test('organization staff directory is scoped to authorized membership',async()=>{
  const directory=(await auth.organizationStaff(customer.ctx,org)).body.items;

  assert.equal(directory.length,2);

  const customerRow=directory.find(
   (row:{user_id:string})=>row.user_id===customer.id
  );

  const employeeRow=directory.find(
   (row:{user_id:string})=>row.user_id===employee.id
  );

  assert.equal(customerRow.role,'owner');
  assert.equal(employeeRow.role,'manager');
  assert.equal(customerRow.email_verified,true);
  assert.equal(customerRow.active,true);
  assert(!('password_hash' in customerRow));

  await assert.rejects(
   auth.organizationStaff(employee.ctx,org),
   error('ORGANIZATION_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.organizationStaff(customer.ctx,other),
   error('ORGANIZATION_ACCESS_DENIED')
  );

  await assert.rejects(
   auth.organizationStaff(manager.ctx,org),
   error('ORGANIZATION_ACCESS_DENIED')
  );

  const endpoint='http://127.0.0.1:'+address.port+
   '/v1/organizations/'+org+'/staff';

  const response=await fetch(endpoint,{headers});

  assert.equal(response.status,200);
  assert.equal((await response.json()).items.length,2);
 });

 const opened=(await auth.openInternalClient(manager.ctx,{organization_id:org})).body.context;
 assert.deepEqual(opened.permissions,['organization:read']);
 assert.equal(opened.organization.id,org);
 assert.equal(opened.organization.display_name,'Короткое имя');
 assert(!('role' in opened.organization)&&!('membership_id' in opened.organization));
 assert.deepEqual((await auth.organizations(manager.ctx)).body.items,[]);
 assert.equal((await auth.bootstrap(manager.ctx)).body.context,null);
 await assert.rejects(auth.selectOrganization(manager.ctx,{organization_id:org,expected_context_epoch:null}),error('RESOURCE_NOT_FOUND'));
 await assert.rejects(auth.renameOrganization(manager.ctx,org,{display_name:'Служебное имя'}),error('ORGANIZATION_ACCESS_DENIED'));
 await assert.rejects(auth.openInternalClient(manager.ctx,{organization_id:other}),error('INTERNAL_CONTEXT_ACTIVE'));
 const secondSession=await newSession(manager.id);
 await assert.rejects(auth.internalClientContext(secondSession.ctx),error('RESOURCE_NOT_FOUND'));
 await auth.closeInternalClient(secondSession.ctx,{context_id:opened.id});
 assert.equal((await auth.internalClientContext(manager.ctx)).body.context.id,opened.id);
 await auth.closeInternalClient(manager.ctx,{context_id:opened.id});
 await assert.rejects(auth.internalClientContext(manager.ctx),error('RESOURCE_NOT_FOUND'));
 const expired=(await auth.openInternalClient(manager.ctx,{organization_id:org})).body.context;
 await admin.query("UPDATE web_auth.internal_client_contexts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id]);
 await assert.rejects(auth.internalClientContext(manager.ctx),error('RESOURCE_NOT_FOUND'));
 await auth.openInternalClient(manager.ctx,{organization_id:other});
 await auth.setInternalStaff(owner.ctx,{user_id:manager.id,role:null});
 await assert.rejects(auth.internalClientContext(manager.ctx),error('RESOURCE_NOT_FOUND'));
 await assert.rejects(auth.openInternalClient(manager.ctx,{organization_id:org}),error('INTERNAL_ACCESS_DENIED'));
 await auth.setInternalStaff(owner.ctx,{user_id:manager.id,role:'manager'});
 await assert.rejects(auth.internalClientContext(manager.ctx),error('RESOURCE_NOT_FOUND'));
 assert.equal((await auth.internalSession(reviewer.ctx)).body.role,'reviewer');
 const {rows:audit}=await admin.query('SELECT action FROM web_auth.audit WHERE target_id=ANY($1::uuid[])',[ [owner.id,manager.id,org,opened.id] ]);
 assert.equal(audit.filter(e=>e.action==='internal.system_owner_bootstrapped').length,1);
 for(const action of ['internal.staff_access_changed','organization.display_name_changed','internal.client_context_opened','internal.client_context_closed']){
  assert(audit.some(row=>row.action===action),action);
 }
});
