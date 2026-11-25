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
  send(message: {id:string;email:string;code:string|null;purpose?:'verify'|'password_reset'|'invitation'}): Promise<void>;
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
  async tx<T>(ctx:Context,fn:(db:PoolClient)=>Promise<T>,readOnly=false) {
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      // Read-only views must not serialize behind one shared browser row.
      // Mutations retain the exclusive lock to protect challenges and refresh.
      const statement=readOnly
        ? 'SELECT hash FROM web_auth.browsers WHERE hash=$1 AND expires_at>clock_timestamp()'
        : 'SELECT hash FROM web_auth.browsers WHERE hash=$1 AND expires_at>clock_timestamp() FOR UPDATE';
      const locked=await db.query(statement,[hash(ctx.browser)]);
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
  async identity(db:PoolClient,ctx:Context,readOnly=false) {
    if(!ctx.access) throw new ApiError(401,'SESSION_REVOKED');
    const {rows:[family]}=await db.query(`SELECT *,access_expires>clock_timestamp() AS fresh FROM web_auth.families
      WHERE access_hash=$1 AND browser_hash=$2 ${readOnly?'':'FOR UPDATE'}`,[hash(ctx.access),hash(ctx.browser)]);
    if(!family||family.revoked_at) throw new ApiError(401,'SESSION_REVOKED');
    if(!family.fresh) throw new ApiError(401,'ACCESS_EXPIRED');
    const {rows:[user]}=await db.query('SELECT * FROM control.users WHERE id=$1 '+(readOnly?'':'FOR UPDATE'),[family.user_id]);
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

  async requestPasswordReset(ctx:Context,input:Record<string,unknown>) {
    exact(input,['email']);
    const email=required(input,'email',254).trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422,'INVALID_EMAIL');
    return this.tx(ctx,async db=>{
      // The result is identical whether or not the account exists.
      await this.limit(db,'password-reset-browser:'+hash(ctx.browser),6,3600);
      const {rows:[user]}=await db.query(
        'SELECT id FROM control.users WHERE lower(login)=$1 AND active AND email_verified_at IS NOT NULL',
        [email],
      );
      if(user) {
        // Silently suppress excessive requests without disclosing account presence.
        const {rows:[recent]}=await db.query(
          "SELECT count(*)::int AS total FROM web_auth.password_resets WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 hour'",
          [user.id],
        );
        if(recent.total<5) {
          await db.query(
            'UPDATE web_auth.password_resets SET consumed_at=clock_timestamp(),reset_hash=NULL WHERE user_id=$1 AND consumed_at IS NULL',
            [user.id],
          );
          const id=randomUUID(),code=randomInt(0,1000000).toString().padStart(6,'0');
          await db.query(
            'INSERT INTO web_auth.password_resets(id,user_id,browser_hash,email,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
            [id,user.id,hash(ctx.browser),email,this.fingerprint([id,code]),deadline(600)],
          );
          await db.query('INSERT INTO web_auth.password_reset_mail_jobs(reset_id,envelope) VALUES($1,$2)',
            [id,this.seal({email,code})]);
          await this.audit(db,ctx,'account.password_reset_requested',user.id,null,id);
        }
      }
      return {status:202,body:{accepted:true,resend_after:60}};
    });
  }
  async verifyPasswordReset(ctx:Context,input:Record<string,unknown>) {
    exact(input,['email','code']);
    const email=required(input,'email',254).trim().toLowerCase();
    const code=required(input,'code',6);
    if(!/^\d{6}$/.test(code)) throw new ApiError(400,'CODE_INVALID_OR_EXPIRED');
    return this.tx(ctx,async db=>{
      await this.limit(db,'password-reset-verify:'+hash(ctx.browser),20,3600);
      const {rows:[row]}=await db.query(
        `SELECT r.* FROM web_auth.password_resets r
          WHERE r.email=$1 AND r.browser_hash=$2
          ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE`,
        [email,hash(ctx.browser)],
      );
      if(!row||row.consumed_at||row.verified_at||row.attempts>=5||
         new Date(row.expires_at).getTime()<=Date.now())
        throw new ApiError(400,'CODE_INVALID_OR_EXPIRED');
      await db.query('UPDATE web_auth.password_resets SET attempts=attempts+1 WHERE id=$1',[row.id]);
      if(row.code_hash!==this.fingerprint([row.id,code]))
        throw new CommitError(400,'CODE_INVALID_OR_EXPIRED');
      const reset_token=token();
      await db.query(
        'UPDATE web_auth.password_resets SET verified_at=clock_timestamp(),reset_hash=$2 WHERE id=$1',
        [row.id,hash(reset_token)],
      );
      await this.audit(db,ctx,'account.password_reset_verified',row.user_id,null,row.id);
      return {status:200,body:{reset_token,expires_in:600}};
    });
  }
  async completePasswordReset(ctx:Context,input:Record<string,unknown>) {
    exact(input,['email','reset_token','password']);
    const email=required(input,'email',254).trim().toLowerCase();
    const reset_token=required(input,'reset_token',256);
    const password=required(input,'password',512);
    if([...password].length<8||[...password].length>128||Buffer.byteLength(password)>512)
      throw new ApiError(422,'INVALID_PASSWORD');
    const password_hash=await passwordHash(password);
    return this.tx(ctx,async db=>{
      const {rows:[row]}=await db.query(
        `SELECT * FROM web_auth.password_resets
          WHERE email=$1 AND browser_hash=$2 AND reset_hash=$3
            AND verified_at IS NOT NULL AND consumed_at IS NULL
            AND expires_at>clock_timestamp()
          FOR UPDATE`,
        [email,hash(ctx.browser),hash(reset_token)],
      );
      if(!row) throw new ApiError(400,'RESET_INVALID_OR_EXPIRED');
      const {rows:[user]}=await db.query('SELECT id FROM control.users WHERE id=$1 AND active FOR UPDATE',[row.user_id]);
      if(!user) throw new ApiError(400,'RESET_INVALID_OR_EXPIRED');
      await db.query('UPDATE control.users SET password_hash=$2 WHERE id=$1',[user.id,password_hash]);
      await db.query('UPDATE web_auth.families SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1',[user.id]);
      await db.query(
        'UPDATE web_auth.password_resets SET consumed_at=clock_timestamp(),reset_hash=NULL WHERE user_id=$1 AND consumed_at IS NULL',
        [user.id],
      );
      await db.query(
        `UPDATE web_auth.browsers SET completion=NULL,completion_family=NULL,completion_expires=NULL
         WHERE hash IN (SELECT browser_hash FROM web_auth.families WHERE user_id=$1)`,
        [user.id],
      );
      await this.audit(db,ctx,'account.password_reset_completed',user.id,null,row.id);
      return {status:200,body:{password_changed:true},cookies:{access:'',refresh:''}};
    });
  }
  async deliverPasswordResetOne() {
    const leaseToken=randomUUID();
    const {rows:[job]}=await this.pool.query(
      `WITH candidate AS (
        SELECT j.reset_id FROM web_auth.password_reset_mail_jobs j
        WHERE j.completed_at IS NULL AND j.available_at<=clock_timestamp()
          AND (j.lease_until IS NULL OR j.lease_until<=clock_timestamp())
        ORDER BY j.available_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED
       )
       UPDATE web_auth.password_reset_mail_jobs j
       SET lease_token=$1,lease_until=clock_timestamp()+interval '30 seconds'
       FROM candidate,web_auth.password_resets r
       WHERE j.reset_id=candidate.reset_id AND r.id=j.reset_id
       RETURNING j.reset_id,j.envelope,j.attempts,r.consumed_at,r.expires_at`,
      [leaseToken],
    );
    if(!job)return;
    const active=!job.consumed_at&&new Date(job.expires_at).getTime()>Date.now();
    if(!active) {
      await this.pool.query(
        'UPDATE web_auth.password_reset_mail_jobs SET completed_at=clock_timestamp(),envelope=NULL,lease_token=NULL,lease_until=NULL WHERE reset_id=$1 AND lease_token=$2',
        [job.reset_id,leaseToken],
      );
      return;
    }
    try {
      const message=this.open(job.envelope);
      await this.mail.send({id:job.reset_id,email:message.email,code:message.code,purpose:'password_reset'});
      await this.pool.query(
        'UPDATE web_auth.password_reset_mail_jobs SET completed_at=clock_timestamp(),envelope=NULL,lease_token=NULL,lease_until=NULL WHERE reset_id=$1 AND lease_token=$2',
        [job.reset_id,leaseToken],
      );
    } catch(error) {
      const permanent=error instanceof MailDeliveryError&&!error.retryable;
      await this.pool.query(
        `UPDATE web_auth.password_reset_mail_jobs
         SET attempts=attempts+1,
             available_at=clock_timestamp()+make_interval(secs=>LEAST(240,60*power(2,LEAST(attempts,2)))::int),
             completed_at=CASE WHEN $3::boolean OR attempts>=4 THEN clock_timestamp() ELSE NULL END,
             envelope=CASE WHEN $3::boolean OR attempts>=4 THEN NULL ELSE envelope END,
             lease_token=NULL,lease_until=NULL
         WHERE reset_id=$1 AND lease_token=$2`,
        [job.reset_id,leaseToken,permanent],
      );
    }
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
    const {rows:[row]}=await db.query(`SELECT o.id,o.inn,o.legal_name,coalesce(o.display_name,o.legal_name) AS display_name,o.verification_status,o.active,m.id AS membership_id,
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
      const {user}=await this.identity(db,ctx,true);
      // One bounded, account-scoped query instead of N tenant-switching queries.
      const {rows}=await db.query('SELECT * FROM web_auth.account_organizations($1)',[user.id]);
      return {status:200,body:{items:rows}};
    },true);
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
  async renameOrganization(ctx:Context,id:string,input:Record<string,unknown>) {
    exact(input,['display_name']);
    if(!uuid.test(id)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const name=typeof input.display_name==='string'?input.display_name.trim():'';
    if(!name||[...name].length>180||/[\p{Cc}\p{Cf}]/u.test(name)) throw new ApiError(422,'INVALID_DISPLAY_NAME');
    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);
      if(family.organization_id!==id) throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');
      try {
        const {rows:[row]}=await db.query('SELECT web_auth.rename_organization($1,$2,$3) AS changes',[user.id,id,name]);
        if(row.changes) await this.audit(db,ctx,'organization.display_name_changed',user.id,id,id,row.changes);
      } catch(error) {
        if((error as {code?:string}).code==='42501') throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');
        throw error;
      }
      return {status:200,body:{organization:await this.organization(db,user.id,id)}};
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
    let items:Array<{inn:string;legal_name:string;legal_address:string}>;
    try {
      items=await this.lookup.suggest(query);
    } catch {
      throw new ApiError(503,'ORGANIZATION_LOOKUP_UNAVAILABLE');
    }
    return this.tx(ctx,async db=>{
      await this.identity(db,ctx);
      const {rows}=await db.query(
        'SELECT inn FROM web_auth.verified_inns($1::text[])',
        [items.map(item=>item.inn)],
      );
      const claimed=new Set(rows.map(row=>row.inn as string));
      return {status:200,body:{items:items.map(item=>({...item,verified:claimed.has(item.inn)}))}};
    });
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
  async internalSession(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      const {rows:[role]}=await db.query('SELECT web_auth.internal_staff_role($1) AS role',[user.id]);
      if(!role?.role) throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
      const capabilities=['organizations:list'];
      if(['owner','admin','manager'].includes(role.role))
        capabilities.push('billing:overview');
      if(['owner','admin'].includes(role.role))
        capabilities.push('billing:read','billing:manage');
      if(['owner','admin','manager'].includes(role.role))
        capabilities.push('organizations:revoke_verification');
      if(['owner','admin','manager','reviewer'].includes(role.role)) capabilities.push('organizations:review');
      if(['owner','admin'].includes(role.role)) capabilities.push('organizations:reopen','organizations:create','organizations:assign_manager');
      if(['owner','admin','manager'].includes(role.role)) capabilities.push('client_context:read');
      if(['owner','admin','manager'].includes(role.role))
        capabilities.push('staff:list');
      if(['owner','admin'].includes(role.role))
        capabilities.push('staff:manage');
      return {status:200,body:{role:role.role,capabilities}};
    },true);
  }
  private billingError(error:unknown):never {
    const failure=error as {code?:string,message?:string};
    if(failure.code==='42501')
      throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
    if(failure.code==='P0002')
      throw new ApiError(404,'RESOURCE_NOT_FOUND');
    if(failure.code==='23505')
      throw new ApiError(409,failure.message==='IDEMPOTENCY_CONFLICT'
        ?'IDEMPOTENCY_CONFLICT':'PAYMENT_REFERENCE_EXISTS');
    if(failure.code==='22023')
      throw new ApiError(422,'INVALID_BILLING_OPERATION');
    throw error;
  }

  private billingField(
    input:Record<string,unknown>,name:string,max:number
  ):string {
    const value=input[name];
    if(typeof value!=='string'||value.length===0||value.length>max)
      throw new ApiError(422,'INVALID_BILLING_OPERATION');
    return value;
  }

  async setOrganizationStaff(
    ctx:Context,org:string,input:Record<string,unknown>
  ) {
    exact(input,['membership_id','role','active']);

    const member=required(input,'membership_id',36);
    const role=required(input,'role',16);

    if(!uuid.test(org)||!uuid.test(member)
       ||!['admin','manager'].includes(role)
       ||typeof input.active!=='boolean')
      throw new ApiError(422,'INVALID_STAFF_ACCESS');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);

      if(family.organization_id!==org)
        throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.set_organization_staff($1,$2,$3,$4,$5) AS changes',
          [user.id,org,member,role,input.active]
        );

        if(row.changes)
          await this.audit(
            db,ctx,'organization.staff_access_changed',
            user.id,org,member,row.changes
          );

        return {
          status:200,
          body:{
            membership_id:member,
            role,
            active:input.active
          }
        };
      } catch(error) {
        const code=(error as {code?:string}).code;

        if(code==='42501')
          throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');
        if(code==='P0002')
          throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(code==='23514')
          throw new ApiError(403,'PROTECTED_OWNER');
        if(code==='22023')
          throw new ApiError(422,'INVALID_STAFF_ACCESS');

        throw error;
      }
    });
  }

  private invitationError(error:unknown):never {
    const e=error as {code?:string,message?:string};
    if(e.code==='42501')
      throw new ApiError(403,'INVITATION_ACCESS_DENIED');
    if(e.code==='P0002')
      throw new ApiError(404,'RESOURCE_NOT_FOUND');
    if(e.code==='23514')
      throw new ApiError(409,'INVITATION_UNAVAILABLE');
    if(e.code==='23505')
      throw new ApiError(409,'INVITATION_CONFLICT');
    if(e.code==='22023')
      throw new ApiError(422,'INVALID_INVITATION');
    throw error;
  }

  async createInitialOwnerInvitation(
    ctx:Context,input:Record<string,unknown>
  ) {
    exact(input,['organization_id','email']);
    const org=required(input,'organization_id',36);
    const email=required(input,'email',254).trim().toLowerCase();

    if(!uuid.test(org))
      throw new ApiError(422,'INVALID_INVITATION');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);

      await this.limit(db,'initial-owner-invite:'+user.id,30,3600);

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.create_initial_owner_invitation($1,$2,$3,$4) AS result',
          [user.id,org,randomUUID(),email]
        );

        if(!row.result.replayed)
          await this.audit(
            db,ctx,'organization.owner_invited',
            user.id,org,row.result.id
          );

        return {
          status:row.result.replayed?200:201,
          body:{invitation:row.result},
          replayed:row.result.replayed
        };
      } catch(error) {this.invitationError(error);}
    });
  }

  async revokeInitialOwnerInvitation(
    ctx:Context,input:Record<string,unknown>
  ) {
    exact(input,['organization_id','invitation_id']);

    const org=required(input,'organization_id',36);
    const id=required(input,'invitation_id',36);

    if(!uuid.test(org)||!uuid.test(id))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.revoke_initial_owner_invitation($1,$2,$3) AS changed',
          [user.id,org,id]
        );

        if(row.changed)
          await this.audit(
            db,ctx,'organization.owner_invitation_revoked',
            user.id,org,id
          );

        return {status:204};
      } catch(error) {this.invitationError(error);}
    });
  }

  async createStaffInvitation(
    ctx:Context,org:string|null,input:Record<string,unknown>
  ) {
    exact(input,['email','role']);
    const email=required(input,'email',254).trim().toLowerCase();
    const role=required(input,'role',16);

    if((org!==null&&!uuid.test(org))
       ||!['admin','manager'].includes(role))
      throw new ApiError(422,'INVALID_INVITATION');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);

      if(org!==null&&family.organization_id!==org)
        throw new ApiError(403,'INVITATION_ACCESS_DENIED');

      await this.limit(db,'staff-invite:'+user.id,50,3600);

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.create_staff_invitation($1,$2,$3,$4,$5) AS result',
          [user.id,org,randomUUID(),email,role]
        );

        if(!row.result.replayed)
          await this.audit(
            db,ctx,'staff.invitation_created',
            user.id,org,row.result.id,{role}
          );

        return {
          status:row.result.replayed?200:201,
          body:{invitation:row.result},
          replayed:row.result.replayed
        };
      } catch(error) {this.invitationError(error);}
    });
  }

  async outgoingStaffInvitations(ctx:Context,org:string|null) {
    if(org!==null&&!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx,true);

      if(org!==null&&family.organization_id!==org)
        throw new ApiError(403,'INVITATION_ACCESS_DENIED');

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.outgoing_staff_invitations($1,$2) AS items',
          [user.id,org]
        );
        return {status:200,body:{items:row.items}};
      } catch(error) {this.invitationError(error);}
    },true);
  }

  async resendStaffInvitation(
    ctx:Context,org:string|null,input:Record<string,unknown>
  ) {
    exact(input,['invitation_id']);
    const id=required(input,'invitation_id',36);

    if(!uuid.test(id)||(org!==null&&!uuid.test(org)))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);

      if(org!==null&&family.organization_id!==org)
        throw new ApiError(403,'INVITATION_ACCESS_DENIED');

      await this.limit(db,'staff-invite-resend:'+user.id,30,3600);

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.resend_staff_invitation($1,$2,$3,$4) AS queued',
          [user.id,org,id,randomUUID()]
        );

        if(row.queued)
          await this.audit(
            db,ctx,'staff.invitation_resent',user.id,org,id
          );

        return {status:200,body:{queued:row.queued}};
      } catch(error) {this.invitationError(error);}
    });
  }

  async pendingStaffInvitations(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      const {rows:[row]}=await db.query(
        'SELECT web_auth.pending_staff_invitations($1) AS items',
        [user.id]
      );
      return {status:200,body:{items:row.items}};
    },true);
  }

  async acceptStaffInvitation(
    ctx:Context,input:Record<string,unknown>
  ) {
    exact(input,['invitation_id']);
    const id=required(input,'invitation_id',36);
    if(!uuid.test(id))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.accept_staff_invitation($1,$2,$3) AS result',
          [user.id,id,randomUUID()]
        );

        if(!row.result.replayed)
          await this.audit(
            db,ctx,'staff.invitation_accepted',
            user.id,row.result.organization_id,id,
            {role:row.result.role}
          );

        return {status:200,body:row.result};
      } catch(error) {this.invitationError(error);}
    });
  }

  async revokeStaffInvitation(
    ctx:Context,org:string|null,input:Record<string,unknown>
  ) {
    exact(input,['invitation_id']);
    const id=required(input,'invitation_id',36);

    if(!uuid.test(id)||(org!==null&&!uuid.test(org)))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);

      if(org!==null&&family.organization_id!==org)
        throw new ApiError(403,'INVITATION_ACCESS_DENIED');

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.revoke_staff_invitation($1,$2,$3) AS changed',
          [user.id,org,id]
        );

        if(row.changed)
          await this.audit(
            db,ctx,'staff.invitation_revoked',
            user.id,org,id
          );

        return {status:204};
      } catch(error) {this.invitationError(error);}
    });
  }

  async organizationStaff(ctx:Context,org:string) {
    if(!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx,true);

      if(family.organization_id!==org)
        throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.organization_staff($1,$2) AS items',
          [user.id,org]
        );

        return {status:200,body:{items:row.items}};
      } catch(error) {
        if((error as {code?:string}).code==='42501')
          throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');
        throw error;
      }
    },true);
  }

  async clientBilling(ctx:Context,org:string) {
    if(!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx,true);

      if(family.organization_id!==org)
        throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.organization_billing_details($1,$2,false) AS summary',
          [user.id,org]
        );
        return {status:200,body:{summary:row.summary}};
      } catch(error) {
        if((error as {code?:string}).code==='42501')
          throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');
        this.billingError(error);
      }
    },true);
  }

  async billingInvoices(
    ctx:Context,org:string,internal:boolean,
    offset=0,limit=50
  ) {
    if(!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx,true);

      if(!internal&&family.organization_id!==org)
        throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.organization_invoices($1,$2,$3,$4,$5) AS items',
          [user.id,org,internal,offset,limit]
        );
        return {status:200,body:{items:row.items}};
      } catch(error) {
        if(!internal&&(error as {code?:string}).code==='42501')
          throw new ApiError(403,'ORGANIZATION_ACCESS_DENIED');
        this.billingError(error);
      }
    },true);
  }

  async setBillingSchedule(ctx:Context,input:Record<string,unknown>) {
    exact(input,['organization_id','next_period_end','reason']);

    const org=this.billingField(input,'organization_id',36);
    const date=this.billingField(input,'next_period_end',10);
    const reason=this.billingField(input,'reason',2000).trim();

    const parsed=new Date(date+'T00:00:00.000Z');

    if(!uuid.test(org)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
       ||!Number.isFinite(parsed.getTime())
       ||parsed.toISOString().slice(0,10)!==date
       ||reason.length<8)
      throw new ApiError(422,'INVALID_BILLING_OPERATION');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.set_billing_schedule($1,$2,$3) AS changes',
          [user.id,org,date]
        );

        if(row.changes)
          await this.audit(
            db,ctx,'internal.billing_schedule_changed',
            user.id,org,org,{...row.changes,reason}
          );

        return {status:200,body:{next_period_end:date}};
      } catch(error) {this.billingError(error);}
    });
  }

  async billingOverview(ctx:Context,from:string,to:string) {
    const valid=(value:string)=>{
      if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))
        return false;
      const date=new Date(value+'T00:00:00.000Z');
      return Number.isFinite(date.getTime())&&
        date.toISOString().slice(0,10)===value;
    };

    if(!valid(from)||!valid(to))
      throw new ApiError(422,'INVALID_DATE_RANGE');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);

      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.internal_billing_overview($1,$2,$3) AS overview',
          [user.id,from,to]
        );
        return {status:200,body:{overview:row.overview}};
      } catch(error) {
        if((error as {code?:string}).code==='22023')
          throw new ApiError(422,'INVALID_DATE_RANGE');
        this.billingError(error);
      }
    },true);
  }

  async billingSummary(ctx:Context,org:string) {
    if(!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.billing_summary($1,$2) AS summary',
          [user.id,org]
        );
        return {status:200,body:{summary:row.summary}};
      } catch(error) {this.billingError(error);}
    },true);
  }

  async billingHistory(ctx:Context,org:string,offset=0,limit=50) {
    if(!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.billing_history($1,$2,$3,$4) AS items',
          [user.id,org,offset,limit]
        );
        return {status:200,body:{items:row.items}};
      } catch(error) {this.billingError(error);}
    },true);
  }

  async recordBillingTransaction(
    ctx:Context,input:Record<string,unknown>,key:string
  ) {
    const fields=[
      'organization_id','kind','amount_kopeks','reference','reason'
    ];

    if(Object.keys(input).length!==fields.length||
       Object.keys(input).some(field=>!fields.includes(field)))
      throw new ApiError(422,'INVALID_BILLING_OPERATION');

    const org=this.billingField(input,'organization_id',36);
    const kind=this.billingField(input,'kind',16);
    const amount=this.billingField(input,'amount_kopeks',18);
    const reference=this.billingField(input,'reference',500).trim();
    const reason=this.billingField(input,'reason',2000).trim();

    if(!uuid.test(org)||!uuid.test(key)
       ||!['payment','debit'].includes(kind)
       ||!/^[1-9][0-9]{0,17}$/.test(amount)
       ||reference.length<5||reason.length<8)
      throw new ApiError(422,'INVALID_BILLING_OPERATION');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.record_billing_transaction($1,$2,$3,$4,$5,$6,$7,$8) AS result',
          [user.id,org,randomUUID(),key,kind,amount,reference,reason]
        );

        if(!row.result.replayed)
          await this.audit(
            db,ctx,'internal.billing_transaction',
            user.id,org,row.result.transaction_id,
            {kind,amount_kopeks:amount,reference,reason}
          );

        return {
          status:row.result.replayed?200:201,
          body:{transaction_id:row.result.transaction_id},
          replayed:row.result.replayed
        };
      } catch(error) {this.billingError(error);}
    });
  }

  async changeBillingDueDate(ctx:Context,input:Record<string,unknown>) {
    const fields=['organization_id','invoice_id','due_at','reason'];

    if(Object.keys(input).length!==fields.length||
       Object.keys(input).some(field=>!fields.includes(field)))
      throw new ApiError(422,'INVALID_BILLING_OPERATION');

    const org=this.billingField(input,'organization_id',36);
    const invoice=this.billingField(input,'invoice_id',36);
    const due=this.billingField(input,'due_at',32);
    const reason=this.billingField(input,'reason',2000).trim();

    if(!uuid.test(org)||!uuid.test(invoice)
       ||!Number.isFinite(Date.parse(due))
       ||!due.endsWith('Z')||reason.length<8)
      throw new ApiError(422,'INVALID_BILLING_OPERATION');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.change_billing_due_date($1,$2,$3,$4) AS changes',
          [user.id,org,invoice,due]
        );

        await this.audit(
          db,ctx,'internal.billing_due_date_changed',
          user.id,org,invoice,{...row.changes,reason}
        );

        return {status:200,body:row.changes};
      } catch(error) {this.billingError(error);}
    });
  }

  async internalStaff(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      try {
        const {rows}=await db.query('SELECT * FROM web_auth.list_internal_staff($1)',[user.id]);
        return {status:200,body:{items:rows}};
      } catch(error) {
        if((error as {code?:string}).code==='42501') throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        throw error;
      }
    },true);
  }
  async setInternalStaff(ctx:Context,input:Record<string,unknown>) {
    exact(input,['user_id','role']);
    const target=required(input,'user_id',36);
    if(!uuid.test(target)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const role=input.role;
    if(role!==null&&role!=='admin'&&role!=='manager') throw new ApiError(422,'INVALID_ROLE');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      try {
        const {rows:[row]}=await db.query('SELECT web_auth.set_internal_staff($1,$2,$3) AS changes',[user.id,target,role]);
        if(row.changes) await this.audit(db,ctx,'internal.staff_access_changed',user.id,null,target,row.changes);
        return {status:204};
      } catch(error) {
        const failure=error as {code?:string,message?:string};
        if(failure.code==='42501') throw new ApiError(403,failure.message==='PROTECTED_OWNER'?'PROTECTED_OWNER':'INTERNAL_ACCESS_DENIED');
        if(failure.code==='P0002') throw new ApiError(404,'RESOURCE_NOT_FOUND');
        throw error;
      }
    });
  }
  async internalClientContext(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx,true);
      const {rows:[row]}=await db.query('SELECT web_auth.internal_client_view($1,$2) AS context',[user.id,family.id]);
      if(!row.context) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      return {status:200,body:{context:row.context}};
    },true);
  }
  async openInternalClient(ctx:Context,input:Record<string,unknown>) {
    exact(input,['organization_id']);
    const orgId=required(input,'organization_id',36);
    if(!uuid.test(orgId)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);
      const id=randomUUID();
      try {
        const {rows:[row]}=await db.query('SELECT web_auth.open_internal_client($1,$2,$3,$4) AS context',[user.id,family.id,orgId,id]);
        if(!row.context) throw new ApiError(404,'RESOURCE_NOT_FOUND');
        await this.audit(db,ctx,'internal.client_context_opened',user.id,orgId,id,{expires_at:row.context.expires_at});
        return {status:201,body:{context:row.context}};
      } catch(error) {
        const code=(error as {code?:string}).code;
        if(code==='42501') throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        if(code==='P0002') throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(code==='23514') throw new ApiError(409,'INTERNAL_CONTEXT_ACTIVE');
        throw error;
      }
    });
  }
  async closeInternalClient(ctx:Context,input:Record<string,unknown>) {
    exact(input,['context_id']);
    const id=required(input,'context_id',36);
    if(!uuid.test(id)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    return this.tx(ctx,async db=>{
      const {family,user}=await this.identity(db,ctx);
      const {rows:[row]}=await db.query('SELECT web_auth.close_internal_client($1,$2,$3) AS organization_id',[user.id,family.id,id]);
      if(row.organization_id) await this.audit(db,ctx,'internal.client_context_closed',user.id,row.organization_id,id);
      return {status:204};
    });
  }
  async responsibleManagerCandidates(ctx:Context) {
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      try {
        const {rows}=await db.query(
          'SELECT * FROM web_auth.responsible_manager_candidates($1)',
          [user.id]
        );
        return {status:200,body:{items:rows}};
      } catch(error) {
        if((error as {code?:string}).code==='42501')
          throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        throw error;
      }
    },true);
  }

  async setResponsibleManager(ctx:Context,input:Record<string,unknown>) {
    exact(input,['organization_id','user_id']);
    const org=required(input,'organization_id',36);
    const target=input.user_id;

    if(!uuid.test(org))
      throw new ApiError(404,'RESOURCE_NOT_FOUND');

    if(target!==null && (typeof target!=='string'||!uuid.test(target)))
      throw new ApiError(422,'INVALID_RESPONSIBLE_MANAGER');

    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx);
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.set_responsible_manager($1,$2,$3) AS changes',
          [user.id,org,target]
        );

        if(row.changes)
          await this.audit(
            db,ctx,'internal.responsible_manager_changed',
            user.id,org,org,row.changes
          );

        return {status:204};
      } catch(error) {
        const code=(error as {code?:string}).code;
        if(code==='42501')
          throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        if(code==='P0002')
          throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(code==='22023')
          throw new ApiError(422,'INVALID_RESPONSIBLE_MANAGER');
        throw error;
      }
    });
  }

  async internalOrganizations(
    ctx:Context,
    page:{offset?:number;limit?:number;manager?:string}={}
  ) {
    if(page.manager!==undefined &&
       page.manager!=='unassigned' &&
       !uuid.test(page.manager))
      throw new ApiError(422,'INVALID_PAGE');
    const offset=page.offset??0,limit=page.limit??200;
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000||
       !Number.isSafeInteger(limit)||limit<1||limit>200) throw new ApiError(422,'INVALID_PAGE');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx,true);
      try {
        const {rows}=await db.query('SELECT * FROM web_auth.internal_organizations_page($1,$2,$3,$4)',[user.id,offset,limit,page.manager??null]);
        const more=rows.length>limit;
        return {status:200,body:{items:rows.slice(0,limit),next_offset:more?offset+limit:null}};
      } catch(error) {
        if((error as {code?:string}).code==='42501') throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        throw error;
      }
    },true);
  }
  async reviewOrganization(ctx:Context,orgId:string,input:Record<string,unknown>) {
    if(!uuid.test(orgId)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    exact(input,['decision','evidence_reference','explanation']);
    const decision=required(input,'decision',16);
    const evidence=required(input,'evidence_reference',500).trim();
    const explanation=required(input,'explanation',2000).trim();
    if(!['verified','rejected'].includes(decision)||evidence.length<5||explanation.length<8)
      throw new ApiError(422,'INVALID_REVIEW');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx),id=randomUUID();
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.review_organization($1,$2,$3,$4,$5,$6) AS status',
          [user.id,orgId,decision,evidence,explanation,id],
        );
        await this.audit(db,ctx,'internal.organization_review',user.id,orgId,orgId,{decision,review_id:id,evidence_reference:evidence,explanation});
        return {status:200,body:{organization_id:orgId,verification_status:row.status,review_id:id}};
      } catch(error) {
        const code=(error as {code?:string,message?:string}).code;
        const message=(error as {message?:string}).message||'';
        if(code==='42501') throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        if(code==='P0002') throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(code==='23514') throw new ApiError(409,'ALREADY_REVIEWED');
        if(code==='23505') throw new ApiError(409,'VERIFIED_ORGANIZATION_EXISTS');
        if(code==='22023') throw new ApiError(422,'INVALID_REVIEW');
        throw error;
      }
    });
  }
  async reopenOrganization(ctx:Context,orgId:string,input:Record<string,unknown>) {
    if(!uuid.test(orgId)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    exact(input,['evidence_reference','explanation']);
    const evidence=required(input,'evidence_reference',500).trim();
    const explanation=required(input,'explanation',2000).trim();
    if(evidence.length<5||explanation.length<8) throw new ApiError(422,'INVALID_REVIEW');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx),id=randomUUID();
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.reopen_organization_review($1,$2,$3,$4,$5) AS status',
          [user.id,orgId,evidence,explanation,id],
        );
        await this.audit(db,ctx,'internal.organization_reopened',user.id,orgId,orgId,
          {review_id:id,evidence_reference:evidence,explanation});
        return {status:200,body:{organization_id:orgId,verification_status:row.status,review_id:id}};
      } catch(error) {
        const code=(error as {code?:string}).code;
        if(code==='42501') throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        if(code==='P0002') throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(code==='23514') throw new ApiError(409,'REOPEN_REQUIRES_REJECTED');
        if(code==='22023') throw new ApiError(422,'INVALID_REVIEW');
        throw error;
      }
    });
  }
  async revokeOrganizationVerification(ctx:Context,orgId:string,input:Record<string,unknown>) {
    if(!uuid.test(orgId)) throw new ApiError(404,'RESOURCE_NOT_FOUND');
    exact(input,['evidence_reference','explanation']);
    const evidence=required(input,'evidence_reference',500).trim();
    const explanation=required(input,'explanation',2000).trim();
    if(evidence.length<5||explanation.length<8) throw new ApiError(422,'INVALID_REVIEW');
    return this.tx(ctx,async db=>{
      const {user}=await this.identity(db,ctx),id=randomUUID();
      try {
        const {rows:[row]}=await db.query(
          'SELECT web_auth.revoke_organization_verification($1,$2,$3,$4,$5) AS status',
          [user.id,orgId,evidence,explanation,id],
        );
        await this.audit(db,ctx,'internal.organization_verification_revoked',user.id,orgId,orgId,
          {review_id:id,evidence_reference:evidence,explanation});
        return {status:200,body:{organization_id:orgId,verification_status:row.status,review_id:id}};
      } catch(error) {
        const code=(error as {code?:string}).code;
        if(code==='42501') throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
        if(code==='P0002') throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(code==='23514') throw new ApiError(409,'REVOCATION_REQUIRES_VERIFIED');
        if(code==='22023') throw new ApiError(422,'INVALID_REVIEW');
        throw error;
      }
    });
  }
  async createInternalOrganization(ctx:Context,input:Record<string,unknown>,key:string) {
    exact(input,['lookup_id','inn','display_name']);
    const lookupId=required(input,'lookup_id',36);
    const inn=required(input,'inn',12);
    const displayName=required(input,'display_name',360).trim();
    if(!uuid.test(lookupId)||!uuid.test(key)) throw new ApiError(400,'INVALID_REQUEST');
    if(!validInn(inn)) throw new ApiError(422,'INN_INVALID');
    if(!displayName||[...displayName].length>180||/[\p{Cc}\p{Cf}]/u.test(displayName))
      throw new ApiError(422,'INVALID_DISPLAY_NAME');

    return this.tx(ctx,async db=>{
      // Identity locks the account row, the same row that staff-role changes lock.
      const {user}=await this.identity(db,ctx);
      const {rows:[staff]}=await db.query('SELECT web_auth.internal_staff_role($1) AS role',[user.id]);
      if(!['owner','admin'].includes(staff?.role)) throw new ApiError(403,'INTERNAL_ACCESS_DENIED');
      const fingerprint=this.fingerprint(['internal.organization_created',inn,displayName]);
      const {rows:[receipt]}=await db.query(
        'SELECT fingerprint,organization_id FROM web_auth.org_receipts WHERE user_id=$1 AND key=$2',[user.id,key],
      );
      let id=receipt?.organization_id;
      if(receipt){
        if(receipt.fingerprint!==fingerprint) throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        await this.scope(db,id);
      }else{
        const {rows:[lookup]}=await db.query(
          `SELECT legal_name,legal_address,expires_at>clock_timestamp() AS fresh
           FROM web_auth.lookups WHERE id=$1 AND user_id=$2 AND inn=$3`,[lookupId,user.id,inn],
        );
        if(!lookup) throw new ApiError(404,'RESOURCE_NOT_FOUND');
        if(!lookup.fresh) throw new ApiError(409,'LOOKUP_EXPIRED');
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[inn]);
        const {rowCount:claimed}=await db.query('SELECT inn FROM web_auth.verified_inns($1::text[])',[[inn]]);
        if(claimed) throw new ApiError(409,'ORGANIZATION_ALREADY_EXISTS');

        id=randomUUID();
        await this.scope(db,id);
        await db.query(
          `INSERT INTO control.organizations(id,max_calls,inn,legal_name,legal_address,display_name)
           VALUES($1,1,$2,$3,$4,$5)`,[id,inn,lookup.legal_name,lookup.legal_address,displayName],
        );
        await db.query('INSERT INTO control.subscriptions(organization_id,active,telephony) VALUES($1,false,false)',[id]);
        await db.query(
          'INSERT INTO web_auth.org_receipts(user_id,key,fingerprint,organization_id) VALUES($1,$2,$3,$4)',
          [user.id,key,fingerprint,id],
        );
        await this.audit(db,ctx,'internal.organization_created',user.id,id,id,{verification_status:'unverified'});
      }
      const {rows:[organization]}=await db.query(
        `SELECT id,inn,legal_name,coalesce(display_name,legal_name) AS display_name,verification_status,active
         FROM control.organizations WHERE id=$1`,[id],
      );
      return {status:receipt?200:201,body:{organization},replayed:!!receipt};
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
      // Serialize creation/review for the same INN to prevent racing a verified claim.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[row.inn]);
      // Recheck at creation time: UI disabled controls are not a security boundary.
      const {rows:[claimed]}=await db.query('SELECT inn FROM web_auth.verified_inns($1::text[])',[[row.inn]]);
      if(claimed) throw new ApiError(409,'ORGANIZATION_ALREADY_EXISTS');
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
  
  async deliverInvitationOne() {
    const lease=randomUUID();

    const {rows:[job]}=await this.pool.query(`
      WITH candidate AS (
        SELECT id FROM web_auth.invitation_mail_jobs
        WHERE completed_at IS NULL
        AND available_at<=clock_timestamp()
        AND (lease_until IS NULL OR lease_until<=clock_timestamp())
        ORDER BY available_at,id LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE web_auth.invitation_mail_jobs j
      SET lease_token=$1,
          lease_until=clock_timestamp()+interval '30 seconds'
      FROM candidate
      WHERE j.id=candidate.id
      RETURNING j.*
    `,[lease]);

    if(!job)return;

    const {rows:[row]}=await this.pool.query(
      'SELECT web_auth.invitation_mail_details($1) AS details',
      [job.invitation_id]
    );

    if(!row.details) {
      await this.pool.query(`
        UPDATE web_auth.invitation_mail_jobs
        SET completed_at=clock_timestamp(),
            delivery='cancelled',lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND lease_token=$2
      `,[job.id,lease]);
      return;
    }

    try {
      await this.mail.send({
        id:job.id,email:row.details.email,
        code:null,purpose:'invitation'
      });

      await this.pool.query(`
        UPDATE web_auth.invitation_mail_jobs
        SET completed_at=clock_timestamp(),
            delivery='accepted',lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND lease_token=$2
      `,[job.id,lease]);

    } catch(error) {
      const permanent=error instanceof MailDeliveryError&&!error.retryable;

      await this.pool.query(`
        UPDATE web_auth.invitation_mail_jobs
        SET attempts=attempts+1,
            available_at=clock_timestamp()+
              make_interval(secs=>LEAST(240,60*power(2,LEAST(attempts,2)))::int),
            completed_at=CASE WHEN $3::boolean OR attempts>=4
              THEN clock_timestamp() ELSE NULL END,
            delivery=CASE WHEN $3::boolean OR attempts>=4
              THEN 'failed' ELSE 'queued' END,
            lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND lease_token=$2
      `,[job.id,lease,permanent]);
    }
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
