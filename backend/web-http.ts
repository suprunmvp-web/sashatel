import type { IncomingMessage,ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError } from './control.ts';
import { WebAuth, type WebResult } from './web-auth.ts';

export function webHandler(auth:WebAuth,origin:string) {
  if(new URL(origin).origin!==origin) throw new Error('Exact WEB_ORIGIN required');
  return async(req:IncomingMessage,res:ServerResponse) => {
    const path=req.url?.split('?')[0]??'';
    if(!path.startsWith('/v1/auth/')&&!['/v1/account','/v1/organizations','/v1/organizations/lookup','/v1/session/organization'].includes(path)&&!path.startsWith('/v1/organizations/creation-status/')) return false;
    const requestId=randomUUID();
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
      if(req.method==='POST'&&req.headers.origin!==origin) throw new ApiError(403,'CSRF_INVALID');
      const browser=await auth.browser(existing,parsed['__Host-sashatel-refresh']??parsed['__Host-sashatel-access']);
      if(browser!==existing) set('__Host-sashatel-preauth',browser,86400);
      const ctx={browser,access:parsed['__Host-sashatel-access'],refresh:parsed['__Host-sashatel-refresh'],requestId};
      if(req.method==='GET'&&path==='/v1/auth/csrf') {
        send({status:200,body:{csrf_token:auth.csrf(browser)}});return true;
      }
      if(req.method==='GET') {
        if(path==='/v1/auth/bootstrap') send(await auth.bootstrap(ctx));
        else if(path==='/v1/account') {
          const result=await auth.tx(ctx,async db=>({status:200,body:{account:auth.account((await auth.identity(db,ctx)).user)}}));
          send(result);
        } else if(path==='/v1/organizations') send(await auth.organizations(ctx));
        else if(path.startsWith('/v1/organizations/creation-status/')) send(await auth.creationStatus(ctx,path.split('/').at(-1)!));
        else if(path.startsWith('/v1/auth/email/challenges/')) send(await auth.tx(ctx,async db=>({status:200,body:await auth.challengeStatus(db,ctx,path.split('/').at(-1)!,true)})));
        else throw new ApiError(404,'RESOURCE_NOT_FOUND');
        return true;
      }
      if(req.method!=='POST') throw new ApiError(405,'METHOD_NOT_ALLOWED');
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
      if(['/v1/auth/register','/v1/auth/login'].includes(path)) {
        await auth.tx(ctx,db=>auth.limit(db,'ip:'+path+':'+req.socket.remoteAddress,20,3600));
      }
      const key=typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:'';
      let result:WebResult;
      switch(path) {
        case '/v1/auth/register':result=await auth.register(ctx,body,key);break;
        case '/v1/auth/email/verify':result=await auth.verify(ctx,body);break;
        case '/v1/auth/email/complete':result=await auth.complete(ctx);break;
        case '/v1/auth/email/resend':result=await auth.resend(ctx,body,key);break;
        case '/v1/auth/login':result=await auth.login(ctx,body);break;
        case '/v1/auth/refresh':result=await auth.refresh(ctx);break;
        case '/v1/auth/logout':result=await auth.logout(ctx);break;
        case '/v1/session/organization':result=await auth.selectOrganization(ctx,body);break;
        case '/v1/organizations/lookup':result=await auth.lookupOrganization(ctx,body);break;
        case '/v1/organizations':result=await auth.createOrganization(ctx,body,key);break;
        default:throw new ApiError(404,'RESOURCE_NOT_FOUND');
      }
      send(result);
    } catch(error) {
      const api=error instanceof ApiError?error:new ApiError(503,'AUTH_UNAVAILABLE');
      if(api.status===429) res.setHeader('retry-after','60');
      send({status:api.status,body:{code:api.code,message:api.message,request_id:requestId,...(api.status===429?{retry_after_seconds:60}:{})}});
    }
    return true;
  };
}
