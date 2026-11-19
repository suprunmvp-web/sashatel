import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool, PoolClient } from 'pg';

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
export type GatewayResult = Exclude<GatewayState, 'ended'> | { state: 'ended'; charge: bigint };
export interface TelephonyGateway {
  originate(command: Originate): Promise<'ringing'>;
  // Cancel by durable ID even when originate is ambiguous. A definitive result fences late originate.
  hangup(attemptId: string): Promise<'unknown' | { state: 'ended'; charge: bigint }>;
  inspect(attemptId: string): Promise<GatewayResult>;
}
export interface TelephonyEvent {
  id: string;
  state: Exclude<GatewayState, 'unknown'>;
  // Trusted adapter supplies authoritative usage in wallet units.
  charge?: bigint;
}

export class ControlPlane {
  private readonly pool: Pool;
  private readonly timezone: string;
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
      const { rows: numbers } = await db.query(
        `SELECT n.e164,n.trunk_id FROM phone_numbers n JOIN trunks t
           ON (n.organization_id,n.trunk_id)=(t.organization_id,t.id)
          WHERE n.active AND t.active AND t.id=$1 ORDER BY n.e164`, [effectiveTrunk]);
      if (!numbers.length) throw new ApiError(409, 'NO_CALLER_ID');
      const { rows: [wallet] } = await db.query(
        'UPDATE wallets SET available=available-reserve_per_call WHERE organization_id=$1 AND available>=reserve_per_call RETURNING reserve_per_call',
        [tenant]);
      if (!wallet) throw new ApiError(409, 'INSUFFICIENT_BALANCE');
      for (const number of numbers) {
        const attempt = await db.query(
          `INSERT INTO number_attempts VALUES ($1,(clock_timestamp() AT TIME ZONE $2)::date,1)
           ON CONFLICT (e164,day) DO UPDATE SET used=number_attempts.used+1
           WHERE number_attempts.used<8 RETURNING used`, [number.e164, this.timezone]);
        if (!attempt.rowCount) continue;
        const id = randomUUID();
        const { rows: [call] } = await db.query(
          `INSERT INTO calls (organization_id,id,attempt_id,membership_id,session_hash,request_key,
             destination,caller_id,trunk_id,reserved,state,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'authorized',clock_timestamp()+interval '30 seconds')
           RETURNING ${visible}`,
          [tenant,id,randomUUID(),actor.membership_id,hash,key,destination,number.e164,number.trunk_id,wallet.reserve_per_call]);
        await db.query("INSERT INTO usage_ledger (organization_id,call_id,kind,units) VALUES ($1,$2,'reserve',$3)",
          [tenant,id,wallet.reserve_per_call]);
        await db.query("INSERT INTO outbox (organization_id,call_id,command) VALUES ($1,$2,'originate')", [tenant,id]);
        return call;
      }
      throw new ApiError(409, 'NUMBER_LIMIT_REACHED');
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
        await this.#settle(db, tenant, call, 'ended', 0n);
      } else if (!terminal.has(call.state)) {
        await db.query("UPDATE calls SET state='terminating' WHERE id=$1", [id]);
        await db.query("INSERT INTO outbox (organization_id,call_id,command) VALUES ($1,$2,'hangup') ON CONFLICT DO NOTHING", [tenant,id]);
      }
      return { call_id: id };
    });
  }

  async #settle(db: PoolClient, tenant: string, call: { id: string; reserved: string }, state: string, charge: bigint) {
    const reserved = BigInt(call.reserved);
    if (charge < 0n || charge > reserved) throw new Error('Usage outside reserved bounds');
    await db.query('UPDATE calls SET state=$2 WHERE id=$1', [call.id,state]);
    const chargeRow = await db.query("INSERT INTO usage_ledger (organization_id,call_id,kind,units) VALUES ($1,$2,'charge',$3) ON CONFLICT DO NOTHING", [tenant,call.id,charge.toString()]);
    if (!chargeRow.rowCount) return;
    await db.query("INSERT INTO usage_ledger (organization_id,call_id,kind,units) VALUES ($1,$2,'release',$3)",
      [tenant,call.id,(reserved-charge).toString()]);
    await db.query('UPDATE wallets SET available=available+$2 WHERE organization_id=$1', [tenant,(reserved-charge).toString()]);
    await db.query('UPDATE outbox SET completed_at=clock_timestamp() WHERE call_id=$1 AND completed_at IS NULL', [call.id]);
  }

  async event(tenant: string, id: string, event: TelephonyEvent) {
    return this.transaction(tenant, async db => {
      await this.#organization(db, tenant);
      const { rows: [call] } = await db.query('SELECT * FROM calls WHERE id=$1', [id]);
      if (!call || ['authorized','expired','failed'].includes(call.state)) return;
      if (call.state === 'ended' && (event.state !== 'ended' || event.charge === undefined)) return;
      if (call.state === 'ended' && (await db.query("SELECT 1 FROM usage_ledger WHERE call_id=$1 AND kind='charge'", [id])).rowCount) return;
      const inserted = await db.query(
        'INSERT INTO call_events (organization_id,call_id,event_id,state) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [tenant,id,event.id,event.state]);
      if (event.state === 'ended') {
        if (event.charge !== undefined) {
          await this.#settle(db, tenant, call, 'ended', event.charge);
        } else if (inserted.rowCount) {
          await db.query("UPDATE calls SET state='ended' WHERE id=$1", [id]);
          await db.query('UPDATE outbox SET completed_at=clock_timestamp() WHERE call_id=$1 AND completed_at IS NULL', [id]);
        }
      } else if (!inserted.rowCount) {
        return;
      } else if (['dispatching','reconciling','ringing'].includes(call.state)) {
        await db.query('UPDATE calls SET state=$2 WHERE id=$1', [id,event.state]);
      }
    });
  }

  async processOne(tenant: string, gateway: TelephonyGateway) {
    const job = await this.transaction(tenant, async db => {
      await this.#organization(db, tenant);
      await db.query(
        `WITH stopped AS (
          UPDATE calls c SET state='terminating'
          FROM memberships m JOIN users u ON u.id=m.user_id
          JOIN organizations o ON o.id=m.organization_id
          WHERE (c.organization_id,c.membership_id)=(m.organization_id,m.id)
            AND c.state IN ('dispatching','reconciling','ringing','connected')
            AND (NOT m.active OR NOT u.active OR NOT o.active)
          RETURNING c.id
        )
        INSERT INTO outbox (organization_id,call_id,command)
        SELECT $1,id,'hangup' FROM stopped ON CONFLICT DO NOTHING`, [tenant]);
      const { rows: [call] } = await db.query(
        `SELECT c.*, o.command, o.claimed_at, c.expires_at <= clock_timestamp() AS expired
           FROM calls c JOIN outbox o ON (c.organization_id,c.id)=(o.organization_id,o.call_id)
          WHERE o.completed_at IS NULL AND (o.claimed_at IS NULL OR o.claimed_at < clock_timestamp()-interval '10 seconds')
          ORDER BY (o.command='hangup') DESC,o.claimed_at NULLS FIRST,c.created_at LIMIT 1`);
      if (!call) return;
      if (call.command === 'originate' && !call.claimed_at) {
        try {
          const actor = await this.#session(db, tenant, call.session_hash);
          const { rows: [route] } = await db.query(
            `SELECT n.active AND t.active AND s.active AND s.telephony AS allowed
               FROM phone_numbers n JOIN trunks t ON (n.organization_id,n.trunk_id)=(t.organization_id,t.id)
               JOIN subscriptions s ON s.organization_id=n.organization_id
              WHERE n.e164=$1 AND t.id=$2`, [call.caller_id,call.trunk_id]);
          if (!actor.can_call || !route?.allowed || call.expired) throw new ApiError(403, 'GRANT_INVALID');
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          await this.#settle(db, tenant, call, call.expired ? 'expired' : 'failed', 0n);
          return;
        }
        await db.query("UPDATE calls SET state='dispatching' WHERE id=$1", [call.id]);
      }
      await db.query('UPDATE outbox SET claimed_at=clock_timestamp() WHERE call_id=$1 AND command=$2', [call.id,call.command]);
      return call;
    });
    if (!job) return;
    let state: GatewayResult;
    try {
      if (job.command === 'hangup') state = await gateway.hangup(job.attempt_id);
      else if (job.claimed_at) state = await gateway.inspect(job.attempt_id);
      else state = await gateway.originate({
        attemptId: job.attempt_id, destination: job.destination, callerId: job.caller_id, trunkId: job.trunk_id,
      });
    } catch {
      state = 'unknown';
    }
    if (typeof state === 'object') {
      await this.event(tenant, job.id, { id: 'settled:' + job.attempt_id, ...state });
      return;
    }
    await this.transaction(tenant, async db => {
      await this.#organization(db, tenant);
      if (state === 'unknown') {
        await db.query("UPDATE calls SET state='reconciling' WHERE id=$1 AND state='dispatching'", [job.id]);
        return;
      }
      await db.query("UPDATE calls SET state=$2 WHERE id=$1 AND state IN ('dispatching','reconciling')", [job.id,state]);
      await db.query('UPDATE outbox SET completed_at=clock_timestamp() WHERE call_id=$1 AND command=$2', [job.id,job.command]);
    });
  }
}
