import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomInt} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

test('server boots with file-backed Resend configuration and exposes health and CSRF',async()=>{
  assert(process.env.DATABASE_URL);
  const directory=await mkdtemp(join(tmpdir(),'sashatel-server-'));
  const urlFile=join(directory,'database');
  const keyFile=join(directory,'key');
  const emailKeyFile=join(directory,'resend-key');
  await writeFile(urlFile,process.env.DATABASE_URL,{mode:0o600});
  await writeFile(keyFile,randomBytes(32).toString('hex'),{mode:0o600});
  // A synthetic key only. This test must NOT send any external email.
  await writeFile(emailKeyFile,'test-only-not-a-real-api-key',{mode:0o600});

  const port=randomInt(20000,40000);
  const base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.ts'],{
    cwd:new URL('.',import.meta.url),
    env:{
      ...process.env,
      DATABASE_URL_FILE:urlFile,
      AUTH_KEY_FILE:keyFile,
      RESEND_API_KEY_FILE:emailKeyFile,
      EMAIL_FROM:'SashaTel <auth@example.test>',
      EMAIL_MODE:'resend',
      WEB_ORIGIN:'https://platform.example.test',
      LIVE_CALL_DISPATCH:'disabled',
      PORT:String(port),
    },
    stdio:['ignore','ignore','pipe'],
  });

  let failure='';
  child.stderr.on('data',chunk=>{failure+=chunk.toString();});
  try {
    let ready=false;
    for(let i=0;i<100&&!ready;i++) {
      if(child.exitCode!==null) throw new Error('Server exited during startup: '+failure);
      try {ready=(await fetch(base+'/ready')).status===200;} catch {}
      if(!ready) await pause(50);
    }
    assert(ready,'Server readiness did not pass: '+failure);
    assert.equal((await fetch(base+'/live')).status,200);

    const csrfResponse=await fetch(base+'/v1/auth/csrf');
    assert.equal(csrfResponse.status,200);
    assert(csrfResponse.headers.getSetCookie().some(value=>value.includes('HttpOnly')));
    const {csrf_token}=await csrfResponse.json();
    assert.equal(typeof csrf_token,'string');
    assert.equal(failure,'');
  } finally {
    child.kill('SIGTERM');
    if(child.exitCode===null) await once(child,'exit');
    await rm(directory,{recursive:true,force:true});
  }
});
