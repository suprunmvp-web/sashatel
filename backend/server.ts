import { readFile } from 'node:fs/promises';
import { ControlPlane } from './control.ts';
import { createApi } from './http.ts';
import { databasePool } from './db.ts';
import { WebAuth } from './web-auth.ts';
import { DaDataLookup } from './web-ports.ts'; import { ResendMailProvider } from './resend-mail.ts';


const {
  DATABASE_URL_FILE,
  DATABASE_CA_FILE,
  AUTH_KEY_FILE,
  WEB_ORIGIN,
  DADATA_API_KEY_FILE,
  RESEND_API_KEY_FILE,
  EMAIL_FROM,
  PORT = '8080',
  BIND_HOST = '127.0.0.1',
} = process.env;

if (
  !DATABASE_URL_FILE ||
  !AUTH_KEY_FILE ||
  !WEB_ORIGIN ||
  !RESEND_API_KEY_FILE ||
  !EMAIL_FROM ||
  process.env.EMAIL_MODE !== 'resend' ||
  process.env.LIVE_CALL_DISPATCH !== 'disabled'
) {
  throw new Error('Invalid Backend configuration');
}
const pool=await databasePool(DATABASE_URL_FILE,DATABASE_CA_FILE);
const key=(await readFile(AUTH_KEY_FILE,'utf8')).trim();
if(!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('AUTH key must be 32-byte hex');
const lookup=DADATA_API_KEY_FILE?new DaDataLookup((await readFile(DADATA_API_KEY_FILE,'utf8')).trim()):
  {async lookup():Promise<never> {throw new Error('DaData not configured');}};
 const resendKey = (await readFile(RESEND_API_KEY_FILE, 'utf8')).trim();  if (!resendKey) {   throw new Error('Email API key is empty'); }  const mail = new ResendMailProvider(resendKey, EMAIL_FROM); const auth = new WebAuth(pool, Buffer.from(key, 'hex'), mail, lookup);
const control=new ControlPlane(pool);
const ready=async()=>{
  const {rows:[role]}=await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if(role.rolsuper||role.rolbypassrls) throw new Error('Unsafe runtime role');
  await pool.query('SELECT first_name,last_name,phone FROM control.users LIMIT 0');
  await pool.query('SELECT completion_family FROM web_auth.browsers LIMIT 0');
  const {rows:[rls]}=await pool.query("SELECT bool_and(relforcerowsecurity) AS enabled FROM pg_class WHERE oid IN ('control.organizations'::regclass,'control.memberships'::regclass)");
  if(!rls.enabled) throw new Error('Tenant RLS required');
  const {rows:[grants]}=await pool.query(`SELECT has_table_privilege(current_user,'web_auth.audit','INSERT') AS append,
    has_table_privilege(current_user,'web_auth.audit','UPDATE,DELETE') AS mutate`);
  if(!grants.append||grants.mutate) throw new Error('Append-only audit grants required');
};
const api=createApi(control,ready,undefined,{auth,origin:WEB_ORIGIN});
let running=false;
const timer=setInterval(async()=>{
  if(running) return;
  running=true;
  try {await auth.deliverOne(); await auth.deliverPasswordResetOne();} catch {console.error('Email outbox temporarily unavailable');} finally {running=false;}
},500);
api.listen(Number(PORT),BIND_HOST);
process.once('SIGTERM',()=>{
  clearInterval(timer);
  api.close(()=>{void pool.end();});
});
