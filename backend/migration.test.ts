import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test('004 preserves legacy identity, call and ledger IDs and uses NULL contact fields',async()=>{
  assert(process.env.TEST_ADMIN_URL);
  const owner=new pg.Client({connectionString:process.env.TEST_ADMIN_URL});
  await owner.connect();
  const name='migration_'+randomUUID().replaceAll('-','');
  await owner.query('CREATE DATABASE '+name);
  const url=new URL(process.env.TEST_ADMIN_URL);url.pathname='/'+name;
  const db=new pg.Client({connectionString:url.toString()});
  await db.connect();
  try {
    for(const file of ['001.sql','runtime.sql','002-uis.sql','003-operator.sql']) {
      await db.query(await readFile(new URL('./migrations/'+file,import.meta.url),'utf8'));
    }
    const ids=Array.from({length:7},()=>randomUUID());
    const [org,user,member,device,trunk,call,attempt]=ids;
    await db.query('INSERT INTO control.organizations VALUES($1,true,1)',[org]);
    await db.query("INSERT INTO control.users VALUES($1,'legacy-user','legacy-hash',true,42)",[user]);
    await db.query("INSERT INTO control.memberships VALUES($1,$2,$3,'manager',true)",[org,member,user]);
    await db.query('INSERT INTO control.devices VALUES($1,$2,$3)',[org,device,member]);
    await db.query("INSERT INTO control.sessions(organization_id,token_hash,membership_id,device_id,phone_epoch,expires_at) VALUES($1,'legacy',$2,$3,42,clock_timestamp()+interval '1 minute')",[org,member,device]);
    await db.query('INSERT INTO control.trunks VALUES($1,$2,true)',[org,trunk]);
    await db.query("INSERT INTO control.phone_numbers VALUES($1,'+74950000001',$2,true)",[org,trunk]);
    await db.query("INSERT INTO control.calls VALUES($1,$2,$3,$4,'legacy','legacy-key','+79261234567','+74950000001',$5,10,'ended',clock_timestamp(),clock_timestamp())",[org,call,attempt,member,trunk]);
    await db.query("INSERT INTO control.usage_ledger(organization_id,call_id,kind,units) VALUES($1,$2,'charge',3)",[org,call]);
    const directory=await mkdtemp(join(tmpdir(),'sashatel-migration-'));
    try {
      const file=join(directory,'url');
      await writeFile(file,url.toString(),{mode:0o600});
      const migrate=()=>promisify(execFile)(process.execPath,['migrate.ts'],{
        cwd:new URL('.',import.meta.url),
        env:{...process.env,MIGRATION_DATABASE_URL_FILE:file,ADOPT_PILOT_SCHEMA:'verified'},
      });
      await migrate();
      await migrate();
      assert.equal((await db.query('SELECT count(*)::int AS count FROM public.sashatel_migrations')).rows[0].count,20);
    } finally {await rm(directory,{recursive:true,force:true});}
    const {rows:[legacy]}=await db.query('SELECT id,first_name,last_name,phone,phone_epoch FROM control.users WHERE id=$1',[user]);
    assert.deepEqual(legacy,{id:user,first_name:null,last_name:null,phone:null,phone_epoch:'42'});
    assert.equal((await db.query('SELECT attempt_id FROM control.calls WHERE id=$1',[call])).rows[0].attempt_id,attempt);
    assert.equal((await db.query('SELECT units FROM control.usage_ledger WHERE call_id=$1',[call])).rows[0].units,'3');
    assert.equal((await db.query('SELECT verification_status FROM control.organizations WHERE id=$1',[org])).rows[0].verification_status,'unverified');
    assert.equal((await db.query('SELECT active FROM control.trunks WHERE id=$1',[trunk])).rows[0].active,true);
  } finally {
    await db.end();
    await owner.query('DROP DATABASE '+name+' WITH (FORCE)');
    await owner.end();
  }
});
