import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

test('S1 server entrypoint starts with secret files and delivers only to the test sink',async()=>{
  assert(process.env.DATABASE_URL);
  const directory=await mkdtemp(join(tmpdir(),'sashatel-server-'));
  const urlFile=join(directory,'database'),keyFile=join(directory,'key'),sink=join(directory,'sink');
  await writeFile(urlFile,process.env.DATABASE_URL,{mode:0o600});
  await writeFile(keyFile,randomBytes(32).toString('hex'),{mode:0o600});
  const port=randomInt(20000,40000),base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.ts'],{
    cwd:new URL('.',import.meta.url),
    env:{...process.env,DATABASE_URL_FILE:urlFile,AUTH_KEY_FILE:keyFile,WEB_ORIGIN:'https://platform.example.test',
      EMAIL_SINK_DIRECTORY:sink,EMAIL_MODE:'sink',LIVE_CALL_DISPATCH:'disabled',PORT:String(port)},
    stdio:['ignore','ignore','pipe'],
  });
  let failure='';
  child.stderr.on('data',chunk=>{failure+=chunk.toString();});
  try {
    let ready=false;
    for(let i=0;i<100&&!ready;i++) {
      if(child.exitCode!==null) throw new Error('Server exited during startup');
      try {ready=(await fetch(base+'/ready')).status===200;} catch {}
      if(!ready) await pause(50);
    }
    assert(ready,'S1 readiness did not pass');
    assert.equal((await fetch(base+'/live')).status,200);
    const csrfResponse=await fetch(base+'/v1/auth/csrf');
    const cookie=csrfResponse.headers.getSetCookie()[0].split(';')[0],{csrf_token}=await csrfResponse.json();
    const response=await fetch(base+'/v1/auth/register',{method:'POST',
      headers:{cookie,origin:'https://platform.example.test','x-csrf-token':csrf_token,'content-type':'application/json','idempotency-key':randomUUID()},
      body:JSON.stringify({first_name:'Server',last_name:'Test',email:randomUUID()+'@example.test',phone:'+79261234567',password:'server-test-password'})});
    assert.equal(response.status,202);
    const {challenge_id}=await response.json();
    let delivered=false;
    for(let i=0;i<100&&!delivered;i++) {
      try {const message=JSON.parse(await readFile(join(sink,challenge_id+'.json'),'utf8'));delivered=/^[0-9]{6}$/.test(message.code);} catch {}
      if(!delivered) await pause(50);
    }
    assert(delivered);
    assert.equal(failure,'');
  } finally {
    child.kill('SIGTERM');
    if(child.exitCode===null) await once(child,'exit');
    await rm(directory,{recursive:true,force:true});
  }
});
