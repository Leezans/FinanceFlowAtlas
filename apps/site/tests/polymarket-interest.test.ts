import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {parseOpenInterest,acquireOpenInterest} from '../lib/polymarket/interest';
import {fetchOpenInterest} from '../lib/polymarket/transport';
import {interestSelection,interestSnapshotSchema,storedCacheSchema,selectSnapshot,updateStoredCache,visibleSnapshot,INTEREST_REFRESH_MS,INTEREST_MAX_CACHE_AGE_MS,REFRESH_MS,MAX_CACHE_AGE_MS,type PolymarketReply} from '../lib/polymarket/model';
import {createPolymarketHandler} from '../lib/polymarket/handler';
import {D1PolymarketGate} from '../lib/polymarket/source-gate';
import {interestMatrix,marketItem} from '../components/polymarket/matrix';
import {matrixAreaModel,monetaryTreemap} from '../lib/matrix/layout';
import type {GateD1} from '../lib/ashare/source-gate';
import {market,ISO,NOW,snapshot} from './polymarket-fixture';
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`;
const raw=(n=3)=>Array.from({length:n},(_,i)=>({...market(String(n-i),{updatedAt:null,volume24hr:n-i}),conditionId:id(n-i)}));
const hot=()=>parseHotPolymarket(raw(),ISO,ISO);
const payload=()=>({data:[{condition_id:id(1),value:0},{condition_id:id(3),value:90}]});
const interest=()=>parseOpenInterest(payload(),hot(),ISO,ISO);
const response=():PolymarketReply=>({snapshot:interest(),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:INTEREST_REFRESH_MS,max_cache_age_ms:INTEREST_MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+INTEREST_REFRESH_MS).toISOString()}});
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec((readFileSync(new URL('../drizzle/0015_polymarket_market_cache.sql',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../drizzle/0021_polymarket_interest_cooldown.sql',import.meta.url),'utf8')));
 const db:GateD1={prepare(query){return {bind(...values){return {async run(){const results=sql.prepare(query).all(...values as SQLInputValue[]) as Record<string,unknown>[];return {success:true,results,meta:{changes:query.startsWith('UPDATE')?results.length:0}};}};}};}};
 const fetcher=vi.fn<typeof fetch>(async input=>Response.json(new URL(String(input)).pathname==='/v2/oi'?payload():raw()));
 const handler=()=>createPolymarketHandler({gate:new D1PolymarketGate(db),fetcher,isolatedForTests:true});
 const request=(view='interest')=>new Request(`https://test.invalid/api/v1/polymarket/snapshot?view=${view}`);
 const read=async(view='interest')=>await (await handler()(request(view))).json() as PolymarketReply;
 return {sql,db,fetcher,handler,request,read,clearCooldown:()=>sql.exec('UPDATE polymarket_source_gate SET not_before_ms=0,interest_not_before_ms=0')};
}
describe('verified open-interest metric and bounded cohort',()=>{
 it('uses two batches of the first 40 distinct supported conditions, never a global query or newest scan',async()=>{
  const rows=raw(60);rows[0].conditionId='bad';rows[2].conditionId=rows[1].conditionId;rows[3].conditionId=String(rows[3].conditionId).toUpperCase();
  const fetcher=vi.fn<typeof fetch>(async input=>Response.json(new URL(String(input)).pathname==='/v2/oi'?{data:[]}:rows));
  const result=await acquireOpenInterest(fetcher,new AbortController().signal,()=>NOW,NOW);
  expect(fetcher).toHaveBeenCalledTimes(3);expect(result.rows).toHaveLength(40);expect(result.discovery.rows).toHaveLength(60);expect(result.rows[0].id).toBe('59');expect(result.rows[1].id).toBe('57');
  const query=new URL(String(fetcher.mock.calls[1][0]));expect(query.origin+query.pathname).toBe('https://data-api.polymarket.com/v2/oi');expect([...query.searchParams.keys()]).toEqual(['condition']);expect(query.searchParams.get('condition')!.split(',')).toEqual(result.rows.slice(0,20).map(r=>r.condition_id));expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('condition')!.split(',')).toEqual(result.rows.slice(20).map(r=>r.condition_id));
  expect(fetcher.mock.calls[1][1]).toMatchObject({credentials:'omit',redirect:'manual',cache:'no-store'});expect(result.values).toEqual([]);
 });
 it('never requests OI when all condition IDs are missing, malformed or unsupported',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json([market('3'),market('2',{conditionId:'GLOBAL'}),market('1',{conditionId:'0x'+'1'.repeat(62)})]));
  await expect(acquireOpenInterest(fetcher,new AbortController().signal,()=>NOW,NOW)).rejects.toMatchObject({code:'no_eligible_conditions'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([[],[id(1),id(1)],['GLOBAL'],['123'],Array.from({length:21},(_,i)=>id(i))].map(ids=>({ids})))('rejects invalid selection before transport: %j',async ({ids})=>{
  const fetcher=vi.fn<typeof fetch>();await expect(fetchOpenInterest(ids,fetcher,new AbortController().signal,()=>NOW,{bytes:0})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it('matches unordered returned IDs, preserving explicit zero versus omitted values',()=>{
  const parsed=interest();expect(parsed.values).toEqual(payload().data);expect(parsed.currency).toBe('USDC');expect(parsed.metric).toBe('priced_gross_open_interest');expect(parsed.complete_universe).toBe(false);expect(parsed.source_observed_at).toBeNull();expect(parsed.net_capital_flow).toBeNull();
  const items=interestMatrix(parsed.rows,new Map(parsed.values.map(r=>[r.condition_id,r.value])))[0].items;
  expect(items.map(i=>i.amount?.value)).toEqual([90,null,0]);expect(items[1].displayValue).toBe('来源未返回');expect(items[2].displayValue).toBe('0 USDC');
 });
 it.each([-1,NaN,Infinity,'12',null,1e16])('rejects invalid amount %s',value=>{expect(()=>parseOpenInterest({data:[{condition_id:id(1),value}]},hot(),ISO,ISO)).toThrow();});
 it.each([{data:[{condition_id:'GLOBAL',value:1}]},{data:[{condition_id:id(9),value:1}]},{data:[{condition_id:id(1),value:0},{condition_id:id(1),value:1}]},{data:[{condition_id:id(1),value:1}],pagination:{}},{data:[{condition_id:id(1)}]},[]])('rejects global, foreign, duplicate and malformed evidence: %j',value=>{expect(()=>parseOpenInterest(value,hot(),ISO,ISO)).toThrow();});
 it('rejects wrong cohort, changed metadata and inverted acquisition clocks in persisted evidence',()=>{
  const base=interest();for(const invalid of [{...base,rows:base.rows.slice(1)},{...base,rows:[...base.rows].reverse()},{...base,rows:base.rows.map(r=>({...r,question:'forged'}))},{...base,oi_request_started_at:new Date(NOW-1).toISOString()},{...base,fetched_at:new Date(NOW-1).toISOString()},{...base,currency:'USD'}])expect(interestSnapshotSchema.safeParse(invalid).success).toBe(false);
 });
 it('does not give probability or unverified Gamma volume money metadata; OI geometry is proportional',()=>{
  const rows=hot().rows;expect(marketItem(rows[0],'volume').amount).toBeUndefined();expect(marketItem(rows[0],'probability').amount).toBeUndefined();
  const groups=interestMatrix(rows,new Map([[id(3),90],[id(2),10],[id(1),0]]));expect(matrixAreaModel(groups).compatible).toBe(true);
  const rectangles=monetaryTreemap(groups,1000,500).leaves;expect(rectangles).toHaveLength(2);expect(rectangles[0].share).toBeCloseTo(.9);expect(rectangles[1].share).toBeCloseTo(.1);expect(rectangles[0].width*rectangles[0].height/(rectangles[1].width*rectangles[1].height)).toBeCloseTo(9,9);
 });
 it('keeps three independent snapshots and clocks, accepts old caches, and rejects corrupt OI',()=>{
  const newest=snapshot(),h=hot(),oi=interest();const previous=updateStoredCache(newest,h),cache=updateStoredCache(previous,oi);
  expect(previous.schema).toBe('polymarket-discovery/1');expect(cache.schema).toBe('polymarket-discovery/2');expect(selectSnapshot(previous,'interest')).toBeNull();expect(selectSnapshot(cache,'hot')).toEqual(h);expect(selectSnapshot(cache,'newest')).toEqual(newest);expect(selectSnapshot(cache,'interest')).toEqual(oi);expect(storedCacheSchema.safeParse(cache).success).toBe(true);
  expect(storedCacheSchema.safeParse({...cache,interest:{...oi,values:[{condition_id:id(99),value:1}]}}).success).toBe(false);
  expect(visibleSnapshot(response(),NOW+INTEREST_MAX_CACHE_AGE_MS)).not.toBeNull();expect(visibleSnapshot(response(),NOW+INTEREST_MAX_CACHE_AGE_MS+1)).toBeNull();
 });
 it('shares combined byte budget and refuses oversized OI before decoding',async()=>{
  const f=vi.fn<typeof fetch>(async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'64001'}}));await expect(fetchOpenInterest([id(1)],f,new AbortController().signal,()=>NOW,{bytes:0})).rejects.toMatchObject({code:'byte_budget'});
  const g=vi.fn<typeof fetch>(async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'2'}}));await expect(fetchOpenInterest([id(1)],g,new AbortController().signal,()=>NOW,{bytes:7_999_999})).rejects.toMatchObject({code:'byte_budget'});
 });
 it('does not start a second request after cancellation',async()=>{
  const controller=new AbortController(),f=vi.fn<typeof fetch>(async()=>{controller.abort();return Response.json(raw());});await expect(acquireOpenInterest(f,controller.signal,()=>NOW,NOW)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);
 });
});
describe('OI uses the existing durable permission and publication gate',()=>{
 it('persists five-minute OI cooldown without slowing ordinary modes',async()=>{
  const t=setup();try{const result=await t.read();expect(result.snapshot?.schema).toBe('polymarket-open-interest/2');expect(result.status.refresh_ms).toBe(300_000);expect(result.status.max_cache_age_ms).toBe(600_000);
   const gate=t.sql.prepare('SELECT not_before_ms,interest_not_before_ms,interest_checked_ms FROM polymarket_source_gate').get()!;expect(Number(gate.interest_not_before_ms)-Number(gate.interest_checked_ms)).toBeGreaterThanOrEqual(300_000);
   for(const view of ['interest','hot','newest'])await t.read(view);expect(t.fetcher).toHaveBeenCalledTimes(2);
   t.sql.exec('UPDATE polymarket_source_gate SET not_before_ms=0');await t.read();expect(t.fetcher).toHaveBeenCalledTimes(2);await t.read('hot');expect(t.fetcher).toHaveBeenCalledTimes(3);await t.read();expect(t.fetcher).toHaveBeenCalledTimes(3);
  }finally{t.sql.close();}
 });
 it('zero eligible conditions still cools OI for five minutes',async()=>{
  const t=setup();try{t.fetcher.mockImplementation(async()=>Response.json([market()]));const result=await t.read();expect(result.status.error_code).toBe('no_eligible_conditions');expect(result.snapshot).toBeNull();for(const view of ['hot','interest','newest'])await t.read(view);expect(t.fetcher).toHaveBeenCalledTimes(1);const gate=t.sql.prepare('SELECT not_before_ms,interest_not_before_ms,interest_checked_ms FROM polymarket_source_gate').get()!;expect(Number(gate.interest_not_before_ms)-Number(gate.interest_checked_ms)).toBeGreaterThanOrEqual(300_000);}finally{t.sql.close();}
 });
 it('never publishes a new Gamma sample with old OI after a second-request failure',async()=>{
  const t=setup();try{const first=await t.read();const prior=t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload;t.clearCooldown();t.fetcher.mockImplementation(async input=>new URL(String(input)).pathname==='/v2/oi'?new Response(null,{status:503,headers:{'retry-after':'3600'}}):Response.json(raw(5)));
   const result=await t.read();expect(result.snapshot).toEqual(first.snapshot);expect(result.status.state).toBe('stale');expect(t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload).toBe(prior);expect(Date.parse(result.status.next_retry_at!)-Date.now()).toBeGreaterThan(3_590_000);await t.read('hot');expect(t.fetcher).toHaveBeenCalledTimes(4);
  }finally{t.sql.close();}
 });
 it.each([401,403,407,429,451,302])('OI HTTP %s durably blocks every view with no fallback',async status=>{
  const t=setup();try{await t.read();t.clearCooldown();t.fetcher.mockImplementation(async input=>new URL(String(input)).pathname==='/v2/oi'?new Response(null,{status}):Response.json(raw()));const result=await t.read();expect(result.status.state).toBe('denied');expect(result.snapshot).toBeNull();for(const view of ['hot','newest','interest'])expect((await t.read(view)).snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(4);expect(t.sql.prepare('SELECT status,payload FROM polymarket_source_gate').get()).toMatchObject({status:'blocked',payload:null});}finally{t.sql.close();}
 });
 it('OI HTML challenge blocks, whereas malformed JSON retains original evidence without refresh',async()=>{
  for(const html of [true,false]){const t=setup();try{const first=await t.read();t.clearCooldown();t.fetcher.mockImplementation(async input=>new URL(String(input)).pathname==='/v2/oi'?new Response(html?'<html>challenge</html>':'{"data":',{headers:{'content-type':html?'text/html':'application/json'}}):Response.json(raw()));const result=await t.read();expect(result.status.state).toBe(html?'denied':'stale');expect(result.snapshot).toEqual(html?null:first.snapshot);}finally{t.sql.close();}}
 });
 it('mixed concurrent views acquire once, OI status never starts a collector',async()=>{
  const t=setup();try{const out=await Promise.all([t.handler()(t.request()),t.handler()(t.request('hot'))]);expect(t.fetcher.mock.calls.length).toBeLessThanOrEqual(2);const bodies=await Promise.all(out.map(r=>r.json() as Promise<PolymarketReply>));expect(bodies.filter(r=>r.status.error_code==='source_busy')).toHaveLength(1);const count=t.fetcher.mock.calls.length;await t.handler()(new Request('https://test.invalid/api/v1/polymarket/status?view=interest'));expect(t.fetcher).toHaveBeenCalledTimes(count);}finally{t.sql.close();}
 });
 it('holds the ordinary-mode cache ages at 30 seconds / 5 minutes',async()=>{
  const t=setup();try{const result=await t.read('hot');expect(result.status.refresh_ms).toBe(REFRESH_MS);expect(result.status.max_cache_age_ms).toBe(MAX_CACHE_AGE_MS);expect(selectSnapshot(interest(),'hot')).toBeNull();expect(interestSelection(hot().rows)).toHaveLength(3);}finally{t.sql.close();}
 });
});
