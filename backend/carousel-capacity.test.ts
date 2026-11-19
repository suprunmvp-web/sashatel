import test from 'node:test';
import assert from 'node:assert/strict';
import { CarouselCapacity } from './carousel-capacity.ts';

/** Deterministic SQL-level adapter tests, not a replacement for PostgreSQL
 * concurrency tests. No live PSTN connection is possible in these tests.
 */
function scripted(results: Array<{rows?:unknown[];rowCount?:number}>) {
  const seen: Array<{sql:string;params?:unknown[]}> = [];
  let i=0;
  const client={
    async query(sql:string,params?:unknown[]) {
      seen.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'
        || sql.startsWith('SET LOCAL')||sql.includes("set_config(")) return {rows:[],rowCount:0};
      const next=results[i++];
      if(!next) throw Error('UNEXPECTED_QUERY: '+sql);
      return {rows:next.rows??[],rowCount:next.rowCount??(next.rows?.length??0)};
    },
    release() {},
  };
  return {pool:{connect:async()=>client} as any,seen};
}
const ORG='11111111-1111-4111-8111-111111111111';
const MEMBER='22222222-2222-4222-8222-222222222222';
const DISPATCH='33333333-3333-4333-8333-333333333333';
const DAY='2026-11-19';

test('reserve binds tenant and holds capacity once',async()=>{
  const m=scripted([
    {rows:[{id:ORG}]},
    {rows:[]},
    {rows:[{day:DAY}]},
    {rows:[{e164:'+79990000001',trunk_id:DISPATCH,held:0,used:7}]},
    {rows:[{held:1,used:7}]},
    {rows:[{id:DISPATCH,state:'held',caller_id:'+79990000001'}]},
  ]);
  const service=new CarouselCapacity(m.pool);
  const h=await service.reserve({organizationId:ORG,membershipId:MEMBER,requestKey:'key1',destination:'+79990000002'});
  assert.equal(h.state,'held');
  assert(m.seen.some(x=>x.sql.includes('carousel_day_capacity')&&x.sql.includes('ON CONFLICT')));
  assert.equal(m.seen.at(-1)?.sql,'COMMIT');
});

test('idempotent repeat returns original hold without another reservation',async()=>{
  const old={id:DISPATCH,destination:'+79990000002',state:'held'};
  const m=scripted([{rows:[{id:ORG}]},{rows:[old]}]);
  const h=await new CarouselCapacity(m.pool).reserve({organizationId:ORG,membershipId:MEMBER,requestKey:'key1',destination:old.destination});
  assert.equal(h.id,DISPATCH);
  assert(!m.seen.some(x=>x.sql.includes('INSERT INTO carousel_day_capacity')));
});

test('no capacity fails closed and rolls back',async()=>{
  const m=scripted([
    {rows:[{id:ORG}]},{rows:[]},{rows:[{day:DAY}]},{rows:[]},
  ]);
  await assert.rejects(new CarouselCapacity(m.pool).reserve({
    organizationId:ORG,membershipId:MEMBER,requestKey:'key1',destination:'+79990000002',
  }),/NO_CALLER_ID_CAPACITY/);
  assert.equal(m.seen.at(-1)?.sql,'ROLLBACK');
});

test('commit consumes hold exactly once, before external originate',async()=>{
  const hold={id:DISPATCH,state:'held',caller_id:'+79990000001',
    trunk_id:DISPATCH,budget_day:DAY,expires_at:new Date(Date.now()+30000)};
  const m=scripted([
    {rows:[{id:ORG}]},{rows:[hold]},{rows:[{one:1}]},
    {rows:[{day:DAY}]},{rowCount:1},{rows:[{...hold,state:'committed'}]},
  ]);
  const done=await new CarouselCapacity(m.pool).commit(ORG,DISPATCH);
  assert.equal(done.state,'committed');
  assert(m.seen.some(x=>x.sql.includes('SET held=held-1,used=used+1')));
});

test('release only held capacity and never re-uses a committed slot',async()=>{
  const committed={id:DISPATCH,state:'committed'};
  const m=scripted([{rows:[{id:ORG}]},{rows:[committed]}]);
  const h=await new CarouselCapacity(m.pool).release(ORG,DISPATCH);
  assert.equal(h.state,'committed');
  assert(!m.seen.some(x=>x.sql.includes('UPDATE carousel_day_capacity')));
});
