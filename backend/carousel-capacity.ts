import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Commercial carousel's durable reservation protocol.
 * No PSTN path is enabled by importing this service. The caller is trusted
 * server-side code, which must resolve membership from an authenticated session.
 */
export class CarouselCapacity {
  constructor(private readonly pool: Pool, private readonly timezone: string = 'Europe/Moscow') {
    new Intl.DateTimeFormat('en', {timeZone:timezone});
  }

  private async tx<T>(organizationId:string, f:(db:PoolClient)=>Promise<T>):Promise<T> {
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL search_path=control,pg_catalog");
      await db.query("SELECT set_config('control.tenant',$1,true)",[organizationId]);
      const out=await f(db);
      await db.query('COMMIT');
      return out;
    } catch(e) {await db.query('ROLLBACK');throw e;} finally {db.release();}
  }

  /** Serializes allocations for the tenant to avoid stale selection across
   * competing users. The organization is locked, not the chosen row alone.
   * The first authorizing caller must validate membership, permissions,
   * subscription and trunk before invoking this service.
   */
  async reserve(args:{organizationId:string;membershipId:string;requestKey:string;destination:string}) {
    const {organizationId:org,membershipId,requestKey,destination}=args;
    if(!/^[0-9a-f-]{36}$/.test(org)||!/^[0-9a-f-]{36}$/.test(membershipId)
      || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(requestKey)
      || !/^\\+[1-9][0-9]{6,14}$/.test(destination)) throw Error('INVALID_RESERVATION');
    return this.tx(org,async db=>{
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
      const {rows:[old]}=await db.query(
        'SELECT * FROM carousel_dispatches WHERE organization_id=$1 AND membership_id=$2 AND request_key=$3',
        [org,membershipId,requestKey]);
      if(old) {
        if(old.destination!==destination) throw Error('IDEMPOTENCY_CONFLICT');
        return old;
      }
      const {rows:[day]}=await db.query(
        "SELECT (clock_timestamp() AT TIME ZONE $1)::date AS day",[this.timezone]);
      const {rows:numbers}=await db.query(`
        SELECT n.e164,n.trunk_id,
           COALESCE(c.held,0) AS held,COALESCE(c.used,0) AS used
        FROM carousel_numbers n
        JOIN trunks t ON (t.organization_id,t.id)=(n.organization_id,n.trunk_id)
        LEFT JOIN carousel_day_capacity c ON c.organization_id=n.organization_id AND c.e164=n.e164 AND c.day=$2
        WHERE n.organization_id=$1 AND n.status='active' AND n.provider_approved AND t.active
        ORDER BY COALESCE(c.used+c.held,0),n.e164
        LIMIT 1
      `,[org,day.day]);
      const chosen=numbers[0];
      if(!chosen || Number(chosen.held)+Number(chosen.used)>=8) {
        // LIMIT 1 above is chosen by minimum usage so it proves pool is exhausted.
        throw Error('NO_CALLER_ID_CAPACITY');
      }
      const inserted=await db.query(`
        INSERT INTO carousel_day_capacity(organization_id,e164,day,held,used)
        VALUES ($1,$2,$3,1,0)
        ON CONFLICT (organization_id,e164,day)
          DO UPDATE SET held=carousel_day_capacity.held+1
          WHERE carousel_day_capacity.held+carousel_day_capacity.used<8
        RETURNING held,used
      `,[org,chosen.e164,day.day]);
      if(!inserted.rowCount) throw Error('NO_CALLER_ID_CAPACITY');
      const {rows:[hold]}=await db.query(`
        INSERT INTO carousel_dispatches
          (organization_id,id,membership_id,request_key,destination,caller_id,trunk_id,budget_day,state,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'held',clock_timestamp()+interval '30 seconds')
        RETURNING *
      `,[org,randomUUID(),membershipId,requestKey,destination,chosen.e164,chosen.trunk_id,day.day]);
      return hold;
    });
  }

  /** Commit once BEFORE external originate. An uncertain originate still
   * consumes capacity; it must be reconciled, never auto-retried.
   * Must be followed by a single-owner durable worker outbox; this function
   * alone does not dispatch calls.
   */
  async commit(organizationId:string,id:string) {
    return this.tx(organizationId,async db=>{
      const {rows:[h]}=await db.query(
        'SELECT * FROM carousel_dispatches WHERE organization_id=$1 AND id=$2 FOR UPDATE',
        [organizationId,id]);
      if(!h) throw Error('UNKNOWN_DISPATCH');
      if(h.state==='committed'||h.state==='unknown') return h;
      if(h.state!=='held') throw Error('NOT_DISPATCHABLE');
      if(new Date(h.expires_at).getTime()<=Date.now()) throw Error('HOLD_EXPIRED');
      // Lock the organization to serialize against changes to active/passive.
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[organizationId]);
      const {rows:[number]}=await db.query(
        "SELECT 1 FROM carousel_numbers n JOIN trunks t ON (n.organization_id,n.trunk_id)=(t.organization_id,t.id) WHERE n.organization_id=$1 AND n.e164=$2 AND n.trunk_id=$3 AND n.status='active' AND n.provider_approved AND t.active",
        [organizationId,h.caller_id,h.trunk_id]);
      if(!number) throw Error('CALLER_NOT_ACTIVE');
      const {rows:[today]}=await db.query(
        "SELECT (clock_timestamp() AT TIME ZONE $1)::date AS day",[this.timezone]);
      if(String(today.day).slice(0,10)!==String(h.budget_day).slice(0,10)) throw Error('DAY_CHANGED_REAUTHORIZE');
      await db.query(
        'UPDATE carousel_day_capacity SET held=held-1,used=used+1 WHERE organization_id=$1 AND e164=$2 AND day=$3 AND held>0',
        [organizationId,h.caller_id,h.budget_day]);
      const {rows:[done]}=await db.query(
        "UPDATE carousel_dispatches SET state='committed',committed_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",
        [organizationId,id]);
      return done;
    });
  }

  /** Cancel/expire *before* commit only. Committed attempts are never refunded. */
  async release(organizationId:string,id:string) {
    return this.tx(organizationId,async db=>{
      const {rows:[h]}=await db.query(
        'SELECT * FROM carousel_dispatches WHERE organization_id=$1 AND id=$2 FOR UPDATE',
        [organizationId,id]);
      if(!h) throw Error('UNKNOWN_DISPATCH');
      if(h.state!=='held') return h;
      await db.query(
        'UPDATE carousel_day_capacity SET held=held-1 WHERE organization_id=$1 AND e164=$2 AND day=$3 AND held>0',
        [organizationId,h.caller_id,h.budget_day]);
      const {rows:[released]}=await db.query(
        "UPDATE carousel_dispatches SET state='released' WHERE organization_id=$1 AND id=$2 RETURNING *",
        [organizationId,id]);
      return released;
    });
  }
}
