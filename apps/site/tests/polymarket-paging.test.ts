import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchPolymarket,COLLECTION_BUDGET_MS,PAGE_INTERVAL_MS} from '../lib/polymarket/transport';
import {parsePolymarket} from '../lib/polymarket/adapter';
import {createPolymarketHandler,type PolymarketGate,DEADLINE_MS} from '../lib/polymarket/handler';
import {MAX_PAGES,MAX_MARKETS,REFRESH_MS,SOURCE_URL,snapshotSchema,type PolymarketReply} from '../lib/polymarket/model';
import {market,ISO,NOW,snapshot} from './polymarket-fixture';
const request=()=>new Request('https://test.invalid/api/v1/polymarket/snapshot');
const page=(start:number,count=100,cursor:string|undefined=undefined)=>({markets:Array.from({length:count},(_,i)=>market(String(start-i))),...(cursor===undefined?{}:{next_cursor:cursor})});
const signal=()=>new AbortController().signal;
function gate():PolymarketGate{return {inspect:vi.fn(async()=>({state:'idle' as const,retryAt:0,snapshot:null,errorCode:null,checkedAt:0})),acquire:vi.fn(async()=>({token:'synthetic-lease'})),release:vi.fn(async()=>{})};}
afterEach(()=>vi.useRealTimers());
describe('bounded immutable-ID keyset traversal',()=>{
 it('collects five exact pages under one lease, with no sixth request or invented total',async()=>{
  vi.useFakeTimers();let count=0;const g=gate(),fetcher=vi.fn<typeof fetch>(async()=>Response.json(page(1000-100*count,100,`opaque-${++count}`)));
  const handler=createPolymarketHandler({gate:g,fetcher,now:()=>NOW,isolatedForTests:true}),pending=handler(request());await vi.advanceTimersByTimeAsync(2000);
  const response=await pending,value=await response.json() as PolymarketReply;expect(response.status).toBe(200);expect(value.snapshot).toMatchObject({sample_limit:500,source_market_count:500,source_page_count:5,source_page_sizes:[100,100,100,100,100],total_market_count:null,has_more:true,stop_reason:'page_limit',complete_universe:false,ordering:'source_id_descending'});
  expect(value.snapshot!.rows).toHaveLength(MAX_MARKETS);expect(new Set(value.snapshot!.rows.map((r:{id:string})=>r.id)).size).toBe(500);expect(fetcher).toHaveBeenCalledTimes(MAX_PAGES);expect(g.acquire).toHaveBeenCalledTimes(1);expect(g.release).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(SOURCE_URL);for(let i=1;i<5;i++){const url=new URL(String(fetcher.mock.calls[i][0]));expect(url.searchParams.get('after_cursor')).toBe(`opaque-${i}`);expect(url.searchParams.has('offset')).toBe(false);expect(url.origin).toBe('https://gamma-api.polymarket.com');expect(url.pathname).toBe('/markets/keyset');}
  await handler(request());expect(fetcher).toHaveBeenCalledTimes(5);
 });
 it('follows cursor from a shorter effective page and only marks exhaustion when omitted',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(100,3,'opaque+/=cursor'))).mockResolvedValueOnce(Response.json(page(97,2)));
  const pending=fetchPolymarket(fetcher,signal(),()=>NOW);await vi.advanceTimersByTimeAsync(PAGE_INTERVAL_MS+1);const result=await pending;
  expect(result.coverage).toEqual({pageSizes:[3,2],stopReason:'source_exhausted',hasMore:false});expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('after_cursor')).toBe('opaque+/=cursor');expect(result.rows).toHaveLength(5);
 });
 it('counts an empty terminal page, not a fabricated total or complete universe',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(100,3,'next'))).mockResolvedValueOnce(Response.json({markets:[]}));
  const pending=fetchPolymarket(fetcher,signal(),()=>NOW);await vi.advanceTimersByTimeAsync(300);const result=await pending,s=parsePolymarket(result.rows,ISO,ISO,result.coverage);expect(s.source_page_sizes).toEqual([3,0]);expect(s.total_market_count).toBeNull();expect(s.complete_universe).toBe(false);
 });
 it.each([
  [{markets:[market('100')],next_cursor:'a'},{markets:[market('100')]} ,'duplicate_market'],
  [{markets:[market('100')],next_cursor:'a'},{markets:[market('101')]} ,'unstable_page_order'],
  [{markets:[market('100')],next_cursor:'a'},{markets:[market('99')],next_cursor:'a'} ,'repeated_cursor'],
  [{markets:[market('100')],next_cursor:'a'},{markets:[],next_cursor:'b'} ,'repeated_cursor'],
 ])('rejects cross-page overlap, order drift or cursor loops without partial publication',async(first,second,error)=>{
  vi.useFakeTimers();const g=gate(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second));const pending=createPolymarketHandler({gate:g,fetcher,now:()=>NOW,isolatedForTests:true})(request());await vi.advanceTimersByTimeAsync(300);const value=await (await pending).json() as PolymarketReply;expect(value.snapshot).toBeNull();expect(value.status.error_code).toBe(error);expect(fetcher).toHaveBeenCalledTimes(2);expect(g.release).toHaveBeenLastCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure',errorCode:error}));
 });
 it.each([null,'',42,'x'.repeat(2049),'bad\ncursor'])('rejects invalid cursor %j before any next-page request',async cursor=>{const fetcher=vi.fn<typeof fetch>(async()=>Response.json({...page(100,1),next_cursor:cursor}));await expect(fetchPolymarket(fetcher,signal(),()=>NOW)).rejects.toMatchObject({code:'invalid_cursor'});expect(fetcher).toHaveBeenCalledTimes(1);});
 it.each([{},[],{markets:null},{markets:[market('01')]},{markets:[market('1'),market('2')]},{markets:Array.from({length:101},(_,i)=>market(String(200-i)))}])('rejects malformed page or nonnumeric/unstable IDs %j',async payload=>{await expect(fetchPolymarket(async()=>Response.json(payload),signal(),()=>NOW)).rejects.toThrow();});
 it('stops before another request when collection budget is used, preserving exact bounded metadata',async()=>{
  let time=NOW;const fetcher=vi.fn<typeof fetch>(async()=>{time+=COLLECTION_BUDGET_MS;return Response.json(page(100,100,'next'));});const result=await fetchPolymarket(fetcher,signal(),()=>time);expect(result.coverage).toEqual({pageSizes:[100],hasMore:true,stopReason:'time_budget'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('honors cancellation while pacing and never starts a later page',async()=>{
  vi.useFakeTimers();const controller=new AbortController(),g=gate(),fetcher=vi.fn<typeof fetch>(async()=>Response.json(page(100,100,'next'))),handler=createPolymarketHandler({gate:g,fetcher,now:()=>NOW,isolatedForTests:true});const pending=handler(new Request(request().url,{signal:controller.signal}));await vi.advanceTimersByTimeAsync(100);controller.abort();const value=await (await pending).json() as PolymarketReply;expect(value.snapshot).toBeNull();expect(value.status.error_code).toBe('source_aborted');expect(fetcher).toHaveBeenCalledTimes(1);expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure'}));
 });
 it.each([403,429,451,302])('later-page HTTP %s denies the whole traversal and stops all future calls',async status=>{
  vi.useFakeTimers();let time=NOW;const g=gate(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(100,100,'next'))).mockResolvedValueOnce(new Response(null,{status}));const handler=createPolymarketHandler({gate:g,fetcher,now:()=>time,isolatedForTests:true}),pending=handler(request());await vi.advanceTimersByTimeAsync(300);const value=await (await pending).json() as PolymarketReply;expect(value.status.state).toBe('denied');expect(value.snapshot).toBeNull();expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'denied'}));time+=86400_000;await handler(request());expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('later-page transient error preserves only the previous completed snapshot, not new partial rows',async()=>{
  vi.useFakeTimers();let time=NOW;const g=gate(),old=snapshot();vi.mocked(g.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:old,errorCode:null,checkedAt:NOW});const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(100,100,'next'))).mockResolvedValueOnce(new Response(null,{status:503}));time+=REFRESH_MS;const pending=createPolymarketHandler({gate:g,fetcher,now:()=>time,isolatedForTests:true})(request());await vi.advanceTimersByTimeAsync(300);const value=await (await pending).json() as PolymarketReply;expect(value.status.state).toBe('stale');expect(value.snapshot).toEqual(old);expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure'}));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('shares one absolute deadline across pages and releases the lease after a hung page',async()=>{
  vi.useFakeTimers();const g=gate(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(100,100,'next'))).mockImplementationOnce(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));const pending=createPolymarketHandler({gate:g,fetcher,now:()=>NOW,isolatedForTests:true})(request());await vi.advanceTimersByTimeAsync(DEADLINE_MS+1);const value=await (await pending).json() as PolymarketReply;expect(value.snapshot).toBeNull();expect(value.status.error_code).toBe('timeout');expect(fetcher).toHaveBeenCalledTimes(2);expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure'}));
 });
 it('enforces the cumulative decoded byte budget across otherwise individually valid pages',async()=>{
  vi.useFakeTimers();let count=0;const g=gate(),fetcher=vi.fn<typeof fetch>(async()=>Response.json({...page(1000-count++,1,`next-${count}`),padding:'x'.repeat(2_800_000)}));const pending=createPolymarketHandler({gate:g,fetcher,now:()=>NOW,isolatedForTests:true})(request());await vi.advanceTimersByTimeAsync(1000);const value=await (await pending).json() as PolymarketReply;expect(value.snapshot).toBeNull();expect(value.status.error_code).toBe('byte_budget');expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('does not start a new page after pacing crosses the page-start budget',async()=>{
  vi.useFakeTimers();let time=NOW;const fetcher=vi.fn<typeof fetch>(async()=>{time=NOW+COLLECTION_BUDGET_MS-100;return Response.json(page(100,100,'next'));});const pending=fetchPolymarket(fetcher,signal(),()=>time);await vi.advanceTimersByTimeAsync(0);time+=PAGE_INTERVAL_MS;await vi.advanceTimersByTimeAsync(PAGE_INTERVAL_MS);const result=await pending;expect(result.coverage.stopReason).toBe('time_budget');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('cancels a later-page pending stream and releases without publishing the first page',async()=>{
  vi.useFakeTimers();const controller=new AbortController(),cancel=vi.fn(),g=gate();const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(100,100,'next'))).mockImplementationOnce(async()=>new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}}));const pending=createPolymarketHandler({gate:g,fetcher,now:()=>NOW,isolatedForTests:true})(new Request(request().url,{signal:controller.signal}));await vi.advanceTimersByTimeAsync(PAGE_INTERVAL_MS+1);controller.abort();const result=await (await pending).json() as PolymarketReply;expect(result.snapshot).toBeNull();expect(result.status.error_code).toBe('source_aborted');expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure'}));
 });
 it('rejects coverage inconsistencies at the browser/cache boundary',()=>{const s=snapshot();for(const extra of [{rows:s.rows.map((r,i)=>i===1?{...r,id:'bad'}:r)},{rows:[...s.rows].reverse()},{total_market_count:500},{source_page_count:2},{source_page_sizes:[2]},{has_more:true},{stop_reason:'page_limit',has_more:true},{sample_limit:1000}])expect(snapshotSchema.safeParse({...s,...extra}).success).toBe(false);});
 it('selects a deterministic source tag regardless of tag order, while retaining all tags',()=>{const tags=[{slug:'z',label:'Zed'},{slug:'a',label:'Alpha'}];const a=parsePolymarket([market('1',{tags})],ISO,ISO),b=parsePolymarket([market('1',{tags:[...tags].reverse()})],ISO,ISO);expect(a.rows).toEqual(b.rows);expect(a.rows[0].category).toBe('Alpha');expect(a.rows[0].tags).toHaveLength(2);});
});
