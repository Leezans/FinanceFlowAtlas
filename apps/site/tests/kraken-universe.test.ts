import {afterEach,describe,expect,it,vi} from 'vitest';
import {createKrakenHandler,KRAKEN_PAIRS_URL,KRAKEN_URL,MAX_PAIRS,MAX_SOURCE_PAIRS,parseKrakenUniverse,parseKrakenTicker,REFRESH_MS,UNIVERSE_REFRESH_MS,type KrakenGate,type KrakenReply} from '../lib/crypto/kraken';
import {validateKrakenReply} from '../components/crypto/client';
import {catalog,pairMetadata,universe} from './kraken-fixture';
const iso='2026-11-05T03:00:00.000Z';
const tick=()=>({c:['12.5000000000','1'],v:['999','3.125'],p:['999','12.0000000000'],t:[999,8]});
const raw=()=>({error:[],result:{XXBTZUSD:tick(),XETHZUSD:tick(),SOLUSD:tick()}});
const response=(value:unknown,status=200)=>Response.json(value,{status});
const request=()=>new Request('https://test.invalid/api/v1/crypto/kraken/snapshot');
function setup(){
 vi.useFakeTimers();vi.setSystemTime(iso);
 const gate:KrakenGate={inspect:vi.fn(async()=>'idle' as const),acquire:vi.fn(async()=>({token:'one'})),release:vi.fn(async()=>{})};
 const calls:{url:string;at:number}[]=[],fetcher=vi.fn<typeof fetch>(async url=>{calls.push({url:String(url),at:Date.now()});return response(url===KRAKEN_PAIRS_URL?catalog():raw());});
 return {gate,calls,fetcher,handler:createKrakenHandler({gate,fetcher,isolatedForTests:true})};
}
async function run(t:ReturnType<typeof setup>){const pending=t.handler(request());await vi.advanceTimersByTimeAsync(1_101);return (await pending).json() as Promise<KrakenReply>;}
afterEach(()=>vi.useRealTimers());
describe('official Kraken spot universe',()=>{
 it('joins metadata identities, excludes non-USD, offline and tokenized assets, and sorts deterministically',()=>{
  const result={...catalog().result,SOLUSD:pairMetadata('SOL'),XDGUSD:pairMetadata('XXDG','XDG'),ETHUSDT:{...pairMetadata('XETH','ETH'),quote:'USDT',wsname:'ETH/USDT'},OFFUSD:{...pairMetadata('OFF'),status:'cancel_only'},STOCKUSD:{...pairMetadata('STOCK'),aclass_base:'tokenized_asset'}};
  const u=parseKrakenUniverse({error:[],result},iso);expect(u.pairs.map(p=>p.pair)).toEqual(['BTC/USD','DOGE/USD','ETH/USD','SOL/USD']);expect(u.source_pair_count).toBe(7);expect(u.pairs.find(p=>p.base==='SOL')?.source_pair).toBe('SOLUSD');
 });
 it('rejects duplicate aliases, invalid identities, empty/oversized universes and invalid clocks',()=>{
  expect(()=>parseKrakenUniverse({error:[],result:{...catalog().result,BTCUSD:pairMetadata('BTC')}},iso)).toThrow('duplicate_pair');
  expect(()=>parseKrakenUniverse({error:[],result:{BAD:pairMetadata('BAD','<script>')}},iso)).toThrow('invalid_pair_metadata');
  expect(()=>parseKrakenUniverse({error:[],result:{}},iso)).toThrow('source_pair_budget');
  const many=Object.fromEntries(Array.from({length:MAX_PAIRS+1},(_,i)=>[`S${i}USD`,pairMetadata(`S${i}`)]));expect(()=>parseKrakenUniverse({error:[],result:many},iso)).toThrow('universe_pair_budget');expect(()=>parseKrakenUniverse(catalog(),'not-a-clock')).toThrow('invalid_clock');
 });
 it('supports hundreds of metadata rows without a top-N cap or fabricated sectors',()=>{
  const pairs=Object.fromEntries(Array.from({length:700},(_,i)=>[`S${i}USD`,pairMetadata(`S${i}`)]));
  const u=parseKrakenUniverse({error:[],result:pairs},iso),data=parseKrakenTicker({error:[],result:Object.fromEntries(Object.keys(pairs).map(key=>[key,tick()]))},iso,iso,u);
  expect(data.rows).toHaveLength(700);expect(data.universe_pair_count).toBe(700);expect(data.missing).toEqual([]);expect(data.quality).toBe('complete');expect(data.rows.every(row=>row.net_capital_flow===null&&row.open_interest===null)).toBe(true);
 });
 it('reports omissions without converting missing/invalid evidence to zero or discarding valid peers',()=>{
  const u=parseKrakenUniverse({error:[],result:{...catalog().result,SOLUSD:pairMetadata('SOL')}},iso),r=raw();delete (r.result as Record<string,unknown>).SOLUSD;r.result.XETHZUSD.c[0]='0';
  const data=parseKrakenTicker(r,iso,iso,u);expect(data.rows.map(p=>p.pair)).toEqual(['BTC/USD']);expect(data.quality).toBe('partial');expect(data.missing).toEqual([{pair:'ETH/USD',reason:'invalid_ticker'},{pair:'SOL/USD',reason:'missing_ticker'}]);r.result.XXBTZUSD.c[0]='NaN';expect(()=>parseKrakenTicker(r,iso,iso,u)).toThrow('no_valid_tickers');
 });
 it('caps ticker cardinality and preserves top-level API denials',()=>{
  const result=Object.fromEntries(Array.from({length:MAX_SOURCE_PAIRS+1},(_,i)=>[`S${i}`,{}]));expect(()=>parseKrakenTicker({error:[],result},iso,iso,universe(iso))).toThrow('source_pair_budget');expect(()=>parseKrakenUniverse({error:['EAPI:Rate limit exceeded']},iso)).toThrow('source_access_denied');expect(()=>parseKrakenTicker({error:['EAPI:Permission denied']},iso,iso,universe(iso))).toThrow('source_access_denied');
 });
 it('rejects false client coverage, duplicate source ids and future/stale catalog timestamps',async()=>{
  const t=setup(),data=await run(t);expect(validateKrakenReply(data).snapshot?.rows).toHaveLength(2);
  for(const change of [(v:typeof data)=>v.snapshot!.universe_pair_count++, (v:typeof data)=>v.snapshot!.rows[1].source_pair=v.snapshot!.rows[0].source_pair,(v:typeof data)=>v.snapshot!.quality='partial',(v:typeof data)=>v.snapshot!.catalog_fetched_at='2026-11-05T04:00:00.000Z',(v:typeof data)=>v.snapshot!.catalog_fetched_at='2026-11-04T04:00:00.000Z']){const copy=structuredClone(data);change(copy);expect(()=>validateKrakenReply(copy)).toThrow();}
 });
});
describe('one gate across the expanded universe',()=>{
 it('paces metadata and ticker within one lease, caches metadata, and discovers listings after TTL',async()=>{
  const t=setup();await run(t);expect(t.calls.map(c=>c.url)).toEqual([KRAKEN_PAIRS_URL,KRAKEN_URL]);expect(t.calls[1].at-t.calls[0].at).toBeGreaterThanOrEqual(1_100);expect(t.gate.acquire).toHaveBeenCalledTimes(1);expect(t.gate.release).toHaveBeenCalledTimes(1);
  await run(t);expect(t.calls).toHaveLength(2);await vi.advanceTimersByTimeAsync(REFRESH_MS);await run(t);expect(t.calls.map(c=>c.url)).toEqual([KRAKEN_PAIRS_URL,KRAKEN_URL,KRAKEN_URL]);
  t.fetcher.mockImplementation(async url=>response(url===KRAKEN_PAIRS_URL?{error:[],result:{...catalog().result,SOLUSD:pairMetadata('SOL')}}:raw()));await vi.advanceTimersByTimeAsync(UNIVERSE_REFRESH_MS);const data=await run(t);expect(data.snapshot!.rows).toHaveLength(3);expect(data.snapshot!.catalog_fetched_at).not.toBe(iso);
 });
 it('stops before ticker on metadata denial and never retries via another endpoint',async()=>{
  const t=setup();t.fetcher.mockImplementation(async()=>response({},403));let data=await run(t);expect(data.status.state).toBe('denied');expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.gate.release).toHaveBeenLastCalledWith('one',expect.objectContaining({kind:'denied'}));await vi.advanceTimersByTimeAsync(UNIVERSE_REFRESH_MS);data=await run(t);expect(data.snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(1);
 });
 it('cancels during pacing without sending ticker or publishing metadata',async()=>{
  const t=setup(),controller=new AbortController(),pending=t.handler(new Request(request(),{signal:controller.signal}));await vi.advanceTimersByTimeAsync(10);controller.abort();await vi.advanceTimersByTimeAsync(1);const data=await (await pending).json() as KrakenReply;expect(data.status.error_code).toBe('aborted');expect(data.snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.gate.release).toHaveBeenCalledTimes(1);
 });
 it('honors blocked/busy admission before either endpoint',async()=>{
  const t=setup();vi.mocked(t.gate.inspect).mockResolvedValue('blocked');expect((await run(t)).status.state).toBe('denied');expect(t.fetcher).not.toHaveBeenCalled();const u=setup();vi.mocked(u.gate.acquire).mockRejectedValue({code:'source_busy'});expect((await run(u)).status.error_code).toBe('source_busy');expect(u.fetcher).not.toHaveBeenCalled();
 });
});
