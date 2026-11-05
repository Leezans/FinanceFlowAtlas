import {parseTicker as parseKrakenTicker,catalog} from './kraken-fixture';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createKrakenHandler,KRAKEN_URL,KRAKEN_PAIRS_URL,REFRESH_MS,MAX_CACHE_AGE_MS,type KrakenGate,type KrakenReply,type KrakenStatus} from '../lib/crypto/kraken';
export const ticker=()=>({error:[],result:{XXBTZUSD:{c:['12.34567890','0.01'],v:['999','3.12500000'],p:['999','12.10000000'],t:[999,8]},XETHZUSD:{c:['2.50000000','1'],v:['999','0.00000000'],p:['999','2.40000000'],t:[999,0]}}});
const start=Date.parse('2026-11-05T03:00:00Z'),iso=new Date(start).toISOString();
function gate():KrakenGate{return {inspect:vi.fn(async()=> 'idle' as const),acquire:vi.fn(async()=>({token:'synthetic-lease'})),release:vi.fn(async()=>{})};}
function response(data:unknown=ticker(),status=200,headers:Record<string,string>={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});}
async function readReply(r:Response):Promise<KrakenReply>{return await r.json() as KrakenReply;}
const request=(mode='snapshot')=>new Request(`https://test.invalid/api/v1/crypto/kraken/${mode}`);
function setup(options:Partial<Parameters<typeof createKrakenHandler>[0]>={}){let time=start;const g=gate(),fetcher=vi.fn<typeof fetch>(async()=>response()),catalogFetcher=vi.fn(async()=>response(catalog())),handler=createKrakenHandler({gate:g,now:()=>time,isolatedForTests:true,...options,fetcher:(url,init)=>url===KRAKEN_PAIRS_URL?catalogFetcher():(options.fetcher??fetcher)(url,init)});return {g,fetcher,catalogFetcher,handler,advance:(ms:number)=>{time+=ms;}};}
afterEach(()=>vi.useRealTimers());
describe('Kraken single-venue spot semantics',()=>{
 it('keeps exact decimal units, rolling windows and unknown fields separate',()=>{const result=parseKrakenTicker(ticker(),iso,iso);expect(result.rows[0]).toEqual({source_pair:'XXBTZUSD',pair:'BTC/USD',base:'BTC',quote:'USD',last_price_usd:'12.34567890',volume_base_24h:'3.12500000',vwap_usd_24h:'12.10000000',trades_24h:8,net_capital_flow:null,open_interest:null});expect(result.rows[1].volume_base_24h).toBe('0.00000000');expect(result.source_observed_at).toBeNull();expect(result.delay_status).toBe('not_provided');expect(result.coverage).toBe('online_usd_spot_pairs_one_venue');});
 it.each(['-1','NaN','Infinity','1e3','',12,null])('rejects invalid or non-string prices %s',value=>{const raw=ticker();(raw.result.XXBTZUSD.c as unknown[])[0]=value;expect(parseKrakenTicker(raw,iso,iso).missing).toEqual([{pair:'BTC/USD',reason:'invalid_ticker'}]);});
 it('rejects zero price, fractional trades, missing pairs and extra markets',()=>{const raw=ticker();raw.result.XXBTZUSD.c[0]='0.000';expect(parseKrakenTicker(raw,iso,iso).missing).toHaveLength(1);raw.result.XXBTZUSD.c[0]='1';raw.result.XXBTZUSD.t[1]=1.1;expect(parseKrakenTicker(raw,iso,iso).missing).toHaveLength(1);const missing=ticker();delete (missing.result as Record<string,unknown>).XETHZUSD;expect(parseKrakenTicker(missing,iso,iso).missing).toEqual([{pair:'ETH/USD',reason:'missing_ticker'}]);expect(parseKrakenTicker({...ticker(),result:{...ticker().result,UNKNOWN:{}}},iso,iso).rows).toHaveLength(2);});
 it('rejects malformed tuple lengths, missing errors and reversed clocks',()=>{const raw=ticker();raw.result.XXBTZUSD.v=['1'];expect(parseKrakenTicker(raw,iso,iso).missing).toHaveLength(1);expect(()=>parseKrakenTicker({result:ticker().result},iso,iso)).toThrow('invalid_schema');expect(()=>parseKrakenTicker(ticker(),iso,'2025-01-01T00:00:00Z')).toThrow('invalid_clock');});
});
describe('bounded acquisition and ephemeral cache',()=>{
 it('fetches only the fixed unauthenticated URL and caches for one minute',async()=>{const t=setup();const r=await t.handler(request());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect((await readReply(r)).status.state).toBe('available');expect(t.fetcher).toHaveBeenCalledWith(KRAKEN_URL,expect.objectContaining({method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',headers:{Accept:'application/json'}}));await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);t.advance(REFRESH_MS);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(2);});
 it('status never acquires data, and invalid method/query never touches storage',async()=>{const t=setup();expect((await (await t.handler(request('status'))).json() as KrakenStatus).state).toBe('unavailable');expect(t.fetcher).not.toHaveBeenCalled();expect(t.g.acquire).not.toHaveBeenCalled();expect((await t.handler(new Request(request().url+'?pair=OTHER'))).status).toBe(400);expect((await t.handler(new Request(request().url,{method:'POST'}))).status).toBe(405);expect(t.g.inspect).toHaveBeenCalledTimes(1);});
 it('coalesces simultaneous refreshes',async()=>{const t=setup();let resolve:(r:Response)=>void=()=>{};t.fetcher.mockImplementation(()=>new Promise(r=>{resolve=r;}));const a=t.handler(request()),b=t.handler(request());await vi.waitFor(()=>expect(t.fetcher).toHaveBeenCalledTimes(1),{timeout:3000});resolve(response());expect((await a).status).toBe(200);expect((await b).status).toBe(200);expect(t.g.acquire).toHaveBeenCalledTimes(1);});
 it('keeps last-good data stale on temporary failure, respects retry and expires it',async()=>{const t=setup();await t.handler(request());t.advance(REFRESH_MS+1);t.fetcher.mockImplementation(async()=>response({},503,{'retry-after':'1800'}));let result=await readReply(await t.handler(request())) as KrakenReply;expect(result.status.state).toBe('stale');expect(result.snapshot?.fetched_at).toBe(iso);expect(result.status.error_code).toBe('upstream_http');expect(t.g.release).toHaveBeenLastCalledWith('synthetic-lease',{kind:'temporary_failure',retryAfterMs:1_800_000});t.advance(REFRESH_MS);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(2);t.advance(MAX_CACHE_AGE_MS);const expired=await t.handler(request());expect(expired.status).toBe(503);result=await readReply(expired);expect(result.snapshot).toBeNull();expect(result.status.state).toBe('unavailable');});
 it.each([401,403,407,429,451,302])('stops permanently after HTTP %s, discards cached evidence',async code=>{const t=setup();await t.handler(request());t.advance(REFRESH_MS);t.fetcher.mockImplementation(async()=>new Response(null,{status:code}));const result=await readReply(await t.handler(request()));expect(result.status.state).toBe('denied');expect(result.snapshot).toBeNull();expect(t.g.release).toHaveBeenLastCalledWith('synthetic-lease',expect.objectContaining({kind:'denied'}));t.advance(10*MAX_CACHE_AGE_MS);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(2);});
 it.each([new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}}),new Response('<html>challenge</html>',{headers:{'content-type':'application/json'}}),response({error:['EAPI:Rate limit exceeded']})])('stops on challenge or API rate denial',async source=>{const t=setup();t.fetcher.mockImplementation(async()=>source);expect((await readReply(await t.handler(request()))).status.state).toBe('denied');expect(t.fetcher).toHaveBeenCalledTimes(1);});
 it('honors a denial reported by another isolate even during the fresh cache window',async()=>{const t=setup();await t.handler(request());vi.mocked(t.g.inspect).mockResolvedValue('blocked');const r=await readReply(await t.handler(request()));expect(r.status.state).toBe('denied');expect(r.snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(1);});
 it('fails closed on missing gate or uncertain release',async()=>{const t=setup();vi.mocked(t.g.inspect).mockRejectedValue(new Error('db unavailable'));expect((await t.handler(request())).status).toBe(503);expect(t.fetcher).not.toHaveBeenCalled();const u=setup();vi.mocked(u.g.release).mockRejectedValue(new Error());const result=await readReply(await u.handler(request()));expect(result.snapshot).toBeNull();expect(result.status.state).toBe('denied');expect(result.status.error_code).toBe('source_gate_outcome_unconfirmed');expect(u.g.release).toHaveBeenCalledTimes(1);});
 it.each(['{"error":[],"error":[],"result":{}}','[[]]', 'x'.repeat(8_388_609)])('rejects malformed, duplicate-key or oversized payload without publishing',async body=>{const t=setup();t.fetcher.mockImplementation(async()=>new Response(body,{headers:{'content-type':'application/json'}}));const result=await readReply(await t.handler(request()));expect(result.snapshot).toBeNull();expect(result.status.state).toBe('unavailable');});
 it('bounds unresolved gate acquisition without starting a source request',async()=>{vi.useFakeTimers();const t=setup();vi.mocked(t.g.acquire).mockImplementation(()=>new Promise(()=>{}));const pending=t.handler(request());await vi.advanceTimersByTimeAsync(12_001);const result=await readReply(await pending);expect(result.status.state).toBe('denied');expect(result.status.error_code).toBe('source_gate_outcome_unconfirmed');expect(t.fetcher).not.toHaveBeenCalled();});
 it('bounds unresolved gate inspection before acquisition',async()=>{vi.useFakeTimers();const t=setup();vi.mocked(t.g.inspect).mockImplementation(()=>new Promise(()=>{}));const pending=t.handler(request());await vi.advanceTimersByTimeAsync(2_001);expect((await pending).status).toBe(503);expect(t.g.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();});
 it('cancels an idle body at the deadline',async()=>{vi.useFakeTimers();const t=setup();t.fetcher.mockImplementation(async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}));const pending=t.handler(request());await vi.advanceTimersByTimeAsync(12_001);expect((await readReply(await pending)).status.error_code).toBe('timeout');expect(t.g.release).toHaveBeenLastCalledWith('synthetic-lease',expect.objectContaining({kind:'temporary_failure'}));});
});

describe('request lifetime retention',()=>{
 it('registers the complete lifecycle before gate acquisition',async()=>{
  const order:string[]=[],retained:Promise<unknown>[]=[];
  const g={...gate(),acquire:vi.fn(async()=>{order.push('acquire');return {token:'one'};}),release:vi.fn(async()=>{order.push('release');})};
  const t=setup({gate:g,fetcher:async()=>{order.push('fetch');return response();},waitUntil:work=>{order.push('retain');retained.push(work);}});
  expect((await t.handler(request())).status).toBe(200);await Promise.all(retained);
  expect(order).toEqual(['retain','acquire','fetch','release']);expect(retained).toHaveLength(1);
 });
 it.each(['missing','throws'])('fails closed when retention %s',async mode=>{
  const t=setup({isolatedForTests:false,...(mode==='throws'?{waitUntil:()=>{throw new Error('unavailable');}}:{})});
  expect(await readReply(await t.handler(request()))).toMatchObject({snapshot:null,status:{state:'unavailable',error_code:'runtime_lifetime_unverified'}});
  expect(t.g.acquire).not.toHaveBeenCalled();expect(t.g.release).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
 it('does not acquire for an already canceled request',async()=>{
  const t=setup(),controller=new AbortController();controller.abort();
  expect(await readReply(await t.handler(new Request(request(),{signal:controller.signal})))).toMatchObject({snapshot:null,status:{state:'unavailable',error_code:'aborted'}});
  expect(t.g.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
 it('retains independent cleanup after request cancellation and releases once',async()=>{
  const retained:Promise<unknown>[]=[],controller=new AbortController();let finish!:()=>void;
  const barrier=new Promise<void>(resolve=>{finish=resolve;}),t=setup({waitUntil:work=>retained.push(work)});
  vi.mocked(t.g.release).mockImplementation(()=>barrier);
  t.fetcher.mockImplementation(async(_url,init)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})));
  const result=t.handler(new Request(request(),{signal:controller.signal}));
  await vi.waitFor(()=>expect(t.fetcher).toHaveBeenCalledTimes(1),{timeout:3000});controller.abort();
  await vi.waitFor(()=>expect(t.g.release).toHaveBeenCalledWith('synthetic-lease',{kind:'temporary_failure',retryAfterMs:REFRESH_MS}));
  let settled=false;void retained[0].then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  finish();expect(await readReply(await result)).toMatchObject({snapshot:null,status:{state:'unavailable',error_code:'aborted'}});
  await Promise.all(retained);expect(settled).toBe(true);expect(t.g.release).toHaveBeenCalledTimes(1);
  await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);
 });
 it('does not interrupt a success release or publish after cancellation',async()=>{
  const retained:Promise<unknown>[]=[],controller=new AbortController();let finish!:()=>void;
  const barrier=new Promise<void>(resolve=>{finish=resolve;}),t=setup({waitUntil:work=>retained.push(work)});
  vi.mocked(t.g.release).mockImplementation(()=>barrier);
  const result=t.handler(new Request(request(),{signal:controller.signal}));
  await vi.waitFor(()=>expect(t.g.release).toHaveBeenCalledWith('synthetic-lease',{kind:'success'}),{timeout:3000});controller.abort();finish();
  expect(await readReply(await result)).toMatchObject({snapshot:null,status:{state:'unavailable',error_code:'aborted'}});
  await Promise.all(retained);expect(t.g.release).toHaveBeenCalledTimes(1);
 });
 it('cancels an idle body and preserves only the previous stale snapshot',async()=>{
  const retained:Promise<unknown>[]=[],controller=new AbortController(),t=setup({waitUntil:work=>retained.push(work)});
  await t.handler(request());t.advance(REFRESH_MS);const cancel=vi.fn();
  t.fetcher.mockImplementation(async()=>new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}}));
  const result=t.handler(new Request(request(),{signal:controller.signal}));await vi.waitFor(()=>expect(t.fetcher).toHaveBeenCalledTimes(2));controller.abort();
  expect(await readReply(await result)).toMatchObject({snapshot:{fetched_at:iso},status:{state:'stale',error_code:'aborted'}});
  await Promise.all(retained);expect(cancel).toHaveBeenCalledTimes(1);expect(t.g.release).toHaveBeenLastCalledWith('synthetic-lease',{kind:'temporary_failure',retryAfterMs:REFRESH_MS});
 });
 it('retains late acquisition cleanup without retrying or starting a source call',async()=>{
  const retained:Promise<unknown>[]=[],controller=new AbortController();let acquired!:()=>void;
  const barrier=new Promise<void>(resolve=>{acquired=resolve;}),t=setup({waitUntil:work=>retained.push(work)});
  vi.mocked(t.g.acquire).mockImplementation(async signal=>{
   await barrier;
   // D1KrakenGate cleans up its own late lease when its acquire confirms after
   // cancellation. Retain its actual promise, not only the bounded wait.
   if(signal?.aborted){await t.g.release('late-lease',{kind:'temporary_failure'});throw new Error('source_aborted');}
   return {token:'late-lease'};
  });
  const result=t.handler(new Request(request(),{signal:controller.signal}));await vi.waitFor(()=>expect(t.g.acquire).toHaveBeenCalledTimes(1));controller.abort();
  expect(await readReply(await result)).toMatchObject({snapshot:null,status:{state:'denied',error_code:'source_gate_outcome_unconfirmed'}});
  let settled=false;void retained[0].then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  acquired();await Promise.all(retained);expect(settled).toBe(true);expect(t.g.release).toHaveBeenCalledExactlyOnceWith('late-lease',{kind:'temporary_failure'});
  t.advance(MAX_CACHE_AGE_MS);await t.handler(request());expect(t.g.acquire).toHaveBeenCalledTimes(1);expect(t.fetcher).not.toHaveBeenCalled();
 });
 it('retains a late release even after the response fails closed at its deadline',async()=>{
  vi.useFakeTimers();const retained:Promise<unknown>[]=[];let released!:()=>void;
  const barrier=new Promise<void>(resolve=>{released=resolve;}),t=setup({waitUntil:work=>retained.push(work)});
  vi.mocked(t.g.release).mockImplementation(()=>barrier);const result=t.handler(request());await vi.advanceTimersByTimeAsync(2_001);
  expect(await readReply(await result)).toMatchObject({snapshot:null,status:{state:'denied',error_code:'source_gate_outcome_unconfirmed'}});
  let settled=false;void retained[0].then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  released();await Promise.all(retained);expect(settled).toBe(true);expect(t.g.release).toHaveBeenCalledTimes(1);
  t.advance(MAX_CACHE_AGE_MS);expect((await readReply(await t.handler(request()))).status.state).toBe('denied');expect(t.fetcher).toHaveBeenCalledTimes(1);
 });
 it('a canceled coalesced reader does not abort the originating acquisition',async()=>{
  const retained:Promise<unknown>[]=[],t=setup({waitUntil:work=>retained.push(work)});let respond!:(value:Response)=>void;
  t.fetcher.mockImplementation(()=>new Promise(resolve=>{respond=resolve;}));
  const first=t.handler(request());await vi.waitFor(()=>expect(t.fetcher).toHaveBeenCalledTimes(1),{timeout:3000});
  const controller=new AbortController(),second=t.handler(new Request(request(),{signal:controller.signal}));controller.abort();respond(response());
  expect((await first).status).toBe(200);expect((await second).status).toBe(200);await Promise.all(retained);expect(retained).toHaveLength(2);expect(t.g.release).toHaveBeenCalledTimes(1);
 });
 it('persists an observed denial despite a rejecting or hung body cancellation',async()=>{
  for(const cancel of [()=>Promise.reject(new Error('cancel failed')),()=>new Promise<void>(()=>{})]){
   const t=setup();t.fetcher.mockImplementation(async()=>new Response(new ReadableStream({cancel}),{status:403}));
   expect((await readReply(await t.handler(request()))).status.state).toBe('denied');
   expect(t.g.release).toHaveBeenCalledExactlyOnceWith('synthetic-lease',expect.objectContaining({kind:'denied'}));
  }
 });
 it('preserves a gate denial racing cancellation and clears prior evidence',async()=>{
  const t=setup(),controller=new AbortController();await t.handler(request());t.advance(REFRESH_MS);
  vi.mocked(t.g.acquire).mockImplementation(()=>{queueMicrotask(()=>controller.abort());return Promise.reject({code:'source_denied'});});
  expect(await readReply(await t.handler(new Request(request(),{signal:controller.signal})))).toMatchObject({snapshot:null,status:{state:'denied',error_code:'source_denied',next_retry_at:null}});
  t.advance(MAX_CACHE_AGE_MS);await t.handler(request());expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.g.acquire).toHaveBeenCalledTimes(2);expect(t.g.release).toHaveBeenCalledTimes(1);
 });
});
