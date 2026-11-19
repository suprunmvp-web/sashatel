import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type CarouselReservation = {
  id:string; attempt_id:string; caller_id:string; trunk_id:string;
  budget_day:string; state:string; expires_at:Date; destination:string;
};

/**
 * SashaTel v1.1 transactional allocation.
 * Runs inside the call-authorizer's authenticated tenant-scoped transaction.
 * Does NOT open its own transaction or originate PSTN.
 */
export class GlobalCarousel {
  async reserve(db:PoolClient,args:{
    organizationId:string;membershipId:string;effectiveTrunkId:string;
    requestKey:string;destination:string;
  }):Promise<CarouselReservation> {
    const {organizationId:tenant,membershipId,requestKey,destination,effectiveTrunkId}=args;
    if(!/^[0-9a-f-]{36}$/i.test(tenant)||!/^[0-9a-f-]{36}$/i.test(membershipId)
      ||!/^[0-9a-f-]{36}$/i.test(effectiveTrunkId)
      ||!/^[A-Za-z0-9_.:-]{1,128}$/.test(requestKey)
      ||!/^\+[1-9][0-9]{6,14}$/.test(destination)) throw Error('INVALID_CALL_REQUEST');

    // The caller MUST already have verified membership, subscription,
    // concurrency, overdue policy and effective trunk in this transaction.
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[tenant]);
    const {rows:[old]}=await db.query(
      'SELECT * FROM carousel_dispatches WHERE organization_id=$1 AND membership_id=$2 AND request_key=$3',
      [tenant,membershipId,requestKey]);
    if(old) {
      if(old.destination!==destination)throw Error('IDEMPOTENCY_CONFLICT');
      return old;
    }

    const {rows:[date]}=await db.query(
      "SELECT (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date AS today");
    const {rows:available}=await db.query(
      'SELECT e164,trunk_id,load FROM available_carousel_numbers($1,$2,$3)',
      [tenant,effectiveTrunkId,date.today]);

    // The guarded SQL function atomically checks global physical E.164
    // capacity across all tenants. Do not double count a failed hold.
    for(const item of available){
      const {rows:[held]}=await db.query(
        'SELECT hold_physical_caller($1,$2,$3) AS accepted',
        [tenant,item.e164,date.today]);
      if(!held?.accepted)continue;
      const {rows:[reservation]}=await db.query(
        'INSERT INTO carousel_dispatches('+
        'organization_id,id,attempt_id,membership_id,request_key,'+
        'destination,caller_id,trunk_id,budget_day) '+
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [tenant,randomUUID(),randomUUID(),membershipId,requestKey,destination,
         item.e164,item.trunk_id,date.today]);
      return reservation;
    }
    throw Error(available.length?'NUMBER_LIMIT_REACHED':'NO_CALLER_ID');
  }

  /** Reclaim expired, uncommitted holds for this tenant. A committed attempt
   * is never refunded. Run periodically from an authenticated server worker.
   * The caller owns the transaction; SKIP LOCKED prevents duplicate expiry.
   */
  async expireForTenant(db:PoolClient,organizationId:string,limit=100):Promise<number> {
    if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('INVALID_EXPIRY_BATCH');
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[organizationId]);
    const {rows:expired}=await db.query(
      "SELECT id FROM carousel_dispatches WHERE organization_id=$1 AND state='held' "+
      "AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED",
      [organizationId,limit]);
    for(const hold of expired){
      await this.finalize(db,{organizationId,dispatchId:hold.id,action:'release'});
    }
    return expired.length;
  }

  async finalize(db:PoolClient,args:{
    organizationId:string;dispatchId:string;action:'commit'|'release';
  }):Promise<'committed'|'released'|'unknown'>{
    const {rows:[r]}=await db.query(
      'SELECT finalize_physical_caller($1,$2,$3) AS state',
      [args.organizationId,args.dispatchId,args.action]);
    return r.state;
  }
}
