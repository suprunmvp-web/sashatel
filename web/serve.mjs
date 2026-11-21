import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(new URL('./dist',import.meta.url).pathname),upstream=process.env.WEB_API_UPSTREAM;
if(upstream&&!['http:','https:'].includes(new URL(upstream).protocol))throw Error('Invalid API upstream');
const mime={'.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.ttf':'font/ttf'};
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
 if(url.pathname.startsWith('/v1/')||['/live','/ready'].includes(url.pathname)){
  if(!upstream){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"AUTH_UNAVAILABLE","message":"API не подключён"}');return;}
  try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8192)throw Error('body limit');chunks.push(c);}
   const headers=new Headers();for(const key of ['content-type','cookie','origin','x-csrf-token','idempotency-key'])if(req.headers[key])headers.set(key,req.headers[key]);
   const reply=await fetch(new URL(url.pathname+url.search,upstream),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(15000)});
   for(const key of ['content-type','cache-control','retry-after','idempotency-replayed'])if(reply.headers.has(key))res.setHeader(key,reply.headers.get(key));
   if(reply.headers.getSetCookie().length)res.setHeader('set-cookie',reply.headers.getSetCookie());
   res.writeHead(reply.status);res.end(Buffer.from(await reply.arrayBuffer()));
  }catch{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"AUTH_UNAVAILABLE","message":"API временно недоступен"}');}return;
 }
 try{let path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+'/')&&path!==root)throw Error();
  if(!extname(path))path=root+'/index.html';else if(!(await stat(path)).isFile())throw Error();
  res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(await readFile(path));
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||4174),'127.0.0.1',()=>console.log('Web listening on loopback'));
