import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { GlobalCarousel } from './global-carousel.ts';

const derive = promisify(scrypt);
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const e164 = /^\+[1-9][0-9]{6,14}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['ended', 'expired', 'failed']);
const visible = 'id AS call_id, state, destination, caller_id, created_at, expires_at';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code.toLowerCase().replaceAll('_', ' '));
    this.status = status;
    this.code = code;
  }
}

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const key = (await derive(password, salt, 64)) as Buffer;
  return salt + ':' + key.toString('hex');
}

export interface Originate {
  attemptId: string;
  destination: string;
  callerId: string;
  trunkId: string;
}
export type GatewayState = 'ringing' | 'connected' | 'ended' | 'unknown';
export interface CallClassification {
  outcome:'human'|'machine'|'no_answer'|'rejected'|'error'|'unknown';
  billableSeconds?:number;
  evidenceId?:string;
}
export type GatewayResult = Exclude<GatewayState,'ended'> |
  {state:'ended';classification?:CallClassification};
export interface TelephonyGateway {
  originate(command: Originate): Promise<'ringing'>;
  hangup(attemptId: string): Promise<'unknown'|{state:'ended';classification?:CallClassification}>;
  inspect(attemptId: string): Promise<GatewayResult>;
}
export interface TelephonyEvent {
  id:string;
  state:Exclude<GatewayState,'unknown'>;
  classification?:CallClassification;
}

export class ControlPlane {
  private readonly pool: Pool;
  private readonly timezone: string;
  private readonly carousel = new GlobalCarousel();
  private readonly workerAvailable: (tenant: string) => boolean;

  constructor(pool: Pool, timezone = 'Europe/Moscow', workerAvailable = (_tenant: string) => false) {
    this.pool = pool;
    this.workerAvailable = workerAvailable;
    this.timezone = timezone;
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  }

  async transaction<T>(tenant: string, operation: (db: PoolClient) => Promise<T>) {
    if (!uuid.test(tenant)) throw new ApiError(400, 'INVALID_ORGANIZATION');
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL search_path = control, pg_catalog");
      await db.query("SELECT set_config('control.tenant', $1, true)", [tenant]);
      const result = await operation(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async #organization(db: PoolClient, tenant: string) {
    const result = await db.query('SELECT active, max_calls FROM organizations WHERE id=$1 FOR UPDATE', [tenant]);
    return result.rows[0];
  }

  async login(tenant: string, login: string, password: string, device: string) {
    if (!uuid.test(device)) throw new ApiError(400, 'INVALID_DEVICE');
    return this.transaction(tenant, async db => {
      const org = await this.#organization(db, tenant);
      const { rows: [user] } = await db.query('SELECT id,password_hash,active FROM users WHERE login=$1 FOR UPDATE', [login]);
      const stored = user?.password_hash ?? '0'.repeat(32) + ':' + '0'.repeat(128);
      const actual = await hashPassword(password, stored.split(':')[0]);
      const expected = Buffer.from(stored);
      if (expected.length !== actual.length || !timingSafeEqual(expected, Buffer.from(actual)) || !user?.active) {
        throw new ApiError(401, 'INVALID_CREDENTIALS');
      }
      const { rows: [member] } = await db.query(
        'SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2 AND active', [tenant, user.id]);
      if (!member || !org?.active) throw new ApiError(403, 'ACCESS_DENIED');
      await db.query('INSERT INTO devices VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [tenant, device, member.id]);
      const { rows: [epoch] } = await db.query(
        'UPDATE users SET phone_epoch=phone_epoch+1 WHERE id=$1 RETURNING phone_epoch', [user.id]);
      const secret = randomBytes(32).toString('hex');
      await db.query(
        "INSERT INTO sessions VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',NULL)",
        [tenant, digest(secret), member.id, device, epoch.phone_epoch]);
      return { token: tenant + '.' + secret, expires_in: 900 };
    });
  }

  #credentials(bearer: string) {
    const [tenant, secret, ...rest] = bearer.split('.');
    if (rest.length || !tenant || !uuid.test(tenant) || !/^[a-f0-9]{64}$/.test(secret ?? '')) {
      throw new ApiError(401, 'INVALID_SESSION');
    }
    return { tenant, hash: digest(secret) };
  }

  async #session(db: PoolClient, tenant: string, hash: string) {
    const org = await this.#organization(db, tenant);
    if (!org?.active) throw new ApiError(403, 'ORGANIZATION_SUSPENDED');
    const { rows: [session] } = await db.query(
      `SELECT s.membership_id, u.id AS user_id, m.role_id, m.active AS member_active, u.active AS user_active,
              s.phone_epoch = u.phone_epoch AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AS valid,
              EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id=m.role_id AND p.permission='call') AS can_call,
              EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id=m.role_id AND p.permission='trunks.manage') AS can_manage_trunks,
              EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id=m.role_id AND p.permission='operator.read') AS can_read_operator,
              EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id=m.role_id AND p.permission='cabinet') AS cabinet
       FROM sessions s JOIN memberships m ON (s.organization_id,s.membership_id)=(m.organization_id,m.id)
       JOIN users u ON u.id=m.user_id
       WHERE s.organization_id=$1 AND s.token_hash=$2 FOR UPDATE OF u,m`, [tenant, hash]);
    if (!session) throw new ApiError(401, 'INVALID_SESSION');
    if (!session.user_active || !session.member_active) throw new ApiError(403, 'USER_REVOKED');
    if (!session.valid) throw new ApiError(401, 'INVALID_SESSION');
    return { ...session, maxCalls: org.max_calls };
  }

  async operatorTelephony(bearer: string) {
    const { tenant, hash } = this.#credentials(bearer);
    return this.transaction(tenant, async db => {
      const actor = await this.#session(db, tenant, hash);
      if (!actor.can_read_operator) throw new ApiError(403, 'OPERATOR_READ_REQUIRED');
      const {rows:[snapshot]} = await db.query(
        `UPDATE sessions SET operator_observed_at_ms=GREATEST(operator_observed_at_ms+1,
          floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
          WHERE organization_id=$1 AND token_hash=$2 RETURNING operator_observed_at_ms`,
        [tenant,hash]);
      return {telephony_available:false,caller_id:null,can_call:false,
        observed_at_ms:Number(snapshot.operator_observed_at_ms)};
    });
  }

  async manageTrunks<T>(bearer: string, operation: (db: PoolClient, actor: {
    tenant: string; membershipId: string; userId: string;
  }) => Promise<T>) {
    const {tenant,hash} = this.#credentials(bearer);
    return this.transaction(tenant, async db => {
      const actor = await this.#session(db, tenant, hash);
      if (!actor.can_manage_trunks) throw new ApiError(403, 'TRUNK_PERMISSION_REQUIRED');
      return operation(db,{tenant,membershipId:actor.membership_id,userId:actor.user_id});
    });
  }

  async setDefaultTrunk(bearer: string, trunkId: string) {
    if (!uuid.test(trunkId)) throw new ApiError(400, 'INVALID_TRUNK');
    return this.manageTrunks(bearer, async (db,actor) => {
      const {rows:[target]}=await db.query(
        'SELECT id FROM trunks WHERE organization_id=$1 AND id=$2 AND active',
        [actor.tenant,trunkId]);
      if(!target) throw new ApiError(409,'TRUNK_NOT_READY');
      await db.query('UPDATE organizations SET default_trunk_id=$2 WHERE id=$1',
        [actor.tenant,trunkId]);
      await db.query('INSERT INTO audit_log(organization_id,actor_id,action) VALUES($1,$2,$3)',
        [actor.tenant,actor.userId,'trunk.default:' + trunkId]);
      return {default_trunk_id:trunkId};
    });
  }

  async setEmployeeTrunk(bearer: string, membershipId: string, trunkId: string | null) {
    if(!uuid.test(membershipId)||(trunkId!==null&&!uuid.test(trunkId))) {
      throw new ApiError(400,'INVALID_TRUNK_ASSIGNMENT');
    }
    return this.manageTrunks(bearer,async (db,actor)=>{
      if(trunkId!==null){
        const {rows:[target]}=await db.query(
          'SELECT id FROM trunks WHERE organization_id=$1 AND id=$2 AND active',
          [actor.tenant,trunkId]);
        if(!target) throw new ApiError(409,'TRUNK_NOT_READY');
      }
      const changed=await db.query(
        'UPDATE memberships SET trunk_override_id=$3 WHERE organization_id=$1 AND id=$2 AND active RETURNING id',
        [actor.tenant,membershipId,trunkId]);
      if(!changed.rowCount)throw new ApiError(404,'EMPLOYEE_NOT_FOUND');
      await db.query('INSERT INTO audit_log(organization_id,actor_id,action) VALUES($1,$2,$3)',
        [actor.tenant,actor.userId,'trunk.assignment:' + membershipId + ':' + (trunkId??'inherit')]);
      return {membership_id:membershipId,trunk_override_id:trunkId};
    });
  }

  async logout(bearer: string) {
    const { tenant, hash } = this.#credentials(bearer);
    await this.transaction(tenant, async db => {
      await this.#organization(db, tenant);
      await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE organization_id=$1 AND token_hash=$2 AND revoked_at IS NULL', [tenant, hash]);
    });
  }

  async authorize(bearer: string, key: string, destination: string) {
    if (!e164.test(destination) || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(key)) {
      throw new ApiError(400, 'INVALID_CALL_REQUEST');
    }
    const { tenant, hash } = this.#credentials(bearer);
    return this.transaction(tenant, async db => {
      const actor = await this.#session(db, tenant, hash);
      if (!actor.can_call) throw new ApiError(403, 'CALL_PERMISSION_REQUIRED');
      const { rows: [existing] } = await db.query(
        `SELECT ${visible} FROM calls WHERE membership_id=$1 AND request_key=$2`,
        [actor.membership_id, key]);
      if (existing) {
        if (existing.destination !== destination) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return existing;
      }
      if (!this.workerAvailable(tenant)) throw new ApiError(503, 'CALL_WORKER_UNAVAILABLE');
      const { rows: [subscription] } = await db.query('SELECT active,telephony FROM subscriptions WHERE organization_id=$1', [tenant]);
      if (!subscription?.active || !subscription.telephony) throw new ApiError(403, 'TELEPHONY_DISABLED');
      const { rows: [capacity] } = await db.query(
        "SELECT count(*)::int AS used FROM calls WHERE state NOT IN ('ended','failed','expired')");
      if (capacity.used >= actor.maxCalls) throw new ApiError(409, 'CALL_CONCURRENCY_LIMIT');
      // Resolve the route on the server. A Desktop request cannot specify a trunk.
      const { rows: [route] } = await db.query(
        `SELECT o.default_trunk_id,m.trunk_override_id
           FROM organizations o JOIN memberships m ON m.organization_id=o.id
          WHERE o.id=$1 AND m.id=$2`, [tenant,actor.membership_id]);
      let effectiveTrunk: string | undefined = route?.trunk_override_id ?? route?.default_trunk_id ?? undefined;
      if (!effectiveTrunk) {
        // Backfill legacy single-trunk organizations without silently routing
        // a multi-trunk organization to an arbitrary provider.
        const { rows: activeTrunks } = await db.query(
          'SELECT id FROM trunks WHERE organization_id=$1 AND active ORDER BY id LIMIT 2', [tenant]);
        if (activeTrunks.length !== 1) throw new ApiError(409, 'TRUNK_ASSIGNMENT_REQUIRED');
        effectiveTrunk = activeTrunks[0].id;
        if (!route?.default_trunk_id) {
          await db.query('UPDATE organizations SET default_trunk_id=$2 WHERE id=$1 AND default_trunk_id IS NULL',
            [tenant,effectiveTrunk]);
        }
      }
      if (!effectiveTrunk) throw new ApiError(409, 'TRUNK_ASSIGNMENT_REQUIRED');
      // One authenticated PostgreSQL transaction owns session approval, trunk
      // selection, global Caller ID hold and durable call intent. No wallet gate.
      let reservation;
      try {
        reservation=await this.carousel.reserve(db,{
          organizationId:tenant,membershipId:actor.membership_id,
          effectiveTrunkId:effectiveTrunk,requestKey:key,destination,
        });
      } catch(e){
        if(e instanceof Error && e.message==='IDEMPOTENCY_CONFLICT')
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        if(e instanceof Error && e.message==='NO_CALLER_ID')
          throw new ApiError(409,'NO_CALLER_ID');
        if(e instanceof Error && e.message==='NUMBER_LIMIT_REACHED')
          throw new ApiError(409,'NUMBER_LIMIT_REACHED');
        throw e;
      }
      const {rows:[call]}=await db.query(
        `INSERT INTO calls(organization_id,id,attempt_id,membership_id,session_hash,
          request_key,destination,caller_id,trunk_id,reserved,state,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'authorized',$10)
         RETURNING ${visible}`,
        [tenant,reservation.id,reservation.attempt_id,actor.membership_id,hash,key,
         destination,reservation.caller_id,reservation.trunk_id,reservation.expires_at]);
      return call;
    });
  }

  async calls(bearer: string, id?: string) {
    const { tenant, hash } = this.#credentials(bearer);
    return this.transaction(tenant, async db => {
      const actor = await this.#session(db, tenant, hash);
      if (id && !uuid.test(id)) throw new ApiError(404, 'CALL_NOT_FOUND');
      const result = await db.query(
        `SELECT ${visible} FROM calls WHERE ($1::boolean OR membership_id=$2)
          AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at DESC,id DESC LIMIT 100`,
        [actor.cabinet, actor.membership_id, id ?? null]);
      if (id && !result.rowCount) throw new ApiError(404, 'CALL_NOT_FOUND');
      return id ? result.rows[0] : result.rows;
    });
  }

  async hangup(bearer: string, id: string) {
    const { tenant, hash } = this.#credentials(bearer);
    return this.transaction(tenant, async db => {
      const actor = await this.#session(db, tenant, hash);
      if (!uuid.test(id)) throw new ApiError(404, 'CALL_NOT_FOUND');
      const { rows: [call] } = await db.query('SELECT * FROM calls WHERE id=$1 AND membership_id=$2', [id, actor.membership_id]);
      if (!call) throw new ApiError(404, 'CALL_NOT_FOUND');
      if (call.state === 'authorized') {
        // No physical attempt was committed: release quota, no billable usage.
        await this.carousel.finalize(db,{organizationId:tenant,dispatchId:id,action:'release'});
        await db.query("UPDATE calls SET state='ended' WHERE id=$1",[id]);
      } else if (!terminal.has(call.state)) {
        await db.query("UPDATE calls SET state='terminating' WHERE id=$1", [id]);
        await db.query("INSERT INTO outbox (organization_id,call_id,command) VALUES ($1,$2,'hangup') ON CONFLICT DO NOTHING", [tenant,id]);
      }
      return { call_id: id };
    });
  }

  async #settle(db:PoolClient,tenant:string,call:{id:string},
                state:string,classification?:CallClassification){
    const outcome=classification?.outcome??'unknown';
    const seconds=outcome==='human'?classification?.billableSeconds:0;
    const evidence=outcome==='human'?classification?.evidenceId:null;
    if(outcome==='human' && (!Number.isInteger(seconds)||seconds===undefined
       ||seconds<0||seconds>86400||typeof evidence!=='string'
       ||!evidence.length||evidence.length>512)){
      throw new Error('UNVERIFIED_HUMAN_BILLING');
    }
    if(outcome!=='human' && (classification?.billableSeconds||classification?.evidenceId)){
      throw new Error('NON_HUMAN_CANNOT_BE_BILLED');
    }
    await db.query('UPDATE calls SET state=$2 WHERE id=$1',[call.id,state]);
    await db.query(
      'INSERT INTO postpaid_usage(organization_id,call_id,outcome,billable_seconds,amount_kopeks,evidence_id) '+
      'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [tenant,call.id,outcome,seconds??0, (seconds??0)*5,evidence]);
    await db.query(
      "UPDATE carousel_outbox SET state='completed',completed_at=clock_timestamp() "+
      "WHERE dispatch_id=$1 AND state<>'completed'",[call.id]);
    await db.query('UPDATE outbox SET completed_at=clock_timestamp() WHERE call_id=$1 AND completed_at IS NULL',[call.id]);
  }

  async event(tenant:string,id:string,event:TelephonyEvent){
    return this.transaction(tenant,async db=>{
      await this.#organization(db,tenant);
      const {rows:[call]}=await db.query('SELECT * FROM calls WHERE id=$1 FOR UPDATE',[id]);
      if(!call||['authorized','expired','failed'].includes(call.state))return;
      if(call.state==='ended')return;
      const inserted=await db.query(
        'INSERT INTO call_events(organization_id,call_id,event_id,state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [tenant,id,event.id,event.state]);
      if(!inserted.rowCount)return;
      if(event.state==='ended'){
        await this.#settle(db,tenant,call,'ended',event.classification);
      } else if(['dispatching','reconciling','ringing'].includes(call.state)){
        await db.query('UPDATE calls SET state=$2 WHERE id=$1',[id,event.state]);
      }
    });
  }

  async processOne(tenant:string,gateway:TelephonyGateway){
    const job=await this.transaction(tenant,async db=>{
      await this.#organization(db,tenant);
      // A revocation of an existing conversation requires a real hangup.
      await db.query(
        "WITH stopped AS ("+
        " UPDATE calls c SET state='terminating' "+
        " FROM memberships m JOIN users u ON u.id=m.user_id "+
        " JOIN organizations o ON o.id=m.organization_id "+
        " WHERE (c.organization_id,c.membership_id)=(m.organization_id,m.id) "+
        " AND c.state IN('dispatching','reconciling','ringing','connected') "+
        " AND (NOT m.active OR NOT u.active OR NOT o.active) RETURNING c.id) "+
        " INSERT INTO outbox(organization_id,call_id,command) "+
        " SELECT $1,id,'hangup' FROM stopped ON CONFLICT DO NOTHING",[tenant]);

      const {rows:[hang]}=await db.query(
        "SELECT c.*,o.claimed_at FROM calls c JOIN outbox o "+
        "ON (c.organization_id,c.id)=(o.organization_id,o.call_id) "+
        "WHERE o.command='hangup' AND o.completed_at IS NULL "+
        "AND (o.claimed_at IS NULL OR o.claimed_at<clock_timestamp()-interval '10 seconds') "+
        "ORDER BY o.claimed_at NULLS FIRST,c.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED");
      if(hang){
        await db.query(
          "UPDATE outbox SET claimed_at=clock_timestamp() WHERE call_id=$1 AND command='hangup'",
          [hang.id]);
        return {kind:'hangup' as const,call:hang};
      }

      // Authorize immediately before the *first* durable outbound command.
      const {rows:[held]}=await db.query(
        "SELECT c.* FROM calls c JOIN carousel_dispatches d "+
        "ON (c.organization_id,c.id)=(d.organization_id,d.id) "+
        "WHERE c.state='authorized' AND d.state='held' "+
        "ORDER BY c.created_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED");
      if(held){
        let valid=true;
        try{
          const actor=await this.#session(db,tenant,held.session_hash);
          const {rows:[route]}=await db.query(
            "SELECT n.active AND n.provider_approved AND n.status='active' "+
            "AND t.active AND s.active AND s.telephony "+
            "AND COALESCE(m.trunk_override_id,o.default_trunk_id)=c.trunk_id AS allowed "+
            "FROM calls c JOIN carousel_numbers n ON "+
            "(c.organization_id,c.caller_id)=(n.organization_id,n.e164) "+
            "JOIN trunks t ON (t.organization_id,t.id)=(c.organization_id,c.trunk_id) "+
            "JOIN subscriptions s ON s.organization_id=c.organization_id "+
            "JOIN memberships m ON (m.organization_id,m.id)=(c.organization_id,c.membership_id) "+
            "JOIN organizations o ON o.id=c.organization_id WHERE c.id=$1",[held.id]);
          valid=!!actor.can_call && !!route?.allowed &&
            new Date(held.expires_at).getTime()>Date.now();
        }catch(e){
          if(!(e instanceof ApiError))throw e;
          valid=false;
        }
        if(!valid){
          await this.carousel.finalize(db,{organizationId:tenant,dispatchId:held.id,action:'release'});
          await db.query("UPDATE calls SET state=$2 WHERE id=$1",
            [held.id,new Date(held.expires_at).getTime()<=Date.now()?'expired':'failed']);
          return null;
        }
        await this.carousel.finalize(db,{organizationId:tenant,dispatchId:held.id,action:'commit'});
        await db.query("UPDATE calls SET state='dispatching' WHERE id=$1",[held.id]);
      }

      const {rows:[next]}=await db.query(
        "SELECT c.*,o.state AS queue_state FROM carousel_outbox o "+
        "JOIN calls c ON(c.organization_id,c.id)=(o.organization_id,o.dispatch_id) "+
        "WHERE o.state='pending' OR "+
        "(o.state IN('claimed','unknown') AND o.claimed_at<clock_timestamp()-interval '10 seconds') "+
        "ORDER BY c.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED");
      if(!next)return null;
      const originate=next.queue_state==='pending';
      await db.query("UPDATE carousel_outbox SET state=$2,claimed_at=clock_timestamp() WHERE dispatch_id=$1",
        [next.id,originate?'claimed':'unknown']);
      return {kind:originate?'originate' as const:'inspect' as const,call:next};
    });
    if(!job)return;

    let result:GatewayResult;
    try{
      if(job.kind==='hangup')result=await gateway.hangup(job.call.attempt_id);
      else if(job.kind==='inspect')result=await gateway.inspect(job.call.attempt_id);
      else result=await gateway.originate({
        attemptId:job.call.attempt_id,destination:job.call.destination,
        callerId:job.call.caller_id,trunkId:job.call.trunk_id,
      });
    }catch{result='unknown';}

    if(result==='unknown'){
      await this.transaction(tenant,async db=>{
        if(job.kind==='hangup')return;
        await db.query("UPDATE calls SET state='reconciling' WHERE id=$1 AND state='dispatching'",
          [job.call.id]);
        await db.query(
          "UPDATE carousel_outbox SET state='unknown',claimed_at=clock_timestamp() "+
          "WHERE dispatch_id=$1 AND state<>'completed'",[job.call.id]);
      });
      return;
    }
    if(typeof result==='object'){
      await this.event(tenant,job.call.id,{
        id:'gateway-terminal:'+job.call.attempt_id,
        state:'ended',classification:result.classification,
      });
    } else {
      await this.transaction(tenant,async db=>{
        await db.query(
          "UPDATE calls SET state=$2 WHERE id=$1 AND state IN('dispatching','reconciling')",
          [job.call.id,result]);
      });
    }
    await this.transaction(tenant,async db=>{
      if(job.kind==='hangup'){
        await db.query(
          "UPDATE outbox SET completed_at=clock_timestamp() WHERE call_id=$1 AND command='hangup'",
          [job.call.id]);
      }else{
        await db.query(
          "UPDATE carousel_outbox SET state='completed',completed_at=clock_timestamp() "+
          "WHERE dispatch_id=$1 AND state<>'completed'",[job.call.id]);
      }
    });
  }

}
