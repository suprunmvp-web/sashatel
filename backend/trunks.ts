import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, ControlPlane, uuid } from './control.ts';

const publicColumns = "id,name,'registration_credentials' AS auth_mode,registrar_host,registrar_port,status,failure_code,created_at";

type Credentials = { username: string; password: string };
type Endpoint = { host: string; port: number };
type JobIdentity = { tenant: string; trunkId: string; generation: number };
export interface TrunkProvisioner {
  // Implementations persist the highest generation per trunk and fence obsolete operations.
  upsert(job: JobIdentity, endpoint: Endpoint, credentials: Credentials): Promise<'registered' | 'rejected'>;
  remove(job: JobIdentity): Promise<void>;
}

export class TrunkService {
  readonly #control: ControlPlane;
  readonly #key: Buffer;
  readonly #registrars: ReadonlySet<string>;

  constructor(control: ControlPlane, key: Buffer, registrars: ReadonlySet<string>) {
    if (key.length !== 32) throw new Error('UIS vault requires a 32-byte key');
    this.#control = control;
    this.#key = Buffer.from(key);
    this.#registrars = new Set(registrars);
  }

  #seal(context: string, credentials: Credentials) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
  }

  #open(context: string, envelope: string): Credentials {
    const sealed = Buffer.from(envelope,'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, sealed.subarray(0,12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(sealed.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)),decipher.final()]).toString());
  }

  #endpointAllowed(host: string, port: number) {
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host)
      && Number.isInteger(port) && port >= 1 && port <= 65535 && this.#registrars.has(host + ':' + port);
  }

  async create(bearer: string, key: string, input: Record<string, unknown>) {
    return this.#control.manageTrunks(bearer,async (db, actor) => {
      const { name, auth_mode, registrar_host, registrar_port, username, password } = input;
      const validText = (value: unknown, max: number): value is string =>
        typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
      if (Object.keys(input).length !== 6 || auth_mode !== 'registration_credentials'
        || !validText(name,80) || !name.trim() || !validText(username,128) || !validText(password,256)
        || typeof registrar_host !== 'string' || typeof registrar_port !== 'number'
        || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(key)) throw new ApiError(400,'INVALID_TRUNK');
      const host = registrar_host.toLowerCase();
      const request = [name.trim(), host, registrar_port, username, password];
      const fingerprint = createHmac('sha256',this.#key).update('uis-create-v1\0')
        .update(JSON.stringify([actor.tenant,actor.membershipId,key,request])).digest('hex');
      const {rows:[existing]} = await db.query(
        `SELECT ${publicColumns},fingerprint,deleted_at FROM managed_trunks WHERE membership_id=$1 AND request_key=$2`,
        [actor.membershipId,key]);
      if (existing) {
        const {fingerprint: stored,deleted_at,...trunk} = existing;
        if (stored !== fingerprint) throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        if (deleted_at) throw new ApiError(404,'TRUNK_NOT_FOUND');
        return trunk;
      }
      if (!this.#endpointAllowed(host,registrar_port)) throw new ApiError(400,'REGISTRAR_NOT_ALLOWED');
      const id = randomUUID();
      await db.query('INSERT INTO trunks VALUES ($1,$2,false)',[actor.tenant,id]);
      const {rows:[trunk]} = await db.query(
        `INSERT INTO managed_trunks (organization_id,id,membership_id,request_key,fingerprint,name,registrar_host,registrar_port)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${publicColumns}`,
        [actor.tenant,id,actor.membershipId,key,fingerprint,name.trim(),host,registrar_port]);
      await db.query('INSERT INTO trunk_secrets VALUES ($1,$2,$3)',
        [actor.tenant,id,this.#seal(actor.tenant + ':' + id,{username,password})]);
      await db.query("INSERT INTO trunk_jobs (organization_id,trunk_id,generation,operation) VALUES ($1,$2,1,'UPSERT')",[actor.tenant,id]);
      await db.query('INSERT INTO audit_log (organization_id,actor_id,action) VALUES ($1,$2,$3)',
        [actor.tenant,actor.userId,'trunk.create:' + id]);
      return trunk;
    });
  }

  async read(bearer: string, id?: string) {
    return this.#control.manageTrunks(bearer,async db => {
      if (id !== undefined && !uuid.test(id)) throw new ApiError(404,'TRUNK_NOT_FOUND');
      const {rows} = await db.query(
        `SELECT ${publicColumns} FROM managed_trunks WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR id=$1)
         ORDER BY created_at DESC,id`, [id ?? null]);
      if (id !== undefined && !rows.length) throw new ApiError(404,'TRUNK_NOT_FOUND');
      return id === undefined ? {items:rows} : rows[0];
    });
  }

  async remove(bearer: string, id: string) {
    return this.#control.manageTrunks(bearer,async (db,actor) => {
      if (!uuid.test(id)) throw new ApiError(404,'TRUNK_NOT_FOUND');
      const {rows:[row]} = await db.query('SELECT deleted_at,generation FROM managed_trunks WHERE id=$1',[id]);
      if (!row) throw new ApiError(404,'TRUNK_NOT_FOUND');
      if (!row.deleted_at) {
        const generation = row.generation + 1;
        await db.query('UPDATE managed_trunks SET deleted_at=clock_timestamp(),generation=$2 WHERE id=$1',[id,generation]);
        await db.query('UPDATE trunk_jobs SET completed_at=clock_timestamp() WHERE trunk_id=$1 AND completed_at IS NULL',[id]);
        await db.query("INSERT INTO trunk_jobs (organization_id,trunk_id,generation,operation) VALUES ($1,$2,$3,'REMOVE')",
          [actor.tenant,id,generation]);
        await db.query('INSERT INTO audit_log (organization_id,actor_id,action) VALUES ($1,$2,$3)',
          [actor.tenant,actor.userId,'trunk.delete:' + id]);
      }
      return {id,deleted:true};
    });
  }

  async provisionNext(tenant: string, adapter: TrunkProvisioner) {
    const claim = randomUUID();
    const job = await this.#control.transaction(tenant,async db => {
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[tenant]);
      const {rows:[row]} = await db.query(
        `SELECT j.trunk_id,j.generation,j.operation,j.attempts,t.registrar_host,t.registrar_port,s.envelope
           FROM trunk_jobs j JOIN managed_trunks t ON (j.organization_id,j.trunk_id,j.generation)=(t.organization_id,t.id,t.generation)
           LEFT JOIN trunk_secrets s ON (s.organization_id,s.trunk_id)=(t.organization_id,t.id)
          WHERE j.completed_at IS NULL AND j.available_at<=clock_timestamp()
          ORDER BY j.available_at,j.trunk_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
      if (!row) return;
      await db.query(`UPDATE trunk_jobs SET claim=$3,attempts=attempts+1,available_at=clock_timestamp()+interval '60 seconds'
        WHERE trunk_id=$1 AND generation=$2`,[row.trunk_id,row.generation,claim]);
      if (row.operation === 'UPSERT') {
        await db.query("UPDATE managed_trunks SET status='registering',failure_code=NULL WHERE id=$1 AND generation=$2",
          [row.trunk_id,row.generation]);
      }
      return row;
    });
    if (!job) return;
    const identity = {tenant,trunkId:job.trunk_id,generation:job.generation};
    let result: 'registered' | 'rejected' | 'removed' | 'degraded';
    try {
      if (job.operation === 'REMOVE') {
        await adapter.remove(identity);
        result = 'removed';
      } else if (!this.#endpointAllowed(job.registrar_host,job.registrar_port)) {
        result = 'rejected';
      } else {
        result = await adapter.upsert(identity,{host:job.registrar_host,port:job.registrar_port},
          this.#open(tenant + ':' + job.trunk_id,job.envelope));
      }
    } catch {
      result = 'degraded';
    }
    await this.#control.transaction(tenant,async db => {
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[tenant]);
      const changed = await db.query(`UPDATE trunk_jobs SET
        completed_at=CASE WHEN $4::boolean THEN NULL ELSE clock_timestamp() END,
        available_at=clock_timestamp()+make_interval(secs => $5::integer)
        WHERE trunk_id=$1 AND generation=$2 AND claim=$3 AND completed_at IS NULL RETURNING generation`,
        [job.trunk_id,job.generation,claim,result==='degraded',Math.min(300,2**Math.min(9,job.attempts+1))]);
      if (!changed.rowCount) return;
      if (result === 'removed') {
        await db.query('DELETE FROM trunk_secrets WHERE trunk_id=$1',[job.trunk_id]);
      } else if (job.operation === 'UPSERT') {
        const failure = result === 'rejected' ? 'PROVISIONING_REJECTED' : result === 'degraded' ? 'PROVISIONING_UNAVAILABLE' : null;
        await db.query('UPDATE managed_trunks SET status=$3,failure_code=$4 WHERE id=$1 AND generation=$2 AND deleted_at IS NULL',
          [job.trunk_id,job.generation,result,failure]);
      }
    });
  }
}
