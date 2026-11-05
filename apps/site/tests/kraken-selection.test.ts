import {afterEach,describe,expect,it,vi} from 'vitest';
import {createKrakenHandler,KRAKEN_PAIRS_URL,KRAKEN_URL,REFRESH_MS,MAX_CACHE_AGE_MS,type KrakenGate,type KrakenReply} from '../lib/crypto/kraken';
import {canonicalTradeSelection,readTradeSelection,tradeSelectionKey} from '../lib/crypto/selection';
import {validateKrakenReply} from '../components/crypto/client';
import {pairMetadata} from './kraken-fixture';
const time=Date.parse('2026-11-05T10:00:00.000Z');
const request=(pairs?:readonly string[])=>new Request('https://test.invalid/api/v1/crypto/kraken/snapshot'+(pairs?'?pairs='+encodeURIComponent(pairs.join(',')):''));
function setup(){
 vi.useFakeTimers();vi.setSystemTime(time);
 const gate:KrakenGate={inspect:vi.fn(async()=> 'idle' as const),acquire:vi.fn(async()=>({token:'owner'})),release:vi.fn(async()=>{})};
 const catalog={error:[],result:{XXBTZUSD:pairMetadata('XXBT','XBT'),XETHZUSD:pairMetadata('XETH','ETH'),SOLUSD:pairMetadata('SOL'),ADAUSD:pairMetadata('ADA'),XRPUSD:pairMetadata('XRP'),XXDGZUSD:pairMetadata('XXDG','XDG')}};
 const calls:{url:string;at:number}[]=[];
 const fetcher=vi.fn<typeof fetch>(async input=>{
  const url=String(input);calls.push({url,at:Date.now()});
  if(url===KRAKEN_PAIRS_URL)return Response.json(catalog);
  if(url===KRAKEN_URL)return Response.json({error:[],result:Object.fromEntries(Object.keys(catalog.result).map(pair=>[pair,{c:['1','1'],v:['1','1'],p:['1','1'],t:[1,1]}]))});
  const query=new URL(url).searchParams,source=query.get('pair')!,start=Number(BigInt(query.get('since')!)/BigInt(1_000_000));
  return Response.json({error:[],result:{[source]:[['0.1','0.2',(start+1000)/1000,'b','l','',1]],last:(BigInt(query.get('since')!)+BigInt(1_000_000_000)).toString()}});
 });
 return {gate,catalog,calls,fetcher,handler:createKrakenHandler({gate,fetcher,includeTradeImbalance:true,isolatedForTests:true})};
}
async function collect(t:ReturnType<typeof setup>,pairs?:readonly string[]){const work=t.handler(request(pairs));await vi.advanceTimersByTimeAsync(4500);return await (await work).json() as KrakenReply;}
afterEach(()=>vi.useRealTimers());
describe('bounded display-name selection',()=>{
 it('canonicalizes order with one identity while retaining explicit versus legacy requests',()=>{
  expect(canonicalTradeSelection(['XRP/USD','ADA/USD'])).toEqual(['ADA/USD','XRP/USD']);
  expect(tradeSelectionKey(['XRP/USD','ADA/USD'])).toBe(tradeSelectionKey(['ADA/USD','XRP/USD']));
  expect(readTradeSelection(new URL(request().url),true)).toMatchObject({explicit:false});
  expect(readTradeSelection(new URL(request(['BTC/USD','ETH/USD','SOL/USD']).url),true)).toMatchObject({explicit:true});
 });
 it.each(['?pairs=','?pairs=BTC/USD,BTC/USD','?pairs=BTC/USD,ETH/USD,SOL/USD,ADA/USD','?pairs=btc/USD','?pairs=BTC/USDT','?pairs=BTC/USD&pairs=ETH/USD','?pairs=BTC/USD&force=1','?pairs=https://evil.invalid','?pairs=BTC/USD%00','?pair=BTC/USD'])('rejects invalid %s before any gate or provider access',async query=>{
  const t=setup();expect((await t.handler(new Request('https://test.invalid/snapshot'+query))).status).toBe(400);expect(t.gate.inspect).not.toHaveBeenCalled();expect(t.gate.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
 it.each([[['ADA/USD']],[['ADA/USD','XRP/USD']],[['XRP/USD','DOGE/USD','ADA/USD']]])('collects catalog-resolved arbitrary selection %j inside the same per-request budget',async selected=>{
  const t=setup(),result=await collect(t,selected);expect(validateKrakenReply(result)).toEqual(result);
  expect(result.requested_pairs).toEqual([...selected].sort());expect(result.trade_snapshot?.schema).toBe('kraken-trades/2');expect(result.trade_snapshot?.selected_pairs).toEqual([...selected].sort());expect(result.trade_snapshot?.rows.map(row=>row.pair)).toEqual([...selected].sort());
  expect(t.calls).toHaveLength(2+selected.length);expect(t.gate.acquire).toHaveBeenCalledTimes(1);expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner',{kind:'success'});
  for(let i=1;i<t.calls.length;i++)expect(t.calls[i].at-t.calls[i-1].at).toBeGreaterThanOrEqual(1100);
  if(selected.includes('DOGE/USD'))expect(t.calls.some(call=>call.url.includes('pair=XXDGZUSD'))).toBe(true);
 });
 it('does not fetch missing names or substitute source identifiers',async()=>{
  const t=setup(),result=await collect(t,['ADA/USD','NOTLISTED/USD']);expect(validateKrakenReply(result)).toEqual(result);expect(result.trade_snapshot?.missing_pairs).toEqual(['NOTLISTED/USD']);expect(result.trade_snapshot?.rows.map(row=>row.pair)).toEqual(['ADA/USD']);expect(t.calls).toHaveLength(3);expect(t.calls.some(call=>call.url.includes('NOTLISTED'))).toBe(false);
 });
 it('same canonical selection shares cache, but different selection retains only independent full-catalog quotes during cooldown',async()=>{
  const t=setup(),a=await collect(t,['XRP/USD','ADA/USD']),same=await collect(t,['ADA/USD','XRP/USD']),b=await collect(t,['DOGE/USD']);
  expect(same.trade_snapshot).toEqual(a.trade_snapshot);expect(b.snapshot).toEqual(a.snapshot);expect(b.trade_snapshot).toBeNull();expect(b.requested_pairs).toEqual(['DOGE/USD']);expect(t.calls).toHaveLength(4);expect(t.gate.acquire).toHaveBeenCalledTimes(1);expect(validateKrakenReply(b)).toEqual(b);
  const old=await collect(t);expect(old.trade_snapshot).toBeNull();expect(old).not.toHaveProperty('requested_pairs');
 });
 it('does not re-fetch or disclose another selection when simultaneous readers differ',async()=>{
  const t=setup(),a=t.handler(request(['ADA/USD']));await vi.advanceTimersByTimeAsync(100);
  const b=t.handler(request(['XRP/USD'])),same=t.handler(request(['ADA/USD']));await vi.advanceTimersByTimeAsync(3000);
  const [ra,rb,rs]=await Promise.all([a,b,same].map(async response=>(await (await response).json()) as KrakenReply));
  expect(ra.trade_snapshot?.rows[0].pair).toBe('ADA/USD');expect(rs.trade_snapshot).toEqual(ra.trade_snapshot);expect(rb.trade_snapshot).toBeNull();expect(rb.snapshot).toEqual(ra.snapshot);expect(t.calls).toHaveLength(3);expect(t.gate.acquire).toHaveBeenCalledTimes(1);
 });
 it('changes selection only after the global cooldown and never mixes acquired windows',async()=>{
  const t=setup(),a=await collect(t,['ADA/USD']);await vi.advanceTimersByTimeAsync(REFRESH_MS);const b=await collect(t,['XRP/USD','DOGE/USD']);
  expect(b.trade_snapshot?.rows.map(row=>row.pair)).toEqual(['DOGE/USD','XRP/USD']);expect(b.trade_snapshot?.window_ended_at).not.toBe(a.trade_snapshot?.window_ended_at);expect(b.trade_snapshot?.fetched_at).toBe(b.snapshot?.fetched_at);expect(t.calls).toHaveLength(6);
  const old=await collect(t,['ADA/USD']);expect(old.trade_snapshot).toBeNull();expect(old.snapshot).toEqual(b.snapshot);expect(t.calls).toHaveLength(6);
 });
 it('projects default evidence into strict legacy shape without poisoning explicit default requests',async()=>{
  const t=setup(),explicit=await collect(t,['SOL/USD','ETH/USD','BTC/USD']),legacy=await collect(t);
  expect(legacy.trade_snapshot?.schema).toBe('kraken-trades/1');expect(legacy.trade_snapshot).not.toHaveProperty('selected_pairs');expect(legacy).not.toHaveProperty('requested_pairs');expect(validateKrakenReply(legacy)).toEqual(legacy);expect(t.calls).toHaveLength(5);
  const again=await collect(t,['BTC/USD','ETH/USD','SOL/USD']);expect(again.trade_snapshot).toEqual(explicit.trade_snapshot);
 });
 it('preserves matching old evidence after different-selection temporary failure, never presenting it as new selection',async()=>{
  const t=setup(),a=await collect(t,['ADA/USD']);await vi.advanceTimersByTimeAsync(REFRESH_MS);const original=t.fetcher.getMockImplementation()!;
  t.fetcher.mockImplementation(async(input,init)=>String(input).includes('/Trades?')?Response.json({}, {status:503}):original(input,init));
  const b=await collect(t,['XRP/USD']);expect(b.status.state).toBe('stale');expect(b.snapshot).toEqual(a.snapshot);expect(b.trade_snapshot).toBeNull();
  const old=await collect(t,['ADA/USD']);expect(old.trade_snapshot).toEqual(a.trade_snapshot);expect(old.status.state).toBe('stale');
  await vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+1);expect((await collect(t,['ADA/USD'])).trade_snapshot).toBeNull();
 });
 it('honors a shared gate denial across every selection and removes the catalog bundle',async()=>{
  const t=setup();await collect(t,['ADA/USD']);vi.mocked(t.gate.inspect).mockResolvedValue('blocked');
  const denied=await collect(t,['XRP/USD']);expect(denied).toMatchObject({snapshot:null,trade_snapshot:null,status:{state:'denied'}});expect((await collect(t,['ADA/USD'])).snapshot).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(3);expect(t.gate.acquire).toHaveBeenCalledTimes(1);
 });
 it('keeps status queries read-only even when the requested selection differs',async()=>{
  const t=setup();const result=await t.handler(new Request(request(['ADA/USD']).url.replace('snapshot','status')));expect(result.status).toBe(200);expect(t.gate.inspect).toHaveBeenCalledTimes(1);expect(t.gate.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
 it('rejects v2 requested/observed membership tampering without weakening arithmetic or catalog checks',async()=>{
  const t=setup(),valid=await collect(t,['ADA/USD','XRP/USD']);
  for(const mutate of [(r:KrakenReply)=>{r.requested_pairs=['ADA/USD'];},(r:KrakenReply)=>{r.trade_snapshot!.selected_pairs=['ADA/USD'];},(r:KrakenReply)=>{r.trade_snapshot!.rows[0].source_pair='WRONG';},(r:KrakenReply)=>{r.trade_snapshot!.schema='kraken-trades/1';},(r:KrakenReply)=>{delete r.requested_pairs;},(r:KrakenReply)=>{r.trade_snapshot!.rows[0].imbalance_usd='100';}]){const bad=structuredClone(valid);mutate(bad);expect(()=>validateKrakenReply(bad)).toThrow();}
 });
});
