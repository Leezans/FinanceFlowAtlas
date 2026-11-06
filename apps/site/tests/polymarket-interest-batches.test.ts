import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {acquireOpenInterest,parseOpenInterest,parseOpenInterestBatch} from '../lib/polymarket/interest';
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {batchedInterestSnapshotSchema,storedCacheSchema,visibleSnapshot,snapshotCacheTime,selectSnapshot,updateStoredCache,type PolymarketReply} from '../lib/polymarket/model';
import {createPolymarketHandler,DEADLINE_MS} from '../lib/polymarket/handler';
import {D1PolymarketGate} from '../lib/polymarket/source-gate';
import type {GateD1} from '../lib/ashare/source-gate';
import {market,ISO,NOW} from './polymarket-fixture';
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`;
const raw=(n=60)=>Array.from({length:n},(_,i)=>market(String(n-i),{updatedAt:null,volume24hr:n-i,conditionId:id(n-i)}));
const conditions=(input:RequestInfo|URL)=>new URL(String(input)).searchParams.get('condition')!.split(',');
const payload=(ids:string[])=>({data:ids.map((condition_id,i)=>({condition_id,value:i===0?0:100+i})).reverse()});
const source=(n=60)=>vi.fn<typeof fetch>(async input=>Response.json(new URL(String(input)).pathname==='/v2/oi'?payload(conditions(input)):raw(n)));
const acquire=(fetcher:typeof fetch=source(),now=()=>NOW)=>acquireOpenInterest(fetcher,new AbortController().signal,now,NOW);
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of ['0015_polymarket_market_cache','0021_polymarket_interest_cooldown'])sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
 const db:GateD1={prepare(query){return {bind(...values){return {async run(){const results=sql.prepare(query).all(...values as SQLInputValue[]) as Record<string,unknown>[];return {success:true,results,meta:{changes:query.startsWith('UPDATE')?results.length:0}};}};}};}};
 const fetcher=source(),handler=()=>createPolymarketHandler({gate:new D1PolymarketGate(db),fetcher,isolatedForTests:true});
 const request=(signal?:AbortSignal)=>new Request('https://test.invalid/api/v1/polymarket/snapshot?view=interest',{signal});
 const read=async(signal?:AbortSignal)=>await(await handler()(request(signal))).json() as PolymarketReply;
 const row=()=>sql.prepare('SELECT * FROM polymarket_source_gate').get()!;
 const resetFixture=()=>sql.exec('UPDATE polymarket_source_gate SET not_before_ms=0,interest_not_before_ms=0');
 return {sql,fetcher,handler,request,read,row,resetFixture};
}
describe('bounded 40-condition OI acquisition',()=>{
 it.each([1,20,21,40,60,100])('keeps one frozen cohort and at most two 20-ID batches for %i candidates',async n=>{
  const fetcher=source(n),s=await acquire(fetcher),count=Math.min(n,40);
  expect(s.rows).toHaveLength(count);expect(s.batches).toHaveLength(Math.ceil(count/20));expect(s.values).toHaveLength(count);expect(fetcher).toHaveBeenCalledTimes(1+Math.ceil(count/20));
  expect(s.batches.flatMap(b=>b.condition_ids)).toEqual(s.rows.map(row=>row.condition_id));expect(new Set(s.values.map(v=>v.condition_id)).size).toBe(count);
  expect(s.batches.flatMap(b=>b.returned_condition_ids)).toEqual(s.values.map(v=>v.condition_id));expect(s.sample_limit).toBe(40);expect(s.complete_universe).toBe(false);expect(s.total_market_count).toBeNull();
  for(const [request,init] of fetcher.mock.calls.slice(1)){expect(conditions(request).length).toBeLessThanOrEqual(20);expect(init).toMatchObject({credentials:'omit',redirect:'manual'});}
 });
 it('keeps missing IDs distinct from zero without filling the next candidate',async()=>{
  const fetcher=source();fetcher.mockImplementation(async input=>Response.json(new URL(String(input)).pathname==='/v2/oi'?{data:[{condition_id:conditions(input)[0],value:0}]}:raw()));
  const s=await acquire(fetcher);expect(s.rows).toHaveLength(40);expect(s.values).toHaveLength(2);expect(s.values.every(v=>v.value===0)).toBe(true);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it.each([{data:[{condition_id:id(1),value:1}]},{data:[{condition_id:id(60),value:1},{condition_id:id(60),value:1}]},{data:[{condition_id:'GLOBAL',value:1}]}])('rejects corrupt first batch before issuing the second: %j',async data=>{
  const fetcher=source();fetcher.mockImplementation(async input=>Response.json(new URL(String(input)).pathname==='/v2/oi'?data:raw()));
  await expect(acquire(fetcher)).rejects.toMatchObject({code:'invalid_open_interest'});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('rejects a previous-batch condition even if it belongs to the overall cohort',()=>{
  expect(()=>parseOpenInterestBatch(payload([id(60)]),[id(40)],ISO,ISO)).toThrow();
 });
 it('checks the shared time budget before starting another batch',async()=>{
  let now=NOW;const fetcher=source();fetcher.mockImplementation(async input=>{if(new URL(String(input)).pathname==='/v2/oi'){now=NOW+DEADLINE_MS;return Response.json(payload(conditions(input)));}return Response.json(raw());});
  await expect(acquire(fetcher,()=>now)).rejects.toMatchObject({code:'timeout'});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not begin a second batch after cancellation',async()=>{
  const controller=new AbortController(),fetcher=source();fetcher.mockImplementation(async input=>{if(new URL(String(input)).pathname==='/v2/oi'){controller.abort();return Response.json(payload(conditions(input)));}return Response.json(raw());});
  await expect(acquireOpenInterest(fetcher,controller.signal,()=>NOW,NOW)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('records per-batch intervals and ages the entire snapshot from the first request',async()=>{
  let now=NOW;const fetcher=source();fetcher.mockImplementation(async input=>{now+=1000;return Response.json(new URL(String(input)).pathname==='/v2/oi'?payload(conditions(input)):raw());});
  const s=await acquire(fetcher,()=>now);expect(s.batches.map(b=>[b.requested_at,b.fetched_at])).toEqual([[new Date(NOW+1000).toISOString(),new Date(NOW+2000).toISOString()],[new Date(NOW+2000).toISOString(),new Date(NOW+3000).toISOString()]]);
  expect(snapshotCacheTime(s)).toBe(NOW+1000);expect(s.source_observed_at).toBeNull();
  const reply:PolymarketReply={snapshot:s,status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:s.fetched_at,cache_age_ms:2000,refresh_ms:300000,max_cache_age_ms:600000,next_retry_at:null}};
  expect(visibleSnapshot(reply,NOW+601000)).toEqual(s);expect(visibleSnapshot(reply,NOW+601001)).toBeNull();
  expect(selectSnapshot(updateStoredCache(s,{...s,acquisition_started_at:ISO}),'interest')).toEqual(s);
 });
 it('rejects incomplete, reordered, oversized, foreign or contradictory persisted batch evidence',async()=>{
  const s=await acquire();
  for(const invalid of [{...s,rows:[],values:[],batches:[]},{...s,batches:[]},{...s,batches:s.batches.slice(0,1)},{...s,batches:[...s.batches].reverse()},{...s,values:s.values.slice(1)},{...s,rows:s.rows.slice(1)},{...s,sample_limit:100},{...s,batch_size:40},{...s,batches:s.batches.map((b,i)=>i?{...b,requested_at:new Date(NOW-1).toISOString()}:b)},{...s,batches:s.batches.map((b,i)=>i?{...b,condition_ids:s.batches[0].condition_ids}:b)},{...s,fetched_at:new Date(NOW+12001).toISOString()}])expect(batchedInterestSnapshotSchema.safeParse(invalid).success).toBe(false);
 });
});
describe('atomic multi-batch publication in the durable gate',()=>{
 it.each([503,429,403,302])('later batch HTTP %i never publishes partial evidence',async status=>{
  const t=setup();try{
   const first=await t.read(),prior=t.row().payload;t.resetFixture();let batch=0;
   t.fetcher.mockImplementation(async input=>new URL(String(input)).pathname==='/v2/oi'?(++batch===2?new Response(null,{status}):Response.json(payload(conditions(input)))):Response.json(raw(100)));
   const result=await t.read(),denied=status!==503;
   expect(result.status.state).toBe(denied?'denied':'stale');expect(result.snapshot).toEqual(denied?null:first.snapshot);expect(t.row().payload).toBe(denied?null:prior);expect(t.row().status).toBe(denied?'blocked':'idle');expect(t.row().lease_token).toBeNull();expect(batch).toBe(2);
   const calls=t.fetcher.mock.calls.length;await t.read();expect(t.fetcher).toHaveBeenCalledTimes(calls);
  }finally{t.sql.close();}
 });
 it('retains legacy 20-condition raw cache and its original semantics after a cold later-batch failure',async()=>{
  const t=setup();try{
   const stamp=new Date().toISOString(),discovery=parseHotPolymarket(raw(),stamp,stamp),legacy=parseOpenInterest(payload(discovery.rows.slice(0,20).map(r=>r.condition_id!)),discovery,stamp,stamp);
   const bytes=JSON.stringify(legacy);t.sql.prepare('UPDATE polymarket_source_gate SET payload=?').run(bytes);let batch=0;
   t.fetcher.mockImplementation(async input=>new URL(String(input)).pathname==='/v2/oi'?(++batch===2?new Response(null,{status:503}):Response.json(payload(conditions(input)))):Response.json(raw(100)));
   const result=await t.read();expect(result.status.state).toBe('stale');expect(result.snapshot).toEqual(legacy);expect(result.snapshot?.sample_limit).toBe(20);expect(t.row().payload).toBe(bytes);expect(storedCacheSchema.parse(JSON.parse(bytes))).toEqual(legacy);
   const cold=await t.read();expect(cold.snapshot).toEqual(legacy);expect(t.fetcher).toHaveBeenCalledTimes(3);
  }finally{t.sql.close();}
 });
 it('releases an aborted later streaming batch without publishing either batch',async()=>{
  const t=setup();try{
   const first=await t.read(),prior=t.row().payload;t.resetFixture();let batch=0;const controller=new AbortController();let notify=()=>{};
   const ready=new Promise<void>(resolve=>{notify=resolve;});
   t.fetcher.mockImplementation(async input=>{if(new URL(String(input)).pathname!=='/v2/oi')return Response.json(raw());if(++batch===1)return Response.json(payload(conditions(input)));return new Response(new ReadableStream({start(){notify();}}),{headers:{'content-type':'application/json'}});});
   const pending=t.read(controller.signal);await ready;controller.abort();const result=await pending;
   expect(result.status.error_code).toBe('source_aborted');expect(result.snapshot).toEqual(first.snapshot);expect(t.row().payload).toBe(prior);expect(t.row().lease_token).toBeNull();expect(t.row().status).toBe('idle');
  }finally{t.sql.close();}
 });
 it('the same 12-second deadline aborts a pending second batch and releases its owner',async()=>{
  const t=setup();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{
   let batch=0,notify=()=>{};const ready=new Promise<void>(resolve=>{notify=resolve;});
   t.fetcher.mockImplementation(async input=>{if(new URL(String(input)).pathname!=='/v2/oi')return Response.json(raw());if(++batch===1)return Response.json(payload(conditions(input)));return new Response(new ReadableStream({start(){notify();}}),{headers:{'content-type':'application/json'}});});
   const pending=t.read();await ready;await vi.advanceTimersByTimeAsync(DEADLINE_MS+1);const result=await pending;
   expect(result.status.error_code).toBe('timeout');expect(result.snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(3);expect(t.row().lease_token).toBeNull();expect(t.row().status).toBe('idle');expect(t.row().payload).toBeNull();
  }finally{vi.useRealTimers();t.sql.close();}
 });
 it('rejects an oversized second batch before publication and retains prior bytes',async()=>{
  const t=setup();try{
   const first=await t.read(),prior=t.row().payload;t.resetFixture();let batch=0;
   t.fetcher.mockImplementation(async input=>new URL(String(input)).pathname==='/v2/oi'?(++batch===2?new Response('{}',{headers:{'content-type':'application/json','content-length':'64001'}}):Response.json(payload(conditions(input)))):Response.json(raw()));
   const result=await t.read();expect(result.status.error_code).toBe('byte_budget');expect(result.snapshot).toEqual(first.snapshot);expect(t.row().payload).toBe(prior);expect(t.row().lease_token).toBeNull();
  }finally{t.sql.close();}
 });
 it('preflights the complete shared cache size before releasing success',async()=>{
  const t=setup();try{
   const first=await t.read(),prior=t.row().payload;t.resetFixture();const huge=raw().map(row=>({...row,tags:Array.from({length:100},(_,i)=>({slug:String(i).padStart(100,'a'),label:'L'.repeat(200)}))}));
   t.fetcher.mockImplementation(async input=>Response.json(new URL(String(input)).pathname==='/v2/oi'?payload(conditions(input)):huge));
   const result=await t.read();expect(result.status.error_code).toBe('snapshot_byte_budget');expect(result.snapshot).toEqual(first.snapshot);expect(t.row().payload).toBe(prior);expect(t.row().lease_token).toBeNull();expect(t.row().status).toBe('idle');
  }finally{t.sql.close();}
 });

});
