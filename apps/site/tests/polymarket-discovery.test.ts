import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseHotPolymarket,parsePolymarket} from '../lib/polymarket/adapter';
import {fetchHotPolymarket} from '../lib/polymarket/transport';
import {HOT_SOURCE_URL,HOT_MARKETS,storedCacheSchema,selectSnapshot,updateStoredCache,MAX_CACHE_AGE_MS,MAX_CACHE_BYTES,type PolymarketReply} from '../lib/polymarket/model';
import {createPolymarketHandler} from '../lib/polymarket/handler';
import {D1PolymarketGate} from '../lib/polymarket/source-gate';
import type {GateD1} from '../lib/ashare/source-gate';
import {fixture,market,snapshot,ISO} from './polymarket-fixture';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec((readFileSync(new URL('../drizzle/0015_polymarket_market_cache.sql',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../drizzle/0021_polymarket_interest_cooldown.sql',import.meta.url),'utf8')));
 const db:GateD1={prepare(query){return {bind(...values){return {async run(){const results=sql.prepare(query).all(...values as SQLInputValue[]) as Record<string,unknown>[];return {success:true,results,meta:{changes:query.startsWith('UPDATE')?results.length:0}};}};}};}};
 return {sql,db};
}
const request=(view='hot')=>new Request(`https://test.invalid/api/v1/polymarket/snapshot?view=${view}`);
const body=async(r:Response)=>await r.json() as PolymarketReply;
function currentRows(){return fixture().map(r=>({...r,updatedAt:null}));}
function setup(){
 const {sql,db}=database();
 const fetcher=vi.fn<typeof fetch>(async input=>Response.json(new URL(String(input)).pathname==='/markets'?currentRows():{markets:currentRows()}));
 const handler=()=>createPolymarketHandler({gate:new D1PolymarketGate(db),fetcher,isolatedForTests:true});
 return {sql,db,fetcher,handler,releaseCooldown:()=>sql.exec('UPDATE polymarket_source_gate SET not_before_ms=0')};
}
describe('independent hot and newest source windows',()=>{
 it('selects one official volume-ranked window without keyset/offset expansion',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(fixture()));const rows=await fetchHotPolymarket(fetcher,new AbortController().signal,Date.now);
  expect(rows).toEqual(fixture());expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledWith(HOT_SOURCE_URL,expect.objectContaining({credentials:'omit',redirect:'manual'}));
  const url=new URL(HOT_SOURCE_URL);expect(url.pathname).toBe('/markets');expect(url.searchParams.get('limit')).toBe('100');expect(url.searchParams.get('order')).toBe('volume24hr');expect(url.searchParams.has('offset')).toBe(false);
 });
 it('records exact single-window coverage and retains missing/zero volume without inventing totals',()=>{
  const hot=parseHotPolymarket(fixture(),ISO,ISO);expect(hot.rows.map(r=>r.volume_24h)).toEqual([1234.56,0,null]);expect(hot.source_market_count).toBe(3);expect(hot.source_page_sizes).toEqual([3]);expect(hot.stop_reason).toBe('source_short_page');expect(hot.has_more).toBeNull();expect(hot.total_market_count).toBeNull();expect(hot.complete_universe).toBe(false);
  const full=parseHotPolymarket(Array.from({length:HOT_MARKETS},(_,i)=>market(String(i+1))),ISO,ISO);expect(full.stop_reason).toBe('sample_limit');
 });
 it('rejects inverted known volume rankings instead of claiming a verified source rank',()=>{expect(()=>parseHotPolymarket([market('2',{volume24hr:1}),market('1',{volume24hr:2})],ISO,ISO)).toThrow();});
 it('does not replace missing 24h volume with cumulative or event-level volume',()=>{
  const hot=parseHotPolymarket([market('1',{volume24hr:null,volume:1000,volumeNum:1000,volume24hrClob:200,events:[{volume24hr:900}]})],ISO,ISO);expect(hot.rows[0].volume_24h).toBeNull();
 });
 it('enforces distinct IDs, sample cap, data type and active/open eligibility',async()=>{
  for(const rows of [{markets:fixture()},[],[market(),market()],Array.from({length:101},(_,i)=>market(String(i)))])await expect(fetchHotPolymarket(async()=>Response.json(rows),new AbortController().signal,Date.now)).rejects.toThrow();
  const hot=parseHotPolymarket([market('1'),market('2',{active:false}),market('3',{closed:true}),market('4',{archived:true})],ISO,ISO);expect(hot.rows).toHaveLength(1);expect(hot.excluded_market_count).toBe(3);
 });
 it('never relabels prior newest/v1 cache as hot; bundles independently dated snapshots',()=>{
  const newest=snapshot(),hot=parseHotPolymarket(fixture(),ISO,ISO),cache=updateStoredCache(newest,hot);
  expect(selectSnapshot(newest,'hot')).toBeNull();expect(selectSnapshot(cache,'newest')).toEqual(newest);expect(selectSnapshot(cache,'hot')).toEqual(hot);expect(storedCacheSchema.safeParse(cache).success).toBe(true);
  expect(storedCacheSchema.safeParse({schema:'polymarket-discovery/1',newest:hot,hot:newest}).success).toBe(false);expect(storedCacheSchema.safeParse({schema:'polymarket-discovery/1',newest:null,hot:null}).success).toBe(false);
 });
 it('switches modes through the same durable cooldown and preserves both caches across cold workers',async()=>{
  const t=setup();try{
   const first=await body(await t.handler()(request('newest')));expect(first.snapshot?.schema).toBe('polymarket-gamma/2');
   const waiting=await body(await t.handler()(request()));expect(waiting.snapshot).toBeNull();expect(waiting.status.error_code).toBe('source_cooldown');expect(t.fetcher).toHaveBeenCalledTimes(1);
   t.releaseCooldown();const hot=await body(await t.handler()(request()));expect(hot.snapshot?.schema).toBe('polymarket-gamma/hot/1');expect(t.fetcher).toHaveBeenCalledTimes(2);
   const raw=t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload as string;const stored=JSON.parse(raw);expect(stored.schema).toBe('polymarket-discovery/1');expect(stored.newest).toEqual(first.snapshot);expect(stored.hot).toEqual(hot.snapshot);
   expect((await body(await t.handler()(request('newest')))).snapshot).toEqual(first.snapshot);expect((await body(await t.handler()(request()))).snapshot).toEqual(hot.snapshot);expect(t.fetcher).toHaveBeenCalledTimes(2);
  }finally{t.sql.close();}
 });
 it('preserves both exact prior source windows after hot503 without fallback or timestamp refresh',async()=>{
  const t=setup();try{
   const newest=await body(await t.handler()(request('newest')));t.releaseCooldown();const hot=await body(await t.handler()(request()));const raw=t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload;
   t.releaseCooldown();t.fetcher.mockImplementation(async()=>new Response(null,{status:503,headers:{'retry-after':'3600'}}));
   const failed=await body(await t.handler()(request()));expect(failed.status.state).toBe('stale');expect(failed.snapshot).toEqual(hot.snapshot);expect(t.fetcher).toHaveBeenCalledTimes(3);expect(t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload).toBe(raw);
   const other=await body(await t.handler()(request('newest')));expect(other.snapshot).toEqual(newest.snapshot);expect(t.fetcher).toHaveBeenCalledTimes(3);
  }finally{t.sql.close();}
 });
 it.each([401,403,429,451])('hot HTTP %s clears both caches and permanently stops newest as well',async status=>{
  const t=setup();try{
   await t.handler()(request('newest'));t.releaseCooldown();await t.handler()(request());t.releaseCooldown();t.fetcher.mockImplementation(async()=>new Response(null,{status}));
   expect((await body(await t.handler()(request()))).status.state).toBe('denied');expect(t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload).toBeNull();
   expect((await body(await t.handler()(request('newest')))).snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(3);
  }finally{t.sql.close();}
 });
 it('expires each mode using its original fetch time rather than the newer companion timestamp',async()=>{
  const t=setup();try{
   const hot=parseHotPolymarket(currentRows(),ISO,ISO),newest={...snapshot(),acquisition_started_at:new Date().toISOString(),fetched_at:new Date().toISOString(),rows: snapshot().rows.map(r=>({...r,source_record_updated_at:null}))};
   hot.fetched_at=new Date(Date.now()-MAX_CACHE_AGE_MS-1000).toISOString();hot.acquisition_started_at=hot.fetched_at;
   t.sql.prepare('UPDATE polymarket_source_gate SET payload=?,not_before_ms=?').run(JSON.stringify(updateStoredCache(newest,hot)),Date.now()+60_000);
   expect((await body(await t.handler()(request()))).snapshot).toBeNull();expect((await body(await t.handler()(request('newest')))).snapshot).toEqual(newest);expect(t.fetcher).not.toHaveBeenCalled();
  }finally{t.sql.close();}
 });
 it('hot failure preserves validated v1 payload byte-for-byte with its original timestamps',async()=>{
  const t=setup();try{
   const legacy:Record<string,unknown>={...snapshot(),schema:'polymarket-gamma/1',sample_limit:200,ordering:'source_volume24hr_descending',acquisition_started_at:new Date().toISOString(),fetched_at:new Date().toISOString()};for(const key of ['total_market_count','pagination','source_page_count','source_page_sizes','stop_reason','has_more','grouping'])delete legacy[key];
   const raw=JSON.stringify(legacy);t.sql.prepare('UPDATE polymarket_source_gate SET payload=?,not_before_ms=0').run(raw);t.fetcher.mockImplementation(async()=>new Response(null,{status:503}));
   expect((await body(await t.handler()(request()))).snapshot).toBeNull();expect(t.sql.prepare('SELECT payload FROM polymarket_source_gate').get()?.payload).toBe(raw);expect((await body(await t.handler()(request('newest')))).snapshot).toEqual(legacy);expect(t.fetcher).toHaveBeenCalledTimes(1);
  }finally{t.sql.close();}
 });
 it('rejects combined oversize before publication, releases exact lease and preserves prior payload',async()=>{
  const t=setup();try{
   const at=new Date().toISOString(),tags=(n:number)=>Array.from({length:n},(_,i)=>({slug:`tag-${i}`,label:'x'.repeat(190)}));
   const newest=parsePolymarket(Array.from({length:500},(_,i)=>market(String(1000-i),{question:'q'.repeat(900),tags:tags(8),updatedAt:null})),at,at,{pageSizes:[100,100,100,100,100],stopReason:'page_limit',hasMore:true});
   const hotRows=Array.from({length:100},(_,i)=>market(String(i+1),{question:'q'.repeat(900),tags:tags(24),updatedAt:null})),hot=parseHotPolymarket(hotRows,at,at);
   const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;expect(bytes(newest)).toBeLessThan(MAX_CACHE_BYTES);expect(bytes(hot)).toBeLessThan(MAX_CACHE_BYTES);expect(bytes(updateStoredCache(newest,hot))).toBeGreaterThan(MAX_CACHE_BYTES);
   const raw=JSON.stringify(newest);t.sql.prepare('UPDATE polymarket_source_gate SET payload=?,not_before_ms=0').run(raw);t.fetcher.mockImplementation(async()=>Response.json(hotRows));
   const result=await body(await t.handler()(request()));expect(result.snapshot).toBeNull();expect(result.status.error_code).toBe('snapshot_byte_budget');expect(t.sql.prepare('SELECT status,lease_token,payload FROM polymarket_source_gate').get()).toMatchObject({status:'idle',lease_token:null,payload:raw});
  }finally{t.sql.close();}
 });
 it('corruption in either bundled mode suppresses all rows before source acquisition',async()=>{
  const t=setup();try{
   for(const mode of ['hot','newest']){const cache={schema:'polymarket-discovery/1',newest:snapshot(),hot:parseHotPolymarket(fixture(),ISO,ISO),[mode]:{schema:'bad'}};t.sql.prepare('UPDATE polymarket_source_gate SET payload=?').run(JSON.stringify(cache));const result=await body(await t.handler()(request()));expect(result.snapshot).toBeNull();expect(result.status.error_code).toBe('source_gate_unavailable');}expect(t.fetcher).not.toHaveBeenCalled();
  }finally{t.sql.close();}
 });
 it('simultaneous mixed-view requests share one admission and never cause a fallback request',async()=>{
  const t=setup();try{
   const results=await Promise.all([t.handler()(request()),t.handler()(request('newest'))]);expect(t.fetcher).toHaveBeenCalledTimes(1);const replies=await Promise.all(results.map(body));expect(replies.filter(r=>r.snapshot!==null)).toHaveLength(1);expect(replies.filter(r=>r.status.error_code==='source_busy')).toHaveLength(1);
  }finally{t.sql.close();}
 });
 it('does not acquire for invalid/multiple view selectors or status reads',async()=>{
  const t=setup();try{
   for(const suffix of ['?view=all','?view=hot&view=newest','?view=hot&force=true','?view='])expect((await t.handler()(new Request('https://test.invalid/api/v1/polymarket/snapshot'+suffix))).status).toBe(400);
   await t.handler()(new Request('https://test.invalid/api/v1/polymarket/status?view=hot'));expect(t.fetcher).not.toHaveBeenCalled();
  }finally{t.sql.close();}
 });
});
