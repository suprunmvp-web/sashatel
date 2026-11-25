import type { IncomingMessage,ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError } from './control.ts';
import { WebAuth, type WebResult } from './web-auth.ts';

export function webHandler(auth:WebAuth,origin:string) {
  if(new URL(origin).origin!==origin) throw new Error('Exact WEB_ORIGIN required');
  return async(req:IncomingMessage,res:ServerResponse) => {
    const path=req.url?.split('?')[0]??'';
    const displayNameRoute=/^\/v1\/organizations\/([^/]+)\/display-name$/.exec(path);
    const clientBillingRoute=new RegExp('^/v1/organizations/([^/]+)/billing(?:/(invoices))?$').exec(path);
    const organizationStaffRoute=new RegExp(
      '^/v1/organizations/([^/]+)/staff(?:/(access))?$'
    ).exec(path);

    const invitationRoute=new RegExp(
      '^/v1/organizations/([^/]+)/invitations(?:/(revoke|resend))?$'
    ).exec(path);

    if(!invitationRoute&&
       path!=='/v1/account/invitations'&&
       path!=='/v1/account/invitations/accept'&&
       !organizationStaffRoute&&!clientBillingRoute&&!displayNameRoute&&!path.startsWith('/v1/auth/')&&!['/v1/account','/v1/organizations','/v1/organizations/lookup','/v1/organizations/suggest','/v1/session/organization'].includes(path)&&!path.startsWith('/v1/organizations/creation-status/')&&!path.startsWith('/v1/internal/')) return false;
    const requestId=randomUUID();
    res.setHeader('x-request-id',requestId);
    res.setHeader('content-type','application/json');
    res.setHeader('cache-control','no-store');
    const parsed:Record<string,string>={};
    for(const part of (req.headers.cookie??'').split(';')) {
      const index=part.indexOf('=');
      if(index>0) parsed[part.slice(0,index).trim()]=part.slice(index+1);
    }
    const existing=parsed['__Host-sashatel-preauth']??parsed['__Host-sashatel-browser'];
    const setCookies:string[]=[];
    const set=(name:string,value:string,maxAge:number) => setCookies.push(name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+maxAge);
    const send=(result:WebResult) => {
      if(result.cookies?.refresh==='') set('__Host-sashatel-browser','',0);
      if(result.cookies?.refresh) set('__Host-sashatel-browser',existing!,2592000);
      for(const [name,value] of Object.entries(result.cookies??{})) set('__Host-sashatel-'+name,value,value?(name==='access'?300:604800):0);
      if(setCookies.length) res.setHeader('set-cookie',setCookies);
      if(result.replayed) res.setHeader('idempotency-replayed','true');
      res.writeHead(result.status);res.end(result.body===undefined?'':JSON.stringify(result.body));
    };
    try {
      if((req.method==='POST'||req.method==='PATCH')&&req.headers.origin!==origin) throw new ApiError(403,'CSRF_INVALID');
      const browser=await auth.browser(existing,parsed['__Host-sashatel-refresh']??parsed['__Host-sashatel-access']);
      if(browser!==existing) set('__Host-sashatel-preauth',browser,86400);
      const ctx={browser,access:parsed['__Host-sashatel-access'],refresh:parsed['__Host-sashatel-refresh'],requestId};
      if(req.method==='GET'&&path==='/v1/auth/csrf') {
        send({status:200,body:{csrf_token:auth.csrf(browser)}});return true;
      }
      if(req.method==='GET') {
        if(path==='/v1/internal/invitations'||invitationRoute) {
          if(invitationRoute?.[2])
            throw new ApiError(405,'METHOD_NOT_ALLOWED');

          send(await auth.outgoingStaffInvitations(
            ctx,invitationRoute?invitationRoute[1]:null
          ));
          return true;
        }
        if(path==='/v1/account/invitations') {
          send(await auth.pendingStaffInvitations(ctx));
          return true;
        }
        if(organizationStaffRoute?.[2])
          throw new ApiError(405,'METHOD_NOT_ALLOWED');
        if(organizationStaffRoute) {
          send(await auth.organizationStaff(ctx,organizationStaffRoute[1]));
        }
        else if(clientBillingRoute) {
          const query=new URL(req.url??path,'http://localhost').searchParams;
          const allowed=clientBillingRoute[2]?['offset','limit']:[];
          if([...query.keys()].some(k=>!allowed.includes(k)||query.getAll(k).length!==1))
            throw new ApiError(422,'INVALID_PAGE');
          const number=(name:string,fallback:number)=>{
            const value=query.get(name);
            if(value===null)return fallback;
            if(!/^[0-9]{1,6}$/.test(value))
              throw new ApiError(422,'INVALID_PAGE');
            return Number(value);
          };
          send(clientBillingRoute[2]
            ?await auth.billingInvoices(ctx,clientBillingRoute[1],false,number('offset',0),number('limit',50))
            :await auth.clientBilling(ctx,clientBillingRoute[1]));
        }
        else if(path==='/v1/auth/bootstrap') send(await auth.bootstrap(ctx));
        else if(path==='/v1/account') {
          const result=await auth.tx(ctx,async db=>({status:200,body:{account:auth.account((await auth.identity(db,ctx,true)).user)}}),true);
          send(result);
        } else if(path==='/v1/organizations') send(await auth.organizations(ctx));
        else if(path==='/v1/internal/billing/overview') {
          const query=new URL(req.url??path,'http://localhost').searchParams;

          if([...query.keys()].some(k=>
            !['from','to'].includes(k)||query.getAll(k).length!==1
          )) throw new ApiError(422,'INVALID_DATE_RANGE');

          send(await auth.billingOverview(
            ctx,query.get('from')??'',query.get('to')??''
          ));
        }
        else if(path==='/v1/internal/session') send(await auth.internalSession(ctx));
        else if(path==='/v1/internal/responsible-managers')
          send(await auth.responsibleManagerCandidates(ctx));
        else if(path==='/v1/internal/billing/summary'||
                path==='/v1/internal/billing/history'||
                path==='/v1/internal/billing/invoices') {
          const query=new URL(req.url??path,'http://localhost').searchParams;
          const org=query.get('organization_id')??'';
          const invoices=path.endsWith('/invoices');
          const history=path.endsWith('/history');
          const allowed=(history||invoices)?['organization_id','offset','limit']:['organization_id'];
          if([...query.keys()].some(k=>!allowed.includes(k)||query.getAll(k).length!==1))
            throw new ApiError(422,'INVALID_PAGE');
          const number=(name:string,fallback:number)=>{
            const value=query.get(name);
            if(value===null)return fallback;
            if(!/^[0-9]{1,6}$/.test(value))
              throw new ApiError(422,'INVALID_PAGE');
            return Number(value);
          };
          send(invoices
            ?await auth.billingInvoices(ctx,org,true,number('offset',0),number('limit',50))
            :history
            ?await auth.billingHistory(ctx,org,number('offset',0),number('limit',50))
            :await auth.billingSummary(ctx,org));
        }
        else if(path==='/v1/internal/staff') send(await auth.internalStaff(ctx));
        else if(path==='/v1/internal/client-context') send(await auth.internalClientContext(ctx));
        else if(path==='/v1/internal/organizations') {
          const query=new URL(req.url??path,'http://localhost').searchParams;
          if([...query.keys()].some(key=>!['offset','limit','manager'].includes(key)) ||
             [...query.keys()].some(key=>query.getAll(key).length!==1))
            throw new ApiError(422,'INVALID_PAGE');
          const value=(name:string)=>{
            const input=query.get(name);
            if(input===null)return undefined;
            if(!/^(?:0|[1-9][0-9]{0,5})$/.test(input)) throw new ApiError(422,'INVALID_PAGE');
            return Number(input);
          };
          send(await auth.internalOrganizations(ctx,{offset:value('offset'),limit:value('limit'),manager:query.get('manager')??undefined}));
        }
        else if(path.startsWith('/v1/organizations/creation-status/')) send(await auth.creationStatus(ctx,path.split('/').at(-1)!));
        else if(path.startsWith('/v1/auth/email/challenges/')) send(await auth.tx(ctx,async db=>({status:200,body:await auth.challengeStatus(db,ctx,path.split('/').at(-1)!,true)})));
        else throw new ApiError(404,'RESOURCE_NOT_FOUND');
        return true;
      }
      if(req.method!==(displayNameRoute?'PATCH':'POST')) throw new ApiError(405,'METHOD_NOT_ALLOWED');
      if(!existing||auth.csrf(browser)!==req.headers['x-csrf-token']) throw new ApiError(403,'CSRF_INVALID');
      if(req.headers['content-type']?.split(';')[0]!=='application/json') throw new ApiError(415,'JSON_REQUIRED');
      let raw='',bytes=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})) {
        bytes+=chunk.length;
        if(bytes>4096) throw new ApiError(413,'BODY_TOO_LARGE');
        raw+=chunk.toString();
      }
      let body:Record<string,unknown>;
      try {body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object') throw Error();}
      catch {throw new ApiError(400,'INVALID_REQUEST');}
      if(['/v1/auth/email/complete','/v1/auth/refresh','/v1/auth/logout'].includes(path)&&Object.keys(body).length) throw new ApiError(400,'INVALID_REQUEST');
      // A reverse proxy may multiplex many different visitors over one socket.
      // Do not rate-limit legitimate customers by req.socket.remoteAddress.
      // Account/email limits are enforced in WebAuth; this additional browser
      // limit dampens repeated attempts from the same preauth identity.
      if(['/v1/auth/register','/v1/auth/login'].includes(path)) {
        await auth.tx(ctx,db=>auth.limit(db,'browser:'+path+':'+browser,20,3600));
      }
      const key=typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:'';
      let result:WebResult;
      if(displayNameRoute){send(await auth.renameOrganization(ctx,displayNameRoute[1],body));return true;}
      if(organizationStaffRoute?.[2]) {
        send(await auth.setOrganizationStaff(
          ctx,organizationStaffRoute[1],body
        ));
        return true;
      }
      if(invitationRoute) {
        send(invitationRoute[2]==='resend'
          ?await auth.resendStaffInvitation(ctx,invitationRoute[1],body)
          :invitationRoute[2]==='revoke'
          ?await auth.revokeStaffInvitation(ctx,invitationRoute[1],body)
          :await auth.createStaffInvitation(ctx,invitationRoute[1],body));
        return true;
      }

      switch(path) {
        case '/v1/account/invitations/accept':
          result=await auth.acceptStaffInvitation(ctx,body);break;
        case '/v1/internal/organizations/owner-invitation':
          result=await auth.createInitialOwnerInvitation(ctx,body);break;
        case '/v1/internal/organizations/owner-invitation/revoke':
          result=await auth.revokeInitialOwnerInvitation(ctx,body);break;
        case '/v1/internal/invitations':
          result=await auth.createStaffInvitation(ctx,null,body);break;
        case '/v1/internal/invitations/resend':
          result=await auth.resendStaffInvitation(ctx,null,body);break;
        case '/v1/internal/invitations/revoke':
          result=await auth.revokeStaffInvitation(ctx,null,body);break;
        case '/v1/auth/register':result=await auth.register(ctx,body,key);break;
        case '/v1/auth/email/verify':result=await auth.verify(ctx,body);break;
        case '/v1/auth/email/complete':result=await auth.complete(ctx);break;
        case '/v1/auth/email/resend':result=await auth.resend(ctx,body,key);break;
        case '/v1/auth/password/reset/request':result=await auth.requestPasswordReset(ctx,body);break;
        case '/v1/auth/password/reset/verify':result=await auth.verifyPasswordReset(ctx,body);break;
        case '/v1/auth/password/reset/complete':result=await auth.completePasswordReset(ctx,body);break;
        case '/v1/auth/login':result=await auth.login(ctx,body);break;
        case '/v1/auth/refresh':result=await auth.refresh(ctx);break;
        case '/v1/auth/logout':result=await auth.logout(ctx);break;
        case '/v1/session/organization':result=await auth.selectOrganization(ctx,body);break;
        case '/v1/organizations/lookup':result=await auth.lookupOrganization(ctx,body);break;
        case '/v1/organizations/suggest':result=await auth.suggestOrganizations(ctx,body);break;
        case '/v1/organizations':result=await auth.createOrganization(ctx,body,key);break;
        case '/v1/internal/organizations':result=await auth.createInternalOrganization(ctx,body,key);break;
        case '/v1/internal/organizations/responsible-manager':
          result=await auth.setResponsibleManager(ctx,body);break;
        case '/v1/internal/billing/transactions':
          result=await auth.recordBillingTransaction(ctx,body,key);break;
        case '/v1/internal/billing/schedule':
          result=await auth.setBillingSchedule(ctx,body);break;
        case '/v1/internal/billing/due-date':
          result=await auth.changeBillingDueDate(ctx,body);break;
        case '/v1/internal/staff/access':result=await auth.setInternalStaff(ctx,body);break;
        case '/v1/internal/client-context/open':result=await auth.openInternalClient(ctx,body);break;
        case '/v1/internal/client-context/close':result=await auth.closeInternalClient(ctx,body);break;
        case '/v1/internal/organizations/review':{
          if(typeof body.organization_id!=='string') throw new ApiError(400,'INVALID_REQUEST');
          const {organization_id,...review}=body;
          result=await auth.reviewOrganization(ctx,organization_id,review);break;
        }
        case '/v1/internal/organizations/revoke-verification':{
          if(typeof body.organization_id!=='string')
            throw new ApiError(400,'INVALID_REQUEST');
          const {organization_id,...review}=body;
          result=await auth.revokeOrganizationVerification(ctx,organization_id,review);break;
        }
        case '/v1/internal/organizations/reopen':{
          if(typeof body.organization_id!=='string') throw new ApiError(400,'INVALID_REQUEST');
          const {organization_id,...review}=body;
          result=await auth.reopenOrganization(ctx,organization_id,review);break;
        }
        default:throw new ApiError(404,'RESOURCE_NOT_FOUND');
      }
      send(result);
    } catch(error) {
      if(!(error instanceof ApiError)) {
        // No request bodies, credentials, email addresses or database query text.
        const pgCode=(error as {code?:unknown})?.code;
        console.error(JSON.stringify({event:'web_api_failure',request_id:requestId,
          route:path,kind:error instanceof Error?error.name:'unknown',
          db_code:typeof pgCode==='string'&&/^[A-Z0-9]{5}$/.test(pgCode)?pgCode:null}));
      }
      const api=error instanceof ApiError?error:new ApiError(503,'AUTH_UNAVAILABLE');
      if(api.status===429) res.setHeader('retry-after','60');
      send({status:api.status,body:{code:api.code,message:api.message,request_id:requestId,...(api.status===429?{retry_after_seconds:60}:{})}});
    }
    return true;
  };
}
