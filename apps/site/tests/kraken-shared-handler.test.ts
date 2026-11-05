import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {KrakenSnapshotValidationError,createKrakenHandler,type KrakenGate,type KrakenReply} from '../lib/crypto/kraken';
import {catalog,parseTicker,universe} from './kraken-fixture';
import {parseKrakenTrades,tradeSnapshot} from '../lib/crypto/trades';
import {readTradeSelection} from '../lib/crypto/selection';
import type {KrakenSnapshotRead} from '../lib/crypto/snapshot-store';
const now=Date.parse('2026-11-05T03:00:00Z'),iso=new Date(now).toISOString();
function evidence(){
 const snapshot=parseTicker({error:[],result:{XXBTZUSD:{c:['12.34567890','1'],v:['9','3'],p:['9','12.1'],t:[9,8]},XETHZUSD:{c:['2.5','1'],v:['9','0'],p:['9','2.4'],t:[9,0]}}},iso,iso);
 const catalog=universe(iso),pair=catalog.pairs[0],row=parseKrakenTrades({error:[],result:{[pair.source_pair]:[['10','2',(now-5000)/1000,'b','m','',1]],last:String(BigInt(now)*BigInt(1000000))}},pair,now-300_000,now,now);
 return {snapshot,universe:catalog,trades:tradeSnapshot([row],now,now,['BTC/USD'],'5m'),key:'5m:BTC/USD'};
}
const request=(query='pairs=BTC/USD&window=5m',mode='snapshot')=>new Request(`https://synthetic.invalid/api/v1/crypto/kraken/${mode}?${query}`);
function fixture(read:()=>Promise<KrakenSnapshotRead>){
 const fetcher=vi.fn<typeof fetch>(),commit=vi.fn(async()=>{});
 const gate:KrakenGate={inspect:vi.fn(async()=> 'idle' as const),acquire:vi.fn(async()=>({token:'synthetic'})),release:vi.fn(async()=>{})};
 const handler=createKrakenHandler({gate,fetcher,now:()=>now,includeTradeImbalance:true,isolatedForTests:true,snapshotStore:{read:vi.fn(read),commit}});
 return {handler,fetcher,commit,gate};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
test('cold reader reuses exact quote and trade provenance without admission or source calls',async()=>{
 const value=evidence(),f=fixture(async()=>({bundle:value,ageMs:0,canAcquire:false,nowMs:now,nextRetryMs:now+60_000}));
 const response=await f.handler(request()),body=await response.json() as KrakenReply;
 expect(response.status).toBe(200);expect(body.snapshot).toEqual(value.snapshot);expect(body.trade_snapshot).toEqual(value.trades);
 expect(f.fetcher).not.toHaveBeenCalled();expect(f.gate.acquire).not.toHaveBeenCalled();expect(f.gate.release).not.toHaveBeenCalled();
});
test('status discovers durable evidence without mutation',async()=>{
 const f=fixture(async()=>({bundle:evidence(),ageMs:0,canAcquire:true,nowMs:now}));
 expect(await (await f.handler(request(undefined,'status'))).json()).toMatchObject({state:'available',fetched_at:iso});
 expect(f.gate.acquire).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();expect(f.commit).not.toHaveBeenCalled();
});
test.each(['pairs=ETH/USD&window=5m','pairs=BTC/USD&window=1m'])('fallback quotes never attach another trade selection/window: %s',async query=>{
 const value=evidence(),f=fixture(async()=>({bundle:value,ageMs:0,canAcquire:false,nowMs:now,nextRetryMs:now+60_000}));
 const response=await f.handler(request(query)),body=await response.json() as KrakenReply;
 expect(body.snapshot).toEqual(value.snapshot);expect(body.trade_snapshot).toBeNull();expect(f.fetcher).not.toHaveBeenCalled();
});
test.each(['source_denied','source_busy','snapshot_invalid','snapshot_store_unavailable'])('shared %s suppresses all local evidence and never fetches',async code=>{
 let failing=false;const f=fixture(async()=>failing?{code,canAcquire:false}:{bundle:evidence(),ageMs:0,canAcquire:false,nowMs:now});
 expect((await f.handler(request())).status).toBe(200);failing=true;
 const response=await f.handler(request()),body=await response.json() as KrakenReply;
 expect(response.status).toBe(503);expect(body.snapshot).toBeNull();expect(body.trade_snapshot).toBeNull();expect(f.fetcher).not.toHaveBeenCalled();expect(f.gate.acquire).not.toHaveBeenCalled();
});
test('read that never settles is bounded and does not reuse warm evidence or acquire',async()=>{
 let hung=false;const f=fixture(()=>hung?new Promise(()=>{}):Promise.resolve({bundle:evidence(),ageMs:0,canAcquire:false,nowMs:now}));
 expect((await f.handler(request())).status).toBe(200);hung=true;
 const pending=f.handler(request());await vi.advanceTimersByTimeAsync(4000);
 const response=await pending,body=await response.json() as KrakenReply;
 expect(response.status).toBe(503);expect(body.snapshot).toBeNull();expect(body.trade_snapshot).toBeNull();expect(f.fetcher).not.toHaveBeenCalled();
});
test.each(['source_denied','source_busy'])('permission changing to %s during admission suppresses the final shared response',async code=>{
 let reads=0;const f=fixture(async()=>++reads===1?{canAcquire:true,nowMs:now}:{canAcquire:false,code,nowMs:now});
 vi.mocked(f.gate.acquire).mockRejectedValue({code});
 const response=await f.handler(request()),body=await response.json() as KrakenReply;
 expect(response.status).toBe(503);expect(body.snapshot).toBeNull();expect(body.trade_snapshot).toBeNull();expect(f.fetcher).not.toHaveBeenCalled();expect(reads).toBe(2);
});
test('invalid requests never inspect shared storage',async()=>{
 const read=vi.fn(async()=>({canAcquire:true})),f=fixture(read);
 expect((await f.handler(request('pairs=BTC/USD&window=1y'))).status).toBe(400);
 expect(read).not.toHaveBeenCalled();expect(f.gate.inspect).not.toHaveBeenCalled();
});
test('canonical request order resolves the same shared selection',()=>{
 expect(readTradeSelection(new URL('https://synthetic.invalid/?pairs=ETH/USD,BTC/USD&window=1m'),true).key).toBe('1m:BTC/USD,ETH/USD');
});
function acquisitionFixture(){
 let stored:KrakenSnapshotRead={canAcquire:true,nowMs:now};const retained:Promise<unknown>[]=[];
 const gate:KrakenGate={inspect:vi.fn(async()=> 'idle' as const),acquire:vi.fn(async()=>({token:'synthetic'})),release:vi.fn(async()=>{})};
 const fetcher=vi.fn<typeof fetch>(async input=>new Response(JSON.stringify(String(input).includes('AssetPairs')?catalog():{error:[],result:{XXBTZUSD:{c:['10','1'],v:['1','2'],p:['10','10'],t:[1,2]},XETHZUSD:{c:['3','1'],v:['1','0'],p:['3','3'],t:[1,0]}}}),{headers:{'Content-Type':'application/json'}}));
 const commit=vi.fn(async(_token:string,bundle:NonNullable<KrakenSnapshotRead['bundle']>)=>{stored={bundle,ageMs:0,canAcquire:false,nowMs:now,nextRetryMs:now+60_000};});
 const handler=createKrakenHandler({gate,fetcher,now:()=>now,snapshotStore:{read:async()=>stored,commit},waitUntil:work=>retained.push(work)});
 return {handler,gate,fetcher,commit,retained,setStored:(value:KrakenSnapshotRead)=>{stored=value;}};
}
const quoteRequest=(signal?:AbortSignal)=>new Request('https://synthetic.invalid/api/v1/crypto/kraken/snapshot',{signal});
test('successful acquisition publishes once through shared commit and never separately releases',async()=>{
 const f=acquisitionFixture(),pending=f.handler(quoteRequest());await vi.advanceTimersByTimeAsync(1101);
 expect((await pending).status).toBe(200);await Promise.all(f.retained);
 expect(f.commit).toHaveBeenCalledTimes(1);expect(f.gate.release).not.toHaveBeenCalled();expect(f.fetcher).toHaveBeenCalledTimes(2);
 expect(f.commit.mock.calls[0][1]).toMatchObject({trades:null,key:null,snapshot:{fetched_at:iso,acquisition_started_at:iso}});
});
test('cancellation before publication prevents commit and retains owner cleanup',async()=>{
 const f=acquisitionFixture(),controller=new AbortController();
 f.fetcher.mockImplementation(async()=>{controller.abort();return new Response(JSON.stringify(catalog()),{headers:{'Content-Type':'application/json'}});});
 const pending=f.handler(quoteRequest(controller.signal));await vi.advanceTimersByTimeAsync(1);
 const response=await pending;expect(response.status).toBe(503);await Promise.all(f.retained);
 expect(f.commit).not.toHaveBeenCalled();expect(f.gate.release).toHaveBeenCalledTimes(1);
});
test('cancellation during publication retains the actual commit and never retries release',async()=>{
 const f=acquisitionFixture(),controller=new AbortController();let finish!:()=>void;
 const barrier=new Promise<void>(resolve=>{finish=resolve;});
 f.commit.mockImplementation(async(_token,bundle)=>{await barrier;f.setStored({bundle,ageMs:0,canAcquire:false,nowMs:now});});
 const pending=f.handler(quoteRequest(controller.signal));await vi.advanceTimersByTimeAsync(1101);expect(f.commit).toHaveBeenCalledTimes(1);
 let settled=false;void f.retained[0].then(()=>{settled=true;});controller.abort();expect(settled).toBe(false);finish();
 const body=await (await pending).json() as KrakenReply;await Promise.all(f.retained);
 expect(body.snapshot).toBeNull();expect(settled).toBe(true);expect(f.gate.release).not.toHaveBeenCalled();expect(f.commit).toHaveBeenCalledTimes(1);
});
test('unconfirmed late commit fails closed but its actual promise remains retained',async()=>{
 const f=acquisitionFixture();let finish!:()=>void;const barrier=new Promise<void>(resolve=>{finish=resolve;});
 f.commit.mockImplementation(async(_token,bundle)=>{await barrier;f.setStored({bundle,ageMs:0,canAcquire:false,nowMs:now});});
 const pending=f.handler(quoteRequest());await vi.advanceTimersByTimeAsync(1101);expect(f.commit).toHaveBeenCalledTimes(1);
 const body=await (await pending).json() as KrakenReply;
 expect(body.snapshot).toBeNull();expect(body.status).toMatchObject({state:'denied',error_code:'source_gate_outcome_unconfirmed'});
 let settled=false;void f.retained[0].then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
 finish();await Promise.all(f.retained);expect(settled).toBe(true);expect(f.gate.release).not.toHaveBeenCalled();
 expect((await (await f.handler(quoteRequest())).json() as KrakenReply).snapshot).toBeNull();expect(f.commit).toHaveBeenCalledTimes(1);
});

test('known pre-publication validation rejection releases its owner once and never claims an uncertain commit',async()=>{
 const f=acquisitionFixture();f.commit.mockRejectedValue(new KrakenSnapshotValidationError());
 const pending=f.handler(quoteRequest());await vi.advanceTimersByTimeAsync(1101);
 const body=await (await pending).json() as KrakenReply;await Promise.all(f.retained);
 expect(body.snapshot).toBeNull();expect(body.status).toMatchObject({state:'unavailable',error_code:'snapshot_invalid'});
 expect(f.gate.release).toHaveBeenCalledExactlyOnceWith('synthetic',{kind:'temporary_failure',retryAfterMs:60_000});
 expect(f.commit).toHaveBeenCalledTimes(1);
});
