import type { PoolClient } from 'pg';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, ControlPlane, uuid } from './control.ts';

const publicColumns = "id,name,auth_mode,transport,desired_active,last_checked_at,last_success_at,diagnostic_code,registrar_host,registrar_port,status,failure_code,created_at";

type Credentials = { username: string; password: string };
type Transport = 'udp' | 'tcp' | 'tls';
type AuthMode = 'registration_credentials' | 'ip_authentication';
type Endpoint = {
  host: string;
  port: number;
  transport?: Transport;
  authMode?: AuthMode;
};
type JobIdentity = { tenant: string; trunkId: string; generation: number };
export interface TrunkProvisioner {
  supportsUniversalSip?: boolean;
  // Implementations persist the highest generation per trunk and fence obsolete operations.
  upsert(job: JobIdentity, endpoint: Endpoint, credentials: Credentials): Promise<'registered' | 'rejected'>;
  remove(job: JobIdentity): Promise<void>;
}

type TrunkActor = {
  tenant:string;
  membershipId:string;
  userId:string;
};

export type TrunkAccess = {
  run<T>(
    operation:(db:PoolClient,actor:TrunkActor)=>Promise<T>
  ):Promise<T>;
};

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

  #authorized<T>(
    access:string|TrunkAccess,
    operation:(db:PoolClient,actor:TrunkActor)=>Promise<T>
  ):Promise<T> {
    return typeof access==='string'
      ?this.#control.manageTrunks(access,operation)
      :access.run(operation);
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

  async create(bearer:string|TrunkAccess, key: string, input: Record<string, unknown>) {
    return this.#authorized(bearer,async (db, actor) => {
      const {
        name,auth_mode,registrar_host,registrar_port,
        username,password,transport='udp'
      }=input;

      const registration=auth_mode==='registration_credentials';

      const allowed=[
        'name','auth_mode','registrar_host',
        'registrar_port','transport',
        ...(registration?['username','password']:[])
      ];

      const validText=(value:unknown,max:number):value is string=>
        typeof value==='string'&&value.length>0&&
        value.length<=max&&
        !Array.from(value).some(c=>{
          const n=c.charCodeAt(0);
          return n<32||n===127;
        });

      if(Object.keys(input).some(k=>!allowed.includes(k))
        ||(!registration&&auth_mode!=='ip_authentication')
        ||!['udp','tcp','tls'].includes(String(transport))
        ||!validText(name,80)||!name.trim()
        ||(registration&&(!validText(username,128)||!validText(password,256)))
        ||typeof registrar_host!=='string'
        ||typeof registrar_port!=='number'
        ||!/^[a-zA-Z0-9_.:-]{1,128}$/.test(key))
        throw new ApiError(400,'INVALID_TRUNK');

      const host=registrar_host.toLowerCase();

      const credentials:Credentials=registration
        ?{username:username as string,password:password as string}
        :{username:'',password:''};

      const request=registration&&transport==='udp'
        ?[name.trim(),host,registrar_port,username,password]
        :[name.trim(),host,registrar_port,auth_mode,transport,
          credentials.username,credentials.password];
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
        `INSERT INTO managed_trunks (organization_id,id,membership_id,request_key,fingerprint,name,registrar_host,registrar_port,auth_mode,transport)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${publicColumns}`,
        [actor.tenant,id,actor.membershipId,key,fingerprint,name.trim(),host,registrar_port,auth_mode,transport]);
      await db.query('INSERT INTO trunk_secrets VALUES ($1,$2,$3)',
        [actor.tenant,id,this.#seal(actor.tenant + ':' + id,credentials)]);
      await db.query("INSERT INTO trunk_jobs (organization_id,trunk_id,generation,operation) VALUES ($1,$2,1,'UPSERT')",[actor.tenant,id]);
      await db.query('INSERT INTO audit_log (organization_id,actor_id,action) VALUES ($1,$2,$3)',
        [actor.tenant,actor.userId,'trunk.create:' + id]);
      return trunk;
    });
  }

  async read(bearer:string|TrunkAccess, id?: string) {
    return this.#authorized(bearer,async db => {
      if (id !== undefined && !uuid.test(id)) throw new ApiError(404,'TRUNK_NOT_FOUND');
      const {rows} = await db.query(
        `SELECT ${publicColumns} FROM managed_trunks WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR id=$1)
         ORDER BY created_at DESC,id`, [id ?? null]);
      if (id !== undefined && !rows.length) throw new ApiError(404,'TRUNK_NOT_FOUND');
      return id === undefined ? {items:rows} : rows[0];
    });
  }

  async remove(bearer:string|TrunkAccess, id: string) {
    return this.#authorized(bearer,async (db,actor) => {
      if (!uuid.test(id)) throw new ApiError(404,'TRUNK_NOT_FOUND');
      const {rows:[row]} = await db.query('SELECT deleted_at,generation FROM managed_trunks WHERE id=$1',[id]);
      if (!row) throw new ApiError(404,'TRUNK_NOT_FOUND');
      if (!row.deleted_at) {
        await db.query(
          'UPDATE trunks SET active=false WHERE id=$1',
          [id]
        );

        await db.query(
          'UPDATE managed_trunks SET desired_active=false WHERE id=$1',
          [id]
        );

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

  async setActive(bearer:string|TrunkAccess,id:string,active:boolean) {
    return this.#authorized(bearer,async(db,actor)=>{
      if(!uuid.test(id))
        throw new ApiError(404,'TRUNK_NOT_FOUND');

      if(typeof active!=='boolean')
        throw new ApiError(400,'INVALID_TRUNK');

      const {rows:[org]}=await db.query(
        'SELECT active,verification_status FROM organizations WHERE id=$1 FOR UPDATE',
        [actor.tenant]
      );

      const {rows:[trunk]}=await db.query(
        'SELECT status,last_success_at,desired_active FROM managed_trunks WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [id]
      );

      if(!trunk)
        throw new ApiError(404,'TRUNK_NOT_FOUND');

      if(active){
        if(!org?.active||org.verification_status!=='verified')
          throw new ApiError(403,'ORGANIZATION_NOT_VERIFIED');

        if(trunk.status!=='registered'||!trunk.last_success_at)
          throw new ApiError(409,'TRUNK_NOT_READY');
      }

      await db.query(
        'UPDATE managed_trunks SET desired_active=$2 WHERE id=$1',
        [id,active]
      );

      await db.query(
        'UPDATE trunks SET active=$2 WHERE id=$1',
        [id,active]
      );

      if(trunk.desired_active!==active)
        await db.query(
          'INSERT INTO audit_log(organization_id,actor_id,action) VALUES($1,$2,$3)',
          [actor.tenant,actor.userId,
           (active?'trunk.activate:':'trunk.deactivate:')+id]
        );

      return {id,active};
    });
  }

  async recheck(bearer:string|TrunkAccess,id:string) {
    return this.#authorized(bearer,async(db,actor)=>{
      if(!uuid.test(id))
        throw new ApiError(404,'TRUNK_NOT_FOUND');

      await db.query(
        'SELECT id FROM organizations WHERE id=$1 FOR UPDATE',
        [actor.tenant]
      );

      const {rows:[row]}=await db.query(
        'SELECT generation FROM managed_trunks WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [id]
      );

      if(!row)
        throw new ApiError(404,'TRUNK_NOT_FOUND');

      const generation=row.generation+1;

      await db.query(
        'UPDATE trunks SET active=false WHERE id=$1',
        [id]
      );

      await db.query(
        'UPDATE managed_trunks SET desired_active=false WHERE id=$1',
        [id]
      );


      await db.query(
        "UPDATE managed_trunks SET generation=$2,status='configuring',failure_code=NULL,diagnostic_code=NULL WHERE id=$1",
        [id,generation]
      );

      await db.query(
        'UPDATE trunk_jobs SET completed_at=clock_timestamp() WHERE trunk_id=$1 AND completed_at IS NULL',
        [id]
      );

      await db.query(
        "INSERT INTO trunk_jobs(organization_id,trunk_id,generation,operation) VALUES($1,$2,$3,'UPSERT')",
        [actor.tenant,id,generation]
      );

      await db.query(
        'INSERT INTO audit_log(organization_id,actor_id,action) VALUES($1,$2,$3)',
        [actor.tenant,actor.userId,'trunk.recheck:'+id]
      );

      return {id,status:'configuring',generation};
    });
  }

  async provisionNext(tenant: string, adapter: TrunkProvisioner) {
    const claim = randomUUID();
    const job = await this.#control.transaction(tenant,async db => {
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[tenant]);
      const {rows:[row]} = await db.query(
        `SELECT j.trunk_id,j.generation,j.operation,j.attempts,t.registrar_host,t.registrar_port,t.auth_mode,t.transport,s.envelope
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
        const legacy=job.auth_mode==='registration_credentials'&&job.transport==='udp';

        if(!legacy&&!adapter.supportsUniversalSip)
          throw new Error('Universal SIP adapter required');

        const endpoint:Endpoint={
          host:job.registrar_host,
          port:job.registrar_port,
          ...(!legacy?{
            authMode:job.auth_mode,
            transport:job.transport
          }:{})
        };

        result = await adapter.upsert(identity,endpoint,
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
        await db.query(`UPDATE managed_trunks SET status=$3,failure_code=$4,last_checked_at=clock_timestamp(),last_success_at=CASE WHEN $3='registered' THEN clock_timestamp() ELSE last_success_at END,diagnostic_code=COALESCE($4,'CONNECTION_OK') WHERE id=$1 AND generation=$2 AND deleted_at IS NULL`,
          [job.trunk_id,job.generation,result,failure]);
      }
    });
  }
}
