import {afterEach,describe,expect,it,vi} from 'vitest';
import {CFTC_URL,parseCftc} from '../lib/futures/adapter';
import {createCftcHandler,type CftcGate} from '../lib/futures/handler';
import {REFRESH_MS,MAX_CACHE_AGE_MS,DAY_MS,net,replySchema,visibleSnapshot,type CftcReply} from '../lib/futures/model';
import {fixture,NOW,ISO,reply} from './cftc-fixture';
function gate():CftcGate{return {inspect:vi.fn(async()=>({state:'idle' as const,retryAt:0,snapshot:null})),acquire:vi.fn(async()=>({token:'synthetic-lease'})),release:vi.fn(async()=>{})};}
const request=(mode='snapshot')=>new Request(`https://test.invalid/api/v1/futures/cftc/${mode}`);
const response=(value:unknown=fixture(),status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
function setup(){let time=NOW;const g=gate(),fetcher=vi.fn<typeof fetch>(async()=>response()),handler=createCftcHandler({gate:g,fetcher,now:()=>time,isolatedForTests:true});return {g,fetcher,handler,advance:(ms:number)=>{time+=ms;}};}
const body=async(r:Response)=>await r.json() as CftcReply;
afterEach(()=>vi.useRealTimers());
describe('CFTC exact futures contracts and position semantics',()=>{
 it('selects actual latest/prior observations and never derives money flow or release dates',()=>{const s=parseCftc(fixture().reverse(),ISO,ISO);expect(s.rows).toHaveLength(4);expect(s.rows[0].current.date).toBe('2026-10-27');expect(s.rows[0].previous.date).toBe('2026-10-20');expect(s.unit).toBe('contracts');expect(s.net_capital_flow).toBeNull();expect(s.source_released_at).toBeNull();expect(s.report_type).toBe('futures_only');expect(net(s.rows[0].current)).toBe(100);expect(net(s.rows[0].current,'commercial')).toBe(-100);expect(net(s.rows[0].current)-net(s.rows[0].previous)).toBe(10);});
 it('uses the fixed official no-account dataset and bounded selected fields',()=>{const u=new URL(CFTC_URL);expect(u.origin).toBe('https://publicreporting.cftc.gov');expect(u.pathname).toBe('/resource/6dca-aqww.json');expect(u.searchParams.get('$limit')).toBe('16');expect(u.searchParams.get('$where')).toContain("'099741'");expect(u.searchParams.get('$select')).toContain('noncomm_postions_spread_all');expect(u.searchParams.has('$$app_token')).toBe(false);});
 it.each(['','-1','1.5','1e3','01','NaN','Infinity',null,100])('rejects noninteger or untyped contract counts %s',value=>{const f=fixture();Object.assign(f[0],{open_interest_all:value});expect(()=>parseCftc(f,ISO,ISO)).toThrow('invalid_contract_count');});
 it.each(['futonly_or_combined','contract_units','market_and_exchange_names','cftc_contract_market_code'])('rejects changed contract identity or type %s',key=>{const f=fixture();Object.assign(f[0],{[key]:'unknown'});expect(()=>parseCftc(f,ISO,ISO)).toThrow('unexpected_contract');});
 it('rejects both-side imbalance, zero OI and counts exceeding the bound',()=>{for(const patch of [{noncomm_positions_short_all:'201'},{nonrept_positions_long_all:'201'},{open_interest_all:'0'},{open_interest_all:'1000000001'}]){const f=fixture();Object.assign(f[0],patch);expect(()=>parseCftc(f,ISO,ISO)).toThrow('invalid_position_balance');}});
 it('rejects missing, duplicate and extra rows without replacing them with zero',()=>{const f=fixture();expect(()=>parseCftc(f.slice(1),ISO,ISO)).toThrow();expect(()=>parseCftc([...f,f[0]],ISO,ISO)).toThrow('duplicate_report');expect(()=>parseCftc([...f,...f,...f],ISO,ISO)).toThrow();});
 it.each(['2026-02-30T00:00:00.000','2026-11-10T00:00:00.000','not-a-date','2026-10-27T01:00:00.000'])('rejects invalid or future report dates %s',date=>{const f=fixture();f[0].report_date_as_yyyy_mm_dd=date;expect(()=>parseCftc(f,ISO,ISO)).toThrow();});
 it('rejects mixed newest report dates, reversed acquisition clocks and inconsistent snapshots',()=>{const f=fixture();f[0].report_date_as_yyyy_mm_dd='2026-10-28T00:00:00.000';expect(()=>parseCftc(f,ISO,ISO)).toThrow('invalid_snapshot');expect(()=>parseCftc(fixture(),ISO,'2026-11-04T00:00:00Z')).toThrow();for(const mutate of [(v:CftcReply)=>{v.snapshot!.rows[1]=v.snapshot!.rows[0]},(v:CftcReply)=>{v.status.state='denied'},(v:CftcReply)=>{v.snapshot!.rows[0].current.open_interest++},(v:CftcReply)=>{v.snapshot!.rows[0].contract_units='USD'},(v:CftcReply)=>{v.status.fetched_at=null}]){const v=reply();mutate(v);expect(replySchema.safeParse(v).success).toBe(false);}});
 it('supports changed report frequency without fabricating a weekly interval',()=>{const f=fixture();for(const r of f)if(r.report_date_as_yyyy_mm_dd.startsWith('2026-10-20'))r.report_date_as_yyyy_mm_dd='2026-10-25T00:00:00.000';expect(parseCftc(f,ISO,ISO).rows[0].previous.date).toBe('2026-10-25');});
 it('independently expires client cache and old report periods',()=>{const v=reply();expect(visibleSnapshot(v,NOW-1)).toBeNull();expect(visibleSnapshot(v,NOW+MAX_CACHE_AGE_MS+1)).toBeNull();expect(visibleSnapshot(v,NOW+1)).not.toBeNull();v.snapshot!.fetched_at='2026-12-10T00:00:00Z';expect(visibleSnapshot(v,Date.parse(v.snapshot!.fetched_at))).toBeNull();});
});
describe('bounded official acquisition',()=>{
 it('uses one unauthenticated fixed GET, one-hour caching and no-store replies',async()=>{const t=setup(),r=await t.handler(request());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect((await body(r)).status.state).toBe('available');expect(t.fetcher).toHaveBeenCalledWith(CFTC_URL,expect.objectContaining({method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',headers:{Accept:'application/json'}}));await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);t.advance(REFRESH_MS);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(2);});
 it('status and rejected routes never collect data',async()=>{const t=setup();await t.handler(request('status'));expect(t.fetcher).not.toHaveBeenCalled();expect(t.g.acquire).not.toHaveBeenCalled();expect((await t.handler(new Request(request().url+'?code=OTHER'))).status).toBe(400);expect((await t.handler(new Request(request().url,{method:'POST'}))).status).toBe(405);expect(t.g.inspect).toHaveBeenCalledTimes(1);});
 it('serves a validated shared report to a cold handler without another acquisition',async()=>{const t=setup();vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:NOW+REFRESH_MS,snapshot:reply().snapshot});const r=await body(await t.handler(request()));expect(r.snapshot).toEqual(reply().snapshot);expect(r.status.state).toBe('available');expect(t.fetcher).not.toHaveBeenCalled();expect(t.g.acquire).not.toHaveBeenCalled();});
 it('does not escalate source backoff just because the shared gate is busy',async()=>{const t=setup();vi.mocked(t.g.inspect).mockResolvedValue({state:'busy',retryAt:0,snapshot:null});for(let i=0;i<4;i++)await t.handler(request());expect(t.g.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:null});expect((await t.handler(request())).status).toBe(200);expect(t.fetcher).toHaveBeenCalledTimes(1);});
 it('does not expose arbitrary upstream exception codes',async()=>{const t=setup();t.fetcher.mockRejectedValue(Object.assign(new Error('private'),{code:'private_transport_detail'}));expect((await body(await t.handler(request()))).status.error_code).toBe('source_unavailable');});
 it('coalesces repeated simultaneous refreshes',async()=>{const t=setup();let resolve:(r:Response)=>void=()=>{};t.fetcher.mockImplementation(()=>new Promise(r=>{resolve=r}));const a=t.handler(request()),b=t.handler(request());await vi.waitFor(()=>expect(t.fetcher).toHaveBeenCalledTimes(1));resolve(response());expect((await a).status).toBe(200);expect((await b).status).toBe(200);});
 it('retains old validated report as stale only for 24h after temporary 5xx and honors Retry-After',async()=>{const t=setup();await t.handler(request());t.advance(REFRESH_MS+1);t.fetcher.mockImplementation(async()=>response({},503,{'retry-after':'172800'}));const r=await body(await t.handler(request()));expect(r.status.state).toBe('stale');expect(r.snapshot?.fetched_at).toBe(ISO);expect(t.g.release).toHaveBeenLastCalledWith('synthetic-lease',{kind:'temporary_failure',retryAfterMs:172800000});t.advance(MAX_CACHE_AGE_MS);expect((await body(await t.handler(request()))).snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(2);});
 it('marks lagged report stale independently of a fresh fetch and hides severely old reports',async()=>{const t=setup();t.advance(2*DAY_MS);expect((await body(await t.handler(request()))).status.state).toBe('stale');t.advance(30*DAY_MS);const r=await body(await t.handler(request()));expect(r.snapshot).toBeNull();expect(r.status.state).toBe('unavailable');});
 it.each([401,403,407,429,451,302])('permanently stops and clears old data after HTTP %s',async status=>{const t=setup();await t.handler(request());t.advance(REFRESH_MS);t.fetcher.mockImplementation(async()=>new Response(null,{status}));const r=await body(await t.handler(request()));expect(r.status.state).toBe('denied');expect(r.snapshot).toBeNull();expect(t.g.release).toHaveBeenLastCalledWith('synthetic-lease',expect.objectContaining({kind:'denied'}));t.advance(3*DAY_MS);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(2);});
 it.each(['text/html','application/json'])('stops on a challenge body labeled %s',async contentType=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response('<html>Challenge</html>',{headers:{'content-type':contentType}}));expect((await body(await t.handler(request()))).status.state).toBe('denied');});
 it('honors persistent denial while own cache is fresh and fails closed on missing gate',async()=>{const t=setup();await t.handler(request());vi.mocked(t.g.inspect).mockResolvedValue({state:'blocked',retryAt:0,snapshot:null});expect((await body(await t.handler(request()))).snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(1);const u=setup();vi.mocked(u.g.inspect).mockRejectedValue(new Error());expect((await u.handler(request())).status).toBe(503);expect(u.fetcher).not.toHaveBeenCalled();});
 it('fails closed after uncertain release without retrying the write',async()=>{const t=setup();vi.mocked(t.g.release).mockRejectedValue(new Error());const r=await body(await t.handler(request()));expect(r.status.state).toBe('denied');expect(r.status.error_code).toBe('source_gate_outcome_unconfirmed');expect(r.snapshot).toBeNull();expect(t.g.release).toHaveBeenCalledTimes(1);});
 it.each(['[{"x":1,"x":2}]','x'.repeat(65537)])('rejects duplicate-key and oversized payloads',async data=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response(data,{headers:{'content-type':'application/json'}}));expect((await body(await t.handler(request()))).snapshot).toBeNull();});
 it('bounds a hung acquisition and does not bypass its uncertain outcome',async()=>{vi.useFakeTimers();const t=setup();vi.mocked(t.g.acquire).mockImplementation(()=>new Promise(()=>{}));const p=t.handler(request());await vi.advanceTimersByTimeAsync(15_001);expect((await body(await p)).status.error_code).toBe('source_gate_outcome_unconfirmed');expect(t.fetcher).not.toHaveBeenCalled();});
 it('cancels an idle body at the deadline',async()=>{vi.useFakeTimers();const t=setup();t.fetcher.mockImplementation(async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}));const p=t.handler(request());await vi.advanceTimersByTimeAsync(15_001);expect((await body(await p)).status.error_code).toBe('timeout');});
});

describe('request-owned acquisition lifetime',()=>{
 it.each(['missing','throws'])('fails closed before admission when lifetime registration %s',async mode=>{
  const g=gate(),fetcher=vi.fn<typeof fetch>(async()=>response());
  const handler=createCftcHandler({gate:g,fetcher,now:()=>NOW,...(mode==='throws'?{waitUntil:()=>{throw new Error('unavailable');}}:{})});
  const result=await body(await handler(request()));
  expect(result.status.error_code).toBe('runtime_lifetime_unverified');
  expect(result.snapshot).toBeNull();expect(g.acquire).not.toHaveBeenCalled();expect(g.release).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('registers the complete lifetime before admission and retains canceled-source release',async()=>{
  const g=gate(),events:string[]=[];let retained:Promise<unknown>|undefined,finishRelease:()=>void=()=>{};
  const controller=new AbortController();
  vi.mocked(g.acquire).mockImplementation(async()=>{events.push('acquire');return {token:'synthetic-lease'};});
  vi.mocked(g.release).mockImplementation(()=>new Promise<void>(resolve=>{finishRelease=resolve;}));
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
  const handler=createCftcHandler({gate:g,fetcher,now:()=>NOW,waitUntil:promise=>{events.push('retained');retained=promise;}});
  const pending=handler(new Request(request(),{signal:controller.signal}));
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  expect(events).toEqual(['retained','acquire']);controller.abort();
  await vi.waitFor(()=>expect(g.release).toHaveBeenCalledTimes(1));
  expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure'}));
  let settled=false;void retained!.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  finishRelease();const result=await body(await pending);await retained;
  expect(result.snapshot).toBeNull();expect(result.status.error_code).toBe('source_aborted');expect(settled).toBe(true);
 });
 it('does not admit an already canceled request',async()=>{
  const t=setup(),controller=new AbortController();controller.abort();
  const result=await body(await t.handler(new Request(request(),{signal:controller.signal})));
  expect(result.status.error_code).toBe('source_aborted');expect(t.g.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
 it('retains a delayed admission through its owned late-abort cleanup after the response deadline',async()=>{
  vi.useFakeTimers();const g=gate();let finishAdmission:()=>void=()=>{},retained:Promise<unknown>|undefined;
  vi.mocked(g.acquire).mockImplementation(async signal=>{
   await new Promise<void>(resolve=>{finishAdmission=resolve;});
   // D1CftcGate owns this exact cleanup when its committed grant arrives late.
   if(signal?.aborted){await g.release('late-owned-lease',{kind:'temporary_failure'});throw {code:'source_aborted'};}
   return {token:'late-owned-lease'};
  });
  const fetcher=vi.fn<typeof fetch>(async()=>response());
  const handler=createCftcHandler({gate:g,fetcher,now:()=>NOW,waitUntil:promise=>{retained=promise;}});
  const pending=handler(request());await vi.advanceTimersByTimeAsync(15_001);
  const result=await body(await pending);expect(result.status.error_code).toBe('source_gate_outcome_unconfirmed');
  let settled=false;void retained!.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  finishAdmission();await retained;expect(settled).toBe(true);
  expect(g.release).toHaveBeenCalledExactlyOnceWith('late-owned-lease',{kind:'temporary_failure'});expect(fetcher).not.toHaveBeenCalled();
  await handler(request());expect(g.acquire).toHaveBeenCalledTimes(1);
 });
 it('retains an uncertain success release without publishing or retrying that write',async()=>{
  vi.useFakeTimers();const g=gate();let finishRelease:()=>void=()=>{},retained:Promise<unknown>|undefined;
  vi.mocked(g.release).mockImplementation(()=>new Promise<void>(resolve=>{finishRelease=resolve;}));
  const handler=createCftcHandler({gate:g,fetcher:async()=>response(),now:()=>NOW,waitUntil:promise=>{retained=promise;}});
  const pending=handler(request());await vi.advanceTimersByTimeAsync(15_001);
  const result=await body(await pending);expect(result.status.error_code).toBe('source_gate_outcome_unconfirmed');expect(result.snapshot).toBeNull();
  let settled=false;void retained!.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  finishRelease();await retained;expect(settled).toBe(true);expect(g.release).toHaveBeenCalledTimes(1);
 });
 it('does not downgrade an observed source denial when the request also aborts',async()=>{
  const g=gate(),controller=new AbortController();let retained:Promise<unknown>|undefined;
  const handler=createCftcHandler({gate:g,fetcher:async()=>{controller.abort();return response({},403);},now:()=>NOW,waitUntil:promise=>{retained=promise;}});
  const result=await body(await handler(new Request(request(),{signal:controller.signal})));await retained;
  expect(result.status.state).toBe('denied');expect(result.snapshot).toBeNull();expect(g.release).toHaveBeenCalledWith('synthetic-lease',expect.objectContaining({kind:'denied'}));
 });
});
