import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {createReportHandler} from '../lib/reports/handler';
import {D1ReportGate} from '../lib/reports/source-gate';
import type {ReportDefinition,ReportGate,ReportReply} from '../lib/reports/types';
import type {GateD1} from '../lib/ashare/source-gate';
const NOW=Date.parse('2026-11-05T08:00:00Z'),HOUR=3_600_000,DAY=24*HOUR;
const schema=z.object({report_date:z.string(),acquisition_started_at:z.string(),fetched_at:z.string(),amount:z.number().int()}).strict();
type Snapshot=z.infer<typeof schema>;
const snapshot=()=>({report_date:'2026-11-05',acquisition_started_at:new Date(NOW).toISOString(),fetched_at:new Date(NOW).toISOString(),amount:10});
const definition:ReportDefinition<Snapshot>={url:'https://official.invalid/report',parse:(raw,started,fetched)=>schema.parse({...schema.parse(raw),acquisition_started_at:started,fetched_at:fetched}),validate:raw=>schema.parse(raw),refreshMs:HOUR,maxCacheAgeMs:DAY,maxReportAgeDays:14,staleReportDays:4,reportAge:(s,now)=>(now-Date.parse(s.report_date))/DAY,maxBytes:1000,deadlineMs:100};
function setup(){let now=NOW;const gate:ReportGate<Snapshot>={inspect:vi.fn(async()=>({state:'idle' as const,retryAt:0,snapshot:null})),acquire:vi.fn(async()=>({token:'test'})),release:vi.fn(async()=>{})};const fetcher=vi.fn<typeof fetch>(async()=>Response.json(snapshot()));const handler=createReportHandler(definition,{gate,fetcher,now:()=>now,isolatedForTests:true});return {gate,fetcher,handler,advance:(ms:number)=>{now+=ms;}};}
const request=(mode='snapshot')=>new Request('https://test.invalid/api/'+mode);
const read=async(response:Response)=>response.json() as Promise<ReportReply<Snapshot>>;
afterEach(()=>vi.useRealTimers());
describe('reusable official JSON report runtime',()=>{
 it('fetches once hourly using no credentials, redirects or cached requests',async()=>{const t=setup();const reply=await read(await t.handler(request()));expect(reply.status.state).toBe('available');expect(reply.status.report_age_days).toBeCloseTo(1/3);expect(reply.status.cache_age_ms).toBe(0);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.fetcher).toHaveBeenCalledWith(definition.url,expect.objectContaining({redirect:'manual',credentials:'omit',cache:'no-store'}));});
 it('never acquires for status, queries or non-GET',async()=>{const t=setup();await t.handler(request('status'));expect((await t.handler(new Request(request().url+'?x=1'))).status).toBe(400);expect((await t.handler(new Request(request().url,{method:'POST'}))).status).toBe(405);expect(t.gate.acquire).not.toHaveBeenCalled();});
 it.each([401,403,407,429,451,302])('durably stops HTTP %s with no alternate request',async status=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response(null,{status}));expect((await read(await t.handler(request()))).status.state).toBe('denied');t.advance(30*DAY);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.gate.release).toHaveBeenCalledWith('test',expect.objectContaining({kind:'denied'}));});
 it.each(['text/html','application/json','application/xhtml+xml'])('stops HTML challenge labeled %s',async type=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response('<html>challenge</html>',{headers:{'content-type':type}}));expect((await read(await t.handler(request()))).status.state).toBe('denied');});
 it.each(['{"x":1,"x":2}','x'.repeat(1001),'{"report_date":"2026-11-05"}'])('rejects malformed, oversized or incomplete JSON',async raw=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response(raw,{headers:{'content-type':'application/json'}}));expect((await read(await t.handler(request()))).snapshot).toBeNull();await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);});
 it('bounds declared length and hung fetch even when fetch ignores abort',async()=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'1001'}}));expect((await read(await t.handler(request()))).status.error_code).toBe('byte_budget');vi.useFakeTimers();const u=setup();u.fetcher.mockImplementation(()=>new Promise(()=>{}));const pending=u.handler(request());await vi.advanceTimersByTimeAsync(101);expect((await read(await pending)).status.error_code).toBe('timeout');expect(u.gate.release).toHaveBeenCalledTimes(1);});
 it('bounds a hanging stream',async()=>{vi.useFakeTimers();const t=setup();t.fetcher.mockImplementation(async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}));const pending=t.handler(request());await vi.advanceTimersByTimeAsync(101);expect((await read(await pending)).snapshot).toBeNull();});
 it('keeps old evidence stale on transient failure, honors retry-after and expires cache',async()=>{const t=setup();await t.handler(request());t.advance(HOUR+1);t.fetcher.mockImplementation(async()=>new Response(null,{status:503,headers:{'retry-after':'172800'}}));const r=await read(await t.handler(request()));expect(r.status.state).toBe('stale');expect(r.snapshot!.fetched_at).toBe(snapshot().fetched_at);t.advance(DAY);expect((await read(await t.handler(request()))).snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(2);});
 it('does not present an old report as fresh after successful fetch',async()=>{const t=setup();t.fetcher.mockImplementation(async()=>Response.json({...snapshot(),report_date:'2026-10-30'}));expect((await read(await t.handler(request()))).status.state).toBe('stale');});
 it('rejects report regression and invalid shared cache',async()=>{const t=setup();await t.handler(request());t.advance(HOUR+1);t.fetcher.mockImplementation(async()=>Response.json({...snapshot(),report_date:'2026-11-04'}));expect((await read(await t.handler(request()))).status.error_code).toBe('report_date_regression');vi.mocked(t.gate.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:{...snapshot(),fetched_at:'2099-01-01',amount:undefined} as unknown as Snapshot});expect((await t.handler(request())).status).toBe(503);});
 it.each(['blocked','busy','missing'] as const)('withholds warm cached data if provider becomes %s',async state=>{const t=setup();await t.handler(request());if(state==='missing')vi.mocked(t.gate.inspect).mockRejectedValue(Error());else vi.mocked(t.gate.inspect).mockResolvedValue({state,snapshot:null,retryAt:0,providerUnavailable:state==='busy'});const r=await read(await t.handler(request()));expect(r.snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(1);expect(r.status.state).toBe(state==='blocked'?'denied':'unavailable');});
 it('fails closed without verified worker lifetime',async()=>{const t=setup();const h=createReportHandler(definition,{gate:t.gate,fetcher:t.fetcher});expect((await read(await h(request()))).status.error_code).toBe('runtime_lifetime_unverified');expect(t.gate.acquire).not.toHaveBeenCalled();});
 it('retains a late acquire settlement and never retries an uncertain release',async()=>{vi.useFakeTimers();const t=setup();let resolve!:(v:{token:string})=>void;vi.mocked(t.gate.acquire).mockImplementation(()=>new Promise(r=>resolve=r));let lifetime!:Promise<unknown>;const h=createReportHandler(definition,{gate:t.gate,fetcher:t.fetcher,waitUntil:p=>{lifetime=p;}});const work=h(request());await vi.advanceTimersByTimeAsync(101);expect((await read(await work)).status.error_code).toBe('source_gate_outcome_unconfirmed');let settled=false;void lifetime.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);resolve({token:'late'});await lifetime;expect(settled).toBe(true);expect(t.fetcher).not.toHaveBeenCalled();});
});
function database(row:Record<string,unknown>,changes=0){return {prepare:vi.fn(()=>({bind:vi.fn(()=>({run:vi.fn(async()=>({success:true,results:[{provider_not_before_ms:0,now_ms:NOW,...row}],meta:{changes}}))}))}))} as unknown as GateD1;}
const sql={acquire:'ACQUIRE',inspect:'INSPECT',finish:'FINISH'};
describe('generic D1 gate with authoritative provider prerequisite',()=>{
 it.each(['blocked','busy',null,'unknown'])('blocks cache/acquisition for provider state %s',async provider_status=>{const g=new D1ReportGate(database({status:'idle',not_before_ms:0,payload:JSON.stringify(snapshot()),provider_status}),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});if(provider_status==='blocked'||provider_status==='busy')expect((await g.inspect()).snapshot).toBeNull();else await expect(g.inspect()).rejects.toThrow('source_gate_unavailable');await expect(g.acquire()).rejects.toThrow(provider_status==='blocked'?'source_denied':provider_status==='busy'?'source_busy':'source_gate_unavailable');});
 it('validates cached schema and refuses corrupt shared payload',async()=>{const g=new D1ReportGate(database({status:'idle',not_before_ms:0,payload:'{"amount":1}',provider_status:'idle'}),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});await expect(g.inspect()).rejects.toThrow('source_gate_unavailable');});
 it('preserves denied state without parsing cached content',async()=>{const g=new D1ReportGate(database({status:'blocked',not_before_ms:0,payload:'broken',provider_status:'idle'}),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});expect((await g.inspect()).state).toBe('blocked');});
});

describe('provider cooldown and denied priority',()=>{
 it.each([null,undefined,-1,1.5,'0',Number.MAX_SAFE_INTEGER+1])('fails closed for invalid provider deadline %s',async provider_not_before_ms=>{
  const g=new D1ReportGate(database({status:'idle',not_before_ms:0,payload:null,provider_status:'idle',provider_not_before_ms}),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});
  await expect(g.inspect()).rejects.toThrow('source_gate_unavailable');await expect(g.acquire()).rejects.toThrow('source_gate_unavailable');
 });
 it('defers source acquisition to the authoritative provider cooldown',async()=>{
  const g=new D1ReportGate(database({status:'idle',not_before_ms:0,payload:JSON.stringify(snapshot()),provider_status:'idle',provider_not_before_ms:NOW+HOUR}),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});
  expect(await g.inspect()).toMatchObject({providerUnavailable:true,providerError:'source_cooldown',retryAt:NOW+HOUR,snapshot:null});
  await expect(g.acquire()).rejects.toThrow('source_cooldown');const fetcher=vi.fn<typeof fetch>();const h=createReportHandler(definition,{gate:g,fetcher,now:()=>NOW,isolatedForTests:true});
  const reply=await read(await h(request()));expect(reply.status.error_code).toBe('source_cooldown');expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['busy',null,'unknown'])('summary denied wins over provider %s',async provider_status=>{
  const g=new D1ReportGate(database({status:'blocked',not_before_ms:0,payload:'broken',provider_status,provider_not_before_ms:null}),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});
  expect((await g.inspect()).state).toBe('blocked');await expect(g.acquire()).rejects.toThrow('source_denied');
 });
 it('sticky runtime denied wins over later busy or failed inspection',async()=>{
  const t=setup();t.fetcher.mockImplementation(async()=>new Response(null,{status:403}));await t.handler(request());
  vi.mocked(t.gate.inspect).mockResolvedValue({state:'busy',retryAt:0,snapshot:null,providerUnavailable:true});expect((await read(await t.handler(request()))).status.state).toBe('denied');
  vi.mocked(t.gate.inspect).mockRejectedValue(Error());expect((await read(await t.handler(request()))).status.state).toBe('denied');expect(t.fetcher).toHaveBeenCalledTimes(1);
 });
});

describe('provider transitions around admission and publication',()=>{
 it('rechecks delayed admission before fetching and settles the owned lease',async()=>{
  const t=setup();vi.mocked(t.gate.acquire).mockImplementation(async()=>{vi.mocked(t.gate.inspect).mockResolvedValue({state:'blocked',retryAt:0,snapshot:null});return {token:'test'};});
  const result=await read(await t.handler(request()));expect(result.status.state).toBe('denied');expect(result.snapshot).toBeNull();expect(t.fetcher).not.toHaveBeenCalled();expect(t.gate.release).toHaveBeenCalledTimes(1);
 });
 it.each(['source_denied','source_busy','source_cooldown','source_gate_unavailable'] as const)('does not install rejected publication %s or retry settled release',async error_code=>{
  const t=setup();vi.mocked(t.gate.release).mockResolvedValue({published:false,error_code});const result=await read(await t.handler(request()));
  expect(result.snapshot).toBeNull();expect(result.status.state).toBe(error_code==='source_denied'?'denied':'unavailable');expect(t.gate.release).toHaveBeenCalledTimes(1);
 });
 it('suppresses a confirmed candidate if final authoritative inspection fails',async()=>{
  const t=setup();vi.mocked(t.gate.release).mockImplementation(async()=>{vi.mocked(t.gate.inspect).mockRejectedValue(Error());return {published:true};});
  const result=await read(await t.handler(request()));expect(result.snapshot).toBeNull();expect(result.status.state).toBe('unavailable');expect(t.gate.release).toHaveBeenCalledTimes(1);
 });
 it.each(['blocked','busy','missing','cooldown','invalid'])('D1 confirmed release reports rejected publication for provider %s without throwing uncertainty',async state=>{
  const g=new D1ReportGate(database({status:state==='blocked'?'blocked':'idle',provider_status:state==='missing'?null:state==='cooldown'||state==='invalid'?'idle':state,provider_not_before_ms:state==='invalid'?null:state==='cooldown'?NOW+HOUR:0},1),{sql,validate:r=>schema.parse(r),refreshMs:HOUR,providerRequired:true});
  expect(await g.release('owned',{kind:'success',snapshot:snapshot()})).toEqual({published:false,error_code:state==='blocked'?'source_denied':state==='busy'?'source_busy':state==='cooldown'?'source_cooldown':'source_gate_unavailable'});
 });
});
