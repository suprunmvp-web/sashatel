import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { Pool, PoolClient } from 'pg';
import { ApiError, uuid } from './control.ts';

const scrypt=(password:string,salt:string,length:number,options:ScryptOptions) =>
  new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,length,options,(error,key)=>error?reject(error):resolve(key)));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const deadline = (seconds: number) => new Date(Date.now()+seconds*1000);
export interface MailPort {
  send(message: {id:string;email:string;code:string|null}): Promise<void>;
}
// Provider failures that must not be retried (invalid sender, forbidden API key, etc.).
// Network timeouts and unknown outcomes remain retryable.
export class MailDeliveryError extends Error {
  readonly retryable:boolean;
  constructor(retryable:boolean) {
    super(retryable?'MAIL_TRANSIENT_FAILURE':'MAIL_PERMANENT_FAILURE');
    this.name='MailDeliveryError';
    this.retryable=retryable;
  }
}
export interface LookupPort {
  lookup(inn:string): Promise<{legal_name:string;legal_address:string}|null>;
  suggest?(query:string): Promise<Array<{inn:string;legal_name:string;legal_address:string}>>;
}
export type WebResult = {status:number;body?:unknown;cookies?:Record<string,string>;replayed?:boolean};
type Context = {browser:string;access?:string;refresh?:string;requestId:string};
class CommitError extends ApiError {}

async function passwordHash(password:string) {
  const salt=token();
  const key=await scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024}) as Buffer;
  return 'scrypt-v1:' + salt + ':' + key.toString('hex');
}
async function passwordValid(password:string, stored:string) {
  const fields=stored.split(':');
  const modern=fields[0]==='scrypt-v1';
  const salt=fields[modern?1:0],expected=fields[modern?2:1];
  const key=await scrypt(password,salt,64,modern?{N:131072,r:8,p:1,maxmem:256*1024*1024}:{}) as Buffer;
  const bytes=Buffer.from(expected,'hex');
  return bytes.length===key.length && timingSafeEqual(bytes,key);
}
function profile(input:Record<string,unknown>) {
  const keys=Object.keys(input).sort().join(',');
  if(keys!=='email,first_name,last_name,password,phone') throw new ApiError(400,'INVALID_REQUEST');
  const name=(value:unknown) => {
    if(typeof value!=='string') throw new ApiError(422,'INVALID_PROFILE');
    const result=value.trim();
    if(!result || [...result].length>80 || /[\p{Cc}\p{Cf}]/u.test(result)) throw new ApiError(422,'INVALID_PROFILE');
    return result;
  };
  if(typeof input.email!=='string'||input.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new ApiError(422,'INVALID_EMAIL');
  if(typeof input.password!=='string'||[...input.password].length<8||[...input.password].length>128||Buffer.byteLength(input.password)>512) throw new ApiError(422,'INVALID_PASSWORD');
  if(typeof input.phone!=='string'||!/^\+[0-9 ()-]+$/.test(input.phone)||input.phone.length>40) throw new ApiError(422,'INVALID_PHONE');
  const phone=parsePhoneNumberFromString(input.phone.replace(/[ ()-]/g,''));
  if(!phone?.isValid()) throw new ApiError(422,'INVALID_PHONE');
  return {first_name:name(input.first_name),last_name:name(input.last_name),email:input.email.trim().toLowerCase(),phone:phone.number,password:input.password};
}
function exact(input:Record<string,unknown>,keys:string[]) {
  if(Object.keys(input).sort().join(',')!==keys.sort().join(',')) throw new ApiError(400,'INVALID_REQUEST');
}
function required(input:Record<string,unknown>,name:string,max=512) {
  const value=input[name];
  if(typeof value!=='string'||!value||value.length>max) throw new ApiError(400,'INVALID_REQUEST');
  return value;
}
function validInn(inn:string) {
  if(!/^([0-9]{10}|[0-9]{12})$/.test(inn)||/^0+$/.test(inn)) return false;
  const n=[...inn].map(Number);
  const digit=(weights:number[])=>weights.reduce((sum,w,i)=>sum+w*n[i],0)%11%10;
  return n.length===10?digit([2,4,10,3,5,9,4,6,8])===n[9]:
    digit([7,2,4,10,3,5,9,4,6,8])===n[10]&&digit([3,7,2,4,10,3,5,9,4,6,8])===n[11];
}

export class WebAuth {
  readonly pool:Pool;
  readonly key:Buffer;
  readonly mail:MailPort;
  readonly lookup:LookupPort;
  private readonly refreshing=new Map<string,Promise<WebResult>>();
  constructor(pool:Pool,key:Buffer,mail:MailPort,lookup:LookupPort) {
    if(key.length!==32) throw new Error('32-byte AUTH key required');
    this.pool=pool;this.key=Buffer.from(key);this.mail=mail;this.lookup=lookup;
  }
  csrf(browser:string) {return createHmac('sha256',this.key).update('csrf:'+Math.floor(Date.now()/3600000)+':'+browser).digest('hex');}
  async browser(candidate?:string,credential?:string) {
    if(candidate&&/^[0-9a-f]{64}$/.test(candidate)) {
      const {rowCount}=await this.pool.query('SELECT 1 FROM web_auth.browsers WHERE hash=$1 AND expires_at>clock_timestamp()',[hash(candidate)]);
      if(rowCount) return candidate;
      if(credential) {
        const restored=await this.pool.query(`UPDATE web_auth.browsers b SET expires_at=$3
          WHERE b.hash=$1 AND EXISTS(SELECT 1 FROM web_auth.families f WHERE f.browser_hash=b.hash
          AND f.revoked_at IS NULL AND f.idle_expires>clock_timestamp() AND f.absolute_expires>clock_timestamp()
          AND (f.refresh_hash=$2 OR (f.access_hash=$2 AND f.access_expires>clock_timestamp())))
          RETURNING hash`,[hash(candidate),hash(credential),deadline(86400)]);
        if(restored.rowCount) return candidate;
      }
    }
    const value=token();
    await this.pool.query('INSERT INTO web_auth.browsers(hash,expires_at) VALUES($1,$2)',[hash(value),deadline(86400)]);
    return value;
  }
  async tx<T>(ctx:Context,fn:(db:PoolClient)=>Promise<T>) {
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      const locked=await db.query('SELECT hash FROM web_auth.browsers WHERE hash=$1 AND expires_at>clock_timestamp() FOR UPDATE',[hash(ctx.browser)]);
      if(!locked.rowCount) throw new ApiError(401,'SESSION_REVOKED');
      const value=await fn(db);await db.query('COMMIT');return value;
    } catch(error) {
      await db.query(error instanceof CommitError?'COMMIT':'ROLLBACK');
      throw error;
    } finally {db.release();}
  }
  async limit(db:PoolClient,key:string,maximum:number,seconds:number) {
    const result=await db.query(`INSERT INTO web_auth.limits VALUES($1,clock_timestamp(),1)
      ON CONFLICT(key) DO UPDATE SET
       used=CASE WHEN web_auth.limits.window_start<clock_timestamp()-make_interval(secs=>$2) THEN 1 ELSE web_auth.limits.used+1 END,
       window_start=CASE WHEN web_auth.limits.window_start<clock_timestamp()-make_interval(secs=>$2) THEN clock_timestamp() ELSE web_auth.limits.window_start END
      RETURNING used`,[hash(key),seconds]);
    if(result.rows[0].used>maximum) throw new CommitError(429,'RATE_LIMITED');
  }
  fingerprint(value:unknown) {return createHmac('sha256',this.key).update(JSON.stringify(value)).digest('hex');}
  seal(value:unknown) {
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
    const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString('base64');
  }
  open(value:string) {
    const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());
  }
  async audit(db:PoolClient,ctx:Context,action:string,user:string|null,org:string|null,target:string|null,changes:unknown={}) {
    await db.query('INSERT INTO web_auth.audit(actor_user_id,organization_id,action,target_id,request_id,changes) VALUES($1,$2,$3,$4,$5,$6)',
      [user,org,action,target,ctx.requestId,changes]);
  }
  async identity(db:PoolClient,ctx:Context) {
    if(!ctx.access) throw new ApiError(401,'SESSION_REVOKED');
    const {rows:[family]}=await db.query(`SELECT *,access_expires>clock_timestamp() AS fresh FROM web_auth.families
      WHERE access_hash=$1 AND browser_hash=$2 FOR UPDATE`,[hash(ctx.access),hash(ctx.browser)]);
    if(!family||family.revoked_at) throw new ApiError(401,'SESSION_REVOKED');
    if(!family.fresh) throw new ApiError(401,'ACCESS_EXPIRED');
    const {rows:[user]}=await db.query('SELECT * FROM control.users WHERE id=$1 FOR UPDATE',[family.user_id]);
    if(!user?.active) throw new ApiError(403,'USER_REVOKED');
    if(!user.email_verified_at) throw new ApiError(403,'EMAIL_UNVERIFIED');
    return {family,user};
  }
  account(user:Record<string,unknown>) {
    return {id:user.id,email:user.login,email_verified:!!user.email_verified_at,
      first_name:user.first_name,last_name:user.last_name,phone:user.phone,phone_verified:false,
      display_name:user.first_name??null};
  }
  async closeCompletion(db:PoolClient,ctx:Context) {
    await db.query('UPDATE web_auth.browsers SET completion=NULL,completion_family=NULL,completion_expires=NULL WHERE hash=$1',[hash(ctx.browser)]);
  }
  async newFamily(db:PoolClient,ctx:Context,userId:string,device:string) {
    const access=token(),refresh=token(),id=randomUUID();
    await db.query(`INSERT INTO web_auth.families(id,user_id,browser_hash,device_id,access_hash,access_expires,refresh_hash,idle_expires,absolute_expires)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,userId,hash(ctx.browser),device,hash(access),deadline(300),hash(refresh),deadline(604800),deadline(2592000)]);
    await db.query('INSERT INTO web_auth.refresh_history VALUES($1,$2)',[hash(refresh),id]);
    return {id,access,refresh};
  }
  async register(ctx:Context,input:Record<string,unknown>,key:string) {
    if(!uuid.test(key)) throw new ApiError(400,'INVALID_REQUEST');
    const p=profile(input),fingerprint=this.fingerprint(p);
    return this.tx(ctx,async db=>{
      const {rows:[active]}=await db.query('SELECT 1 FROM web_auth.families WHERE access_hash=$1 AND revoked_at IS NULL',[hash(ctx.access??'')]);
      if(active) throw new ApiError(409,'ALREADY_AUTHENTICATED');
      const {rows:[receipt]}=await db.query("SELECT * FROM web_auth.receipts WHERE browser_hash=$1 AND operation='register' AND key=$2",[hash(ctx.browser),key]);
      if(receipt) {
        if(receipt.fingerprint!==fingerprint) throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        return {status:202,body:receipt.response};
      }
      await this.limit(db,'register-email:'+p.email,5,3600);
      const password_hash=await passwordHash(p.password);
      const {password:_,...details}=p;
      const response=await this.challenge(db,ctx,p.email,details,password_hash);
      await db.query("INSERT INTO web_auth.receipts(browser_hash,operation,key,fingerprint,response) VALUES($1,'register',$2,$3,$4)",[hash(ctx.browser),key,fingerprint,response]);
      return {status:202,body:response};
    });
  }
  async challenge(db:PoolClient,ctx:Context,email:string,details:unknown,password_hash:string) {
    const {rows:[old]}=await db.query('SELECT challenge_id FROM web_auth.browsers WHERE hash=$1',[hash(ctx.browser)]);
    if(old.challenge_id) await db.query('UPDATE web_auth.challenges SET consumed_at=COALESCE(consumed_at,clock_timestamp()) WHERE id=$1',[old.challenge_id]);
    await this.closeCompletion(db,ctx);
    const id=randomUUID(),code=randomInt(0,1000000).toString().padStart(6,'0');
    await db.query(`INSERT INTO web_auth.challenges(id,browser_hash,email,profile,password_hash,code_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,hash(ctx.browser),email,details,password_hash,this.fingerprint([id,code]),deadline(600)]);
    await db.query('UPDATE web_auth.browsers SET challenge_id=$2 WHERE hash=$1',[hash(ctx.browser),id]);
    await this.audit(db,ctx,'account.challenge_created',null,null,id);
    // Delivery occurs after commit. Only ciphertext is persisted in the durable outbox.
    await db.query('INSERT INTO web_auth.mail_jobs(challenge_id,envelope) VALUES($1,$2)',[id,this.seal({email,code})]);
    return {challenge_id:id,expires_in:600,resend_after:60};
  }
  async resend(ctx:Context,input:Record<string,unknown>,key:string) {
    exact(input,['challenge_id']);
    const id=required(input,'challenge_id',36);
    if(!uuid.test(id)||!uuid.test(key)) throw new ApiError(400,'INVALID_REQUEST');
    return this.tx(ctx,async db=>{
      const fp=this.fingerprint(id);
      const {rows:[receipt]}=await db.query("SELECT * FROM web_auth.receipts WHERE browser_hash=$1 AND operation='resend' AND key=$2",[hash(ctx.browser),key]);
      if(receipt) {
        if(receipt.fingerprint!==fp) throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        return {status:202,body:receipt.response};
      }
      const {rows:[row]}=await db.query(`SELECT c.*,c.created_at<clock_timestamp()-interval '60 seconds' AS allowed FROM web_auth.challenges c
        JOIN web_auth.browsers b ON b.challenge_id=c.id WHERE c.id=$1 AND c.browser_hash=$2`,[id,hash(ctx.browser)]);
      if(!row) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      if(!row.allowed) throw new CommitError(429,'RATE_LIMITED');
      await this.limit(db,'resend:'+row.email,5,3600);
      const response=await this.challenge(db,ctx,row.email,row.profile,row.password_hash);
      await db.query("INSERT INTO web_auth.receipts(browser_hash,operation,key,fingerprint,response) VALUES($1,'resend',$2,$3,$4)",[hash(ctx.browser),key,fp,response]);
      return {status:202,body:response};
    });
  }
  async verify(ctx:Context,input:Record<string,unknown>) {
    exact(input,['challenge_id','code']);
    const id=required(input,'challenge_id',36),code=required(input,'code',6);
    if(!uuid.test(id)||!/^\d{6}$/.test(code)) throw new ApiError(400,'CODE_INVALID_OR_EXPIRED');
    return this.tx(ctx,async db=>{
      const {rows:[row]}=await db.query(`SELECT c.*,c.expires_at>clock_timestamp() AS fresh FROM web_auth.challenges c
       JOIN web_auth.browsers b ON b.challenge_id=c.id WHERE c.id=$1 AND c.browser_hash=$2 FOR UPDATE OF c`,[id,hash(ctx.browser)]);
      if(!row) throw new ApiError(400,'CODE_INVALID_OR_EXPIRED');
      await this.limit(db,'verify:'+row.email,20,3600);
      if(row.consumed_at||!row.fresh||row.attempts>=5) throw new CommitError(400,'CODE_INVALID_OR_EXPIRED');
      await db.query('UPDATE web_auth.challenges SET attempts=attempts+1 WHERE id=$1',[id]);
      if(row.code_hash!==this.fingerprint([id,code])) throw new CommitError(400,'CODE_INVALID_OR_EXPIRED');
      // Serialize identities across browser sessions without overwriting an existing verified account.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[row.email]);
      const {rows:[existing]}=await db.query('SELECT id FROM control.users WHERE lower(login)=$1',[row.email]);
      if(existing) throw new CommitError(400,'CODE_INVALID_OR_EXPIRED');
      const userId=randomUUID();
      await db.query(`INSERT INTO control.users(id,login,password_hash,first_name,last_name,phone,email_verified_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`,
        [userId,row.email,row.password_hash,row.profile.first_name,row.profile.last_name,row.profile.phone]);
      await db.query('UPDATE web_auth.challenges SET consumed_at=clock_timestamp() WHERE id=$1',[id]);
      const family=await this.newFamily(db,ctx,userId,randomUUID());
      await db.query('UPDATE web_auth.browsers SET completion=$2,completion_family=$3,completion_expires=$4 WHERE hash=$1',
        [hash(ctx.browser),this.seal(family),family.id,deadline(300)]);
      await this.audit(db,ctx,'account.verified',userId,null,userId);
      return {status:200,body:{verified:true},cookies:{access:family.access,refresh:family.refresh}};
    });
  }
  async complete(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {rows:[browser]}=await db.query(`SELECT b.completion FROM web_auth.browsers b JOIN web_auth.families f ON f.id=b.completion_family
        WHERE b.hash=$1 AND b.completion_expires>clock_timestamp() AND f.revoked_at IS NULL`,[hash(ctx.browser)]);
      if(!browser?.completion) throw new ApiError(400,'CODE_INVALID_OR_EXPIRED');
      const receipt=this.open(browser.completion);
      return {status:200,body:{verified:true},cookies:{access:receipt.access,refresh:receipt.refresh}};
    });
  }
  async challengeStatus(db:PoolClient,ctx:Context,id:string,poll=false) {
    if(!uuid.test(id)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const {rows:[row]}=await db.query('SELECT *,expires_at>clock_timestamp() AS fresh FROM web_auth.challenges WHERE id=$1 AND browser_hash=$2',[id,hash(ctx.browser)]);
    if(!row) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    if(poll) {
      if(row.poll_at&&Date.now()-new Date(row.poll_at).getTime()<5000) throw new CommitError(429,'RATE_LIMITED');
      await db.query('UPDATE web_auth.challenges SET poll_at=clock_timestamp() WHERE id=$1',[id]);
    }
    return {challenge_id:id,email:row.email,expires_at:row.expires_at,
      resend_at:new Date(new Date(row.created_at).getTime()+60000),can_verify:row.fresh&&!row.consumed_at&&row.attempts<5,
      delivery:{state:row.delivery,retryable:row.delivery==='failed'}};
  }
  async bootstrap(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {rows:[browser]}=await db.query('SELECT *,completion_expires>clock_timestamp() AS valid FROM web_auth.browsers WHERE hash=$1',[hash(ctx.browser)]);
      // Browsers remove the short-lived access cookie after five minutes.
      // A remaining refresh cookie means this is an expiring session, not an anonymous visitor.
      // Signal the client to rotate credentials rather than showing onboarding again.
      if(!ctx.access&&ctx.refresh) throw new ApiError(401,'ACCESS_EXPIRED');
      if(ctx.access) {
        const {family,user}=await this.identity(db,ctx);
        await this.closeCompletion(db,ctx);
        return {status:200,body:{account:this.account(user),family_id:family.id,context:await this.context(db,family),challenge:null,verification_completion_available:false}};
      }
      const challenge=browser.challenge_id?await this.challengeStatus(db,ctx,browser.challenge_id):null;
      return {status:200,body:{account:null,family_id:null,context:null,challenge,verification_completion_available:!!browser.completion&&!!browser.valid}};
    });
  }
  async login(ctx:Context,input:Record<string,unknown>) {
    exact(input,['email','password','device_id']);
    const email=required(input,'email',254).trim().toLowerCase(),password=required(input,'password',512),device=required(input,'device_id',36);
    if(!uuid.test(device)) throw new ApiError(400,'INVALID_REQUEST');
    return this.tx(ctx,async db=>{
      await this.limit(db,'login:'+email,10,900);
      const {rows:[user]}=await db.query('SELECT * FROM control.users WHERE lower(login)=$1 FOR UPDATE',[email]);
      const dummy='0'.repeat(32)+':'+'0'.repeat(128);
      if(!await passwordValid(password,user?.password_hash??dummy)||!user?.active) throw new CommitError(401,'INVALID_CREDENTIALS');
      if(!user.email_verified_at) throw new CommitError(403,'EMAIL_UNVERIFIED');
      await this.closeCompletion(db,ctx);
      // A new login in this browser replaces its prior Web family only.
      await db.query('UPDATE web_auth.families SET revoked_at=clock_timestamp() WHERE browser_hash=$1 AND revoked_at IS NULL',[hash(ctx.browser)]);
      const family=await this.newFamily(db,ctx,user.id,device);
      await this.audit(db,ctx,'session.login',user.id,null,family.id);
      return {status:200,body:{account:this.account(user),family_id:family.id,access_expires_in:300,context:null},cookies:{access:family.access,refresh:family.refresh}};
    });
  }
  async refresh(ctx:Context):Promise<WebResult> {
    const key=hash(ctx.browser+':'+(ctx.refresh??''));
    const pending=this.refreshing.get(key);
    if(pending) return pending;
    const operation=this.rotate(ctx);
    this.refreshing.set(key,operation);
    try {return await operation;} finally {this.refreshing.delete(key);}
  }
  private async rotate(ctx:Context):Promise<WebResult> {
    return this.tx(ctx,async db=>{
      if(!ctx.refresh) throw new ApiError(401,'SESSION_REVOKED');
      const {rows:[family]}=await db.query(`SELECT f.*,f.idle_expires>clock_timestamp() AND f.absolute_expires>clock_timestamp() AS fresh
        FROM web_auth.families f JOIN web_auth.refresh_history h ON h.family_id=f.id
        WHERE h.hash=$1 AND f.browser_hash=$2 FOR UPDATE OF f`,[hash(ctx.refresh),hash(ctx.browser)]);
      if(!family||family.revoked_at) throw new ApiError(401,'SESSION_REVOKED');
      if(family.refresh_hash!==hash(ctx.refresh)) {
        await db.query('UPDATE web_auth.families SET revoked_at=clock_timestamp() WHERE id=$1',[family.id]);
        await this.closeCompletion(db,ctx);
        await this.audit(db,ctx,'session.refresh_reuse',family.user_id,null,family.id);
        throw new CommitError(401,'REFRESH_REUSED');
      }
      if(!family.fresh) throw new ApiError(401,'REFRESH_EXPIRED');
      const {rows:[user]}=await db.query('SELECT * FROM control.users WHERE id=$1 FOR UPDATE',[family.user_id]);
      if(!user.active) throw new ApiError(403,'USER_REVOKED');
      const access=token(),refresh=token();
      await db.query(`UPDATE web_auth.families SET access_hash=$2,access_expires=$3,refresh_hash=$4,
        idle_expires=LEAST($5,absolute_expires) WHERE id=$1`,[family.id,hash(access),deadline(300),hash(refresh),deadline(604800)]);
      await db.query('INSERT INTO web_auth.refresh_history VALUES($1,$2)',[hash(refresh),family.id]);
      await this.closeCompletion(db,ctx);
      return {status:200,body:{account:this.account(user),family_id:family.id,access_expires_in:300,context:await this.context(db,family)},cookies:{access,refresh}};
    });
  }
  async logout(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {rows}=await db.query(`UPDATE web_auth.families SET revoked_at=COALESCE(revoked_at,clock_timestamp())
       WHERE browser_hash=$1 AND (access_hash=$2 OR id IN (SELECT family_id FROM web_auth.refresh_history WHERE hash=$3))
       RETURNING id,user_id`,[hash(ctx.browser),hash(ctx.access??''),hash(ctx.refresh??'')]);
      for(const family of rows) await this.audit(db,ctx,'session.logout',family.user_id,null,family.id);
      // Logout must fence a lost verification response even if account cookies never arrived.
      await db.query(`UPDATE web_auth.families SET revoked_at=COALESCE(revoked_at,clock_timestamp())
        WHERE id=(SELECT completion_family FROM web_auth.browsers WHERE hash=$1)`,[hash(ctx.browser)]);
      await this.closeCompletion(db,ctx);
      return {status:204,cookies:{access:'',refresh:''}};
    });
  }
  async scope(db:PoolClient,tenant:string) {await db.query("SELECT set_config('control.tenant',$1,true)",[tenant]);}
  async organization(db:PoolClient,userId:string,id:string) {
    await this.scope(db,id);
    const {rows:[row]}=await db.query(`SELECT o.id,o.inn,o.legal_name,o.verification_status,o.active,m.id AS membership_id,
       CASE WHEN o.owner_membership_id=m.id THEN 'owner' ELSE m.role_id END AS role
      FROM control.organizations o JOIN control.memberships m ON m.organization_id=o.id
      WHERE o.id=$1 AND m.user_id=$2 AND m.active`,[id,userId]);
    if(!row) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const {active,...fields}=row;
    return {...fields,status:active?'active':'suspended'};
  }
  async context(db:PoolClient,family:Record<string,any>) {
    if(!family.organization_id) return null;
    return {id:family.id,organization:await this.organization(db,family.user_id,family.organization_id),
      context_epoch:family.context_epoch,expires_at:family.access_expires};
  }
  async organizations(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      // Narrow SECURITY DEFINER function lists IDs only for this authenticated account.
      const {rows}=await db.query('SELECT organization_id FROM web_auth.own_organization_ids($1)',[user.id]);
      const items=[];
      for(const row of rows) items.push(await this.organization(db,user.id,row.organization_id));
      return {status:200,body:{items}};
    });
  }
  async selectOrganization(ctx:Context,input:Record<string,unknown>) {
    exact(input,['organization_id','expected_context_epoch']);
    const id=required(input,'organization_id',36);
    if(!uuid.test(id)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);
      if(input.expected_context_epoch!==(family.context_epoch||null)&&input.expected_context_epoch!==family.context_epoch) throw new ApiError(409,'ORGANIZATION_CONTEXT_CHANGED');
      const org=await this.organization(db,user.id,id);
      if(org.status!=='active') throw new ApiError(403,'ORGANIZATION_SUSPENDED');
      family.organization_id=id;family.context_epoch++;
      await db.query('UPDATE web_auth.families SET organization_id=$2,context_epoch=$3 WHERE id=$1',[family.id,id,family.context_epoch]);
      return {status:200,body:{context:await this.context(db,family)}};
    });
  }
  async suggestOrganizations(ctx:Context,input:Record<string,unknown>) {
    exact(input,['query']);
    const query=required(input,'query',12);
    if(!/^[0-9]{4,12}$/.test(query)) throw new ApiError(422,'INN_INVALID');
    // Authenticate and rate-limit by verified account before calling paid DaData API.
    await this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      await this.limit(db,'party-suggest:'+user.id,40,60);
    });
    if(!this.lookup.suggest) throw new ApiError(503,'ORGANIZATION_LOOKUP_UNAVAILABLE');
    try {
      const items=await this.lookup.suggest(query);
      return {status:200,body:{items}};
    } catch {
      throw new ApiError(503,'ORGANIZATION_LOOKUP_UNAVAILABLE');
    }
  }
  async lookupOrganization(ctx:Context,input:Record<string,unknown>) {
    exact(input,['inn']);
    const inn=required(input,'inn',12);
    if(!validInn(inn)) throw new ApiError(422,'INN_INVALID');
    const userId=await this.tx(ctx,async db=>(await this.identity(db,ctx)).user.id);
    let result;
    try {result=await this.lookup.lookup(inn);} catch {throw new ApiError(503,'ORGANIZATION_LOOKUP_UNAVAILABLE');}
    if(!result) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      if(user.id!==userId) throw new ApiError(401,'SESSION_REVOKED');
      const id=randomUUID(),expires=deadline(900);
      await db.query('INSERT INTO web_auth.lookups VALUES($1,$2,$3,$4,$5,$6)',[id,user.id,inn,result.legal_name,result.legal_address,expires]);
      return {status:200,body:{lookup_id:id,inn,...result,expires_at:expires}};
    });
  }
  async creationStatus(ctx:Context,key:string) {
    if(!uuid.test(key)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      const {rows:[receipt]}=await db.query('SELECT organization_id FROM web_auth.org_receipts WHERE user_id=$1 AND key=$2',[user.id,key]);
      if(!receipt) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      return {status:200,body:{organization:await this.organization(db,user.id,receipt.organization_id)}};
    });
  }
  async createOrganization(ctx:Context,input:Record<string,unknown>,key:string) {
    const lookup=required(input,'lookup_id',36);
    if(!uuid.test(lookup)||!uuid.test(key)||input.confirm!==true||Object.keys(input).length!==2) throw new ApiError(400,'INVALID_REQUEST');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx),fp=this.fingerprint(input);
      const {rows:[receipt]}=await db.query('SELECT * FROM web_auth.org_receipts WHERE user_id=$1 AND key=$2',[user.id,key]);
      if(receipt) {
        if(receipt.fingerprint!==fp) throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        return {status:200,body:{organization:await this.organization(db,user.id,receipt.organization_id)},replayed:true};
      }
      const {rows:[row]}=await db.query('SELECT *,expires_at>clock_timestamp() AS fresh FROM web_auth.lookups WHERE id=$1 AND user_id=$2',[lookup,user.id]);
      if(!row) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      if(!row.fresh) throw new ApiError(409,'LOOKUP_EXPIRED');
      const id=randomUUID(),member=randomUUID();
      await this.scope(db,id);
      try {
        await db.query('INSERT INTO control.organizations(id,max_calls,inn,legal_name,legal_address,owner_membership_id) VALUES($1,1,$2,$3,$4,$5)',
          [id,row.inn,row.legal_name,row.legal_address,member]);
      } catch(error) {
        if((error as {code?:string}).code==='23505') throw new ApiError(409,'ORGANIZATION_ALREADY_EXISTS');
        throw error;
      }
      await db.query("INSERT INTO control.memberships VALUES($1,$2,$3,'owner',true)",[id,member,user.id]);
      await db.query('INSERT INTO control.subscriptions VALUES($1,false,false)',[id]);
      await db.query('INSERT INTO web_auth.org_receipts VALUES($1,$2,$3,$4)',[user.id,key,fp,id]);
      await this.audit(db,ctx,'organization.created',user.id,id,id,{verification_status:'unverified',owner_membership_id:member});
      return {status:201,body:{organization:await this.organization(db,user.id,id)}};
    });
  }
  
  async deliverOne() {
    const leaseToken = randomUUID();

    // Atomic claim: only one worker owns this job.
    const { rows: [job] } = await this.pool.query(`
      WITH candidate AS (
        SELECT j.challenge_id
        FROM web_auth.mail_jobs j
        WHERE j.completed_at IS NULL
          AND j.available_at <= clock_timestamp()
          AND (
            j.lease_until IS NULL
            OR j.lease_until <= clock_timestamp()
          )
        ORDER BY j.available_at
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED
      )
      UPDATE web_auth.mail_jobs j
      SET lease_token = $1,
          lease_until = clock_timestamp() + interval '30 seconds'
      FROM candidate, web_auth.challenges c, web_auth.browsers b
      WHERE j.challenge_id = candidate.challenge_id
        AND c.id = j.challenge_id
        AND b.hash = c.browser_hash
      RETURNING
        j.challenge_id,
        j.envelope,
        j.attempts,
        c.expires_at,
        c.consumed_at,
        b.challenge_id AS active_challenge_id,
        EXISTS (
          SELECT 1
          FROM control.users u
          WHERE lower(u.login) = c.email
        ) AS existing
    `, [leaseToken]);

    if (!job) return;

    const current =
      !job.consumed_at &&
      job.challenge_id === job.active_challenge_id &&
      new Date(job.expires_at).getTime() > Date.now();

    if (!current) {
      await this.pool.query(`
        UPDATE web_auth.mail_jobs
        SET completed_at = clock_timestamp(),
            envelope = NULL,
            lease_token = NULL,
            lease_until = NULL
        WHERE challenge_id = $1
          AND lease_token = $2
      `, [job.challenge_id, leaseToken]);
      return;
    }

    try {
      // No PostgreSQL transaction is open during network I/O.
      const message = this.open(job.envelope);

      await this.mail.send({
        id: job.challenge_id,
        email: message.email,
        code: job.existing ? null : message.code,
      });

      await this.pool.query(`
        WITH finished AS (
          UPDATE web_auth.mail_jobs
          SET completed_at = clock_timestamp(),
              envelope = NULL,
              lease_token = NULL,
              lease_until = NULL
          WHERE challenge_id = $1
            AND lease_token = $2
          RETURNING challenge_id
        )
        UPDATE web_auth.challenges c
        SET delivery = 'accepted'
        FROM finished
        WHERE c.id = finished.challenge_id
      `, [job.challenge_id, leaseToken]);
    } catch (error) {
      const permanent=error instanceof MailDeliveryError && !error.retryable;
      await this.pool.query(`
        WITH failed AS (
          UPDATE web_auth.mail_jobs
          SET attempts = attempts + 1,
              available_at = clock_timestamp() +
                (make_interval(secs => LEAST(240,60*power(2,LEAST(attempts,2)))::int)
                 + make_interval(secs => floor(random()*10)::int)),
              completed_at = CASE
                WHEN $3::boolean OR attempts >= 4 THEN clock_timestamp()
                ELSE NULL
              END,
              envelope = CASE
                WHEN $3::boolean OR attempts >= 4 THEN NULL
                ELSE envelope
              END,
              lease_token = NULL,
              lease_until = NULL
          WHERE challenge_id = $1
            AND lease_token = $2
          RETURNING challenge_id
        )
        UPDATE web_auth.challenges c
        SET delivery = 'failed'
        FROM failed
        WHERE c.id = failed.challenge_id
      `, [job.challenge_id, leaseToken, permanent]);
    }
  }
}
