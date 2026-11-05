/** Native workerd, synthetic fixtures only. Every external network call is blocked. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {krakenHandler} from './lib/crypto/host';
 let releaseAbort;
 export default {fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/offline/abort'){releaseAbort?.();return new Response('synthetic cancellation released');}
  if(path==='/offline/cancel-after-response'){
   const controller=new AbortController();
   void krakenHandler(new Request(new URL('/api/v1/crypto/kraken/snapshot',request.url),{signal:controller.signal})).then(response=>response.body?.cancel());
   void new Promise(resolve=>{releaseAbort=resolve;}).then(()=>controller.abort());
   return new Response('synthetic early response',{status:202});
  }
  return krakenHandler(request);
 }};`,resolveDir:root,sourcefile:'kraken-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migration=await readFile(new URL('../drizzle/0003_brainy_donald_blake.sql',import.meta.url),'utf8');
const aMigration=await readFile(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const url='https://test.invalid/api/v1/crypto/kraken/snapshot';
const catalog={error:[],result:{XXBTZUSD:{aclass_base:'currency',aclass_quote:'currency',base:'XXBT',quote:'ZUSD',wsname:'XBT/USD',status:'online'},XETHZUSD:{aclass_base:'currency',aclass_quote:'currency',base:'XETH',quote:'ZUSD',wsname:'ETH/USD',status:'online'}}};
const fixture={error:[],result:{XXBTZUSD:{c:['12.34567890','0.1'],v:['999','3.125'],p:['999','12.1'],t:[999,8]},XETHZUSD:{c:['2.5','1'],v:['999','0'],p:['999','2.4'],t:[999,0]}}};
catalog.result.SOLUSD={aclass_base:'currency',aclass_quote:'currency',base:'SOL',quote:'ZUSD',wsname:'SOL/USD',status:'online'};fixture.result.SOLUSD={c:['1.5','1'],v:['99','3'],p:['99','1.4'],t:[99,8]};
// Exercise broad cardinality in the native runtime, not only two-row fixtures.
for(let i=0;i<700;i++){catalog.result[`S${i}USD`]={aclass_base:'currency',aclass_quote:'currency',base:`S${i}`,quote:'ZUSD',wsname:`S${i}/USD`,status:'online'};fixture.result[`S${i}USD`]={c:['1.25','1'],v:['99','3'],p:['99','1.2'],t:[99,8]};}
async function scenario(mode,fn){
 let calls=0,metadataCalls=0,tradeCalls=0;const events=[];const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://api.kraken.com').intercept({method:'GET',path:'/0/public/AssetPairs?aclass_base=currency'}).reply(()=>{metadataCalls++;events.push({endpoint:'metadata',at:Date.now()});if(mode==='metadata-denied')return {statusCode:403,data:''};const raw=Buffer.from(JSON.stringify(catalog)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json',...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};}).persist();
 const interception=mock.get('https://api.kraken.com').intercept({method:'GET',path:'/0/public/Ticker?asset_class=forex'}).reply(()=>{
  calls++;events.push({endpoint:'ticker',at:Date.now()});if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'1800'}}};
  const data=structuredClone(fixture);if(mode==='partial')delete data.result.XETHZUSD;const raw=Buffer.from(JSON.stringify(data)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')interception.delay(5000);
 mock.get('https://api.kraken.com').intercept({method:'GET',path:path=>new URL(path,'https://api.kraken.com').pathname==='/0/public/Trades'}).reply(options=>{
  tradeCalls++;events.push({endpoint:'trades',at:Date.now()});
  if(mode==='trade-denied')return {statusCode:403,data:''};
  const query=new URL(options.path,'https://api.kraken.com').searchParams,pair=query.get('pair'),start=Number(BigInt(query.get('since'))/1_000_000n)/1000;
  assert.ok(Object.hasOwn(catalog.result,pair),'trade source ID must come from the verified catalog');assert.equal(query.get('count'),'1000');assert.match(query.get('since'),/^\d+$/);
  const rows=mode==='trade-cap'?Array.from({length:1000},(_,index)=>['0.1','0.2',start+1+index/1000,'b','l','',index+1]):[['0.1','0.2',start+1,'b','l','',1],['0.3','0.1',start+2,'s','m','',2]];
  const raw=Buffer.from(JSON.stringify({error:[],result:{[pair]:rows,last:query.get('since')}})),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json',...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();

 // Separate native worker module state sharing the exact same D1 gate.
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-shared-kraken-gate'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{const db=await mf.getD1Database('DB','warm');for(const sql of [aMigration,migration])for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();await fn(mf,db,()=>calls);assert.equal(metadataCalls,1);for(let i=1;i<events.length;i++)assert.ok(events[i].at-events[i-1].at>=1000,'all Kraken requests require source pacing');assert.ok(tradeCalls<=3,'bounded three-pair trade request budget');assert.equal((await db.prepare('SELECT status FROM ashare_source_gate').first()).status,'blocked');}
 finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].last_price_usd,'12.34567890');assert.equal(body.snapshot.rows[0].volume_base_24h,'3.125');assert.equal(body.snapshot.source_observed_at,null);assert.equal(body.snapshot.rows.length,703);assert.equal(body.snapshot.universe_pair_count,703);assert.equal(body.snapshot.quality,'complete');assert.equal(body.trade_snapshot.rows.length,3);assert.equal(body.trade_snapshot.rows[0].imbalance_usd,'-0.01');assert.equal(body.trade_snapshot.rows[0].imbalance_pct,-20);assert.equal(body.trade_snapshot.fetched_at,body.snapshot.fetched_at);assert.equal(body.trade_snapshot.window_ended_at,body.snapshot.acquisition_started_at);assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,503);assert.equal((await cold.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms FROM kraken_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+50_000);
 console.log(`PASS checked-in Kraken host ${encoding}; exact decimals; shared cold-worker cooldown; A-share gate untouched`);
});
await scenario('selection',async(mf,db,calls)=>{
 const invalid=await mf.dispatchFetch(url+'?pairs=BTC/USD,BTC/USD');assert.equal(invalid.status,400);assert.equal(calls(),0);
 const chosen=url+'?pairs=S2%2FUSD%2CS1%2FUSD';
 const body=await (await mf.dispatchFetch(chosen)).json();assert.deepEqual(body.requested_pairs,['S1/USD','S2/USD']);assert.equal(body.trade_snapshot.schema,'kraken-trades/2');assert.deepEqual(body.trade_snapshot.selected_pairs,['S1/USD','S2/USD']);assert.deepEqual(body.trade_snapshot.rows.map(row=>row.pair),['S1/USD','S2/USD']);assert.equal(calls(),1);
 const same=await (await mf.dispatchFetch(url+'?pairs=S1/USD,S2/USD')).json();assert.deepEqual(same.trade_snapshot,body.trade_snapshot);assert.equal(calls(),1);
 const other=await (await mf.dispatchFetch(url+'?pairs=S3/USD')).json();assert.deepEqual(other.requested_pairs,['S3/USD']);assert.equal(other.trade_snapshot,null);assert.deepEqual(other.snapshot,body.snapshot);assert.equal(calls(),1);
 const legacy=await (await mf.dispatchFetch(url)).json();assert.equal(legacy.trade_snapshot,null);assert.equal(legacy.requested_pairs,undefined);
 const cold=await (await (await mf.getWorker('cold')).fetch(chosen)).json();assert.equal(cold.status.error_code,'source_cooldown');assert.equal(cold.trade_snapshot,null);assert.deepEqual(cold.requested_pairs,['S1/USD','S2/USD']);assert.equal(calls(),1);
 // Synthetic test DB only: another worker records a terminal denial.
 await db.prepare("UPDATE kraken_source_gate SET status='blocked' WHERE id='spot_usd'").run();
 const denied=await (await mf.dispatchFetch(chosen)).json();assert.equal(denied.status.state,'denied');assert.equal(denied.snapshot,null);assert.equal(denied.trade_snapshot,null);
 console.log('PASS arbitrary verified selections; canonical cache identity; no cross-selection trades; shared cold-worker cooldown and denial');
});
await scenario('metadata-denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');assert.equal(calls(),0);assert.equal((await db.prepare('SELECT status FROM kraken_source_gate').first()).status,'blocked');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),0);console.log('PASS catalog denial stops before ticker; shared block persists');
});
await scenario('partial',async(mf,_db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200);assert.equal(body.snapshot.rows.length,702);assert.equal(body.snapshot.universe_pair_count,703);assert.deepEqual(body.snapshot.missing,[{pair:'ETH/USD',reason:'missing_ticker'}]);assert.equal(body.snapshot.quality,'partial');assert.equal(calls(),1);console.log('PASS explicit partial universe coverage with 702 valid peers');
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'unavailable');
 const row=await db.prepare('SELECT status,not_before_ms FROM kraken_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+1_790_000);
 await (await mf.getWorker('cold')).fetch(url);assert.equal(calls(),1);console.log('PASS temporary Retry-After persists across workers');
});
await scenario('denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),1);
 assert.equal((await db.prepare('SELECT status FROM kraken_source_gate').first()).status,'blocked');console.log('PASS denial persists across workers; no fallback requests');
});
await scenario('trade-cap',async(mf,_db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200);assert.equal(calls(),1);
 for(const row of body.trade_snapshot.rows){assert.equal(row.coverage,'capped_response');assert.equal(row.returned_count,1000);assert.equal(row.imbalance_usd,null);assert.equal(row.imbalance_pct,null);}
 console.log('PASS capped response exposes incompleteness, never a zero or invented window total');
});
await scenario('trade-denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,503);assert.equal(body.status.state,'denied');assert.equal(body.snapshot,null);assert.equal(body.trade_snapshot,null);assert.equal(calls(),1);
 assert.equal((await db.prepare('SELECT status FROM kraken_source_gate').first()).status,'blocked');const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');
 console.log('PASS trade endpoint denial stops the shared source before remaining trade requests');
});
await scenario('disconnect',async(mf,db,calls)=>{
 // Miniflare's incoming proxy does not forward Node socket cancellation. Abort
 // an explicit request after its outer HTTP response to verify native lifetime.
 const outer=await mf.dispatchFetch('https://test.invalid/offline/cancel-after-response');
 assert.equal(outer.status,202);await outer.text();
 const waitFor=async(check,message)=>{
  const end=Date.now()+3000;
  while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error(message);
 };
 await waitFor(()=>calls()===1,'synthetic upstream did not start');
 assert.equal((await db.prepare('SELECT status FROM kraken_source_gate').first()).status,'busy');
 await (await mf.dispatchFetch('https://test.invalid/offline/abort')).text();
 await waitFor(async()=> (await db.prepare('SELECT status FROM kraken_source_gate').first()).status==='idle',
  'canceled request must retain the native D1 release after response completion');
 const row=await db.prepare('SELECT status,lease_token,not_before_ms-updated_ms AS quiet_ms FROM kraken_source_gate').first();
 assert.equal(row.lease_token,null);assert.equal(row.quiet_ms,60_000);assert.equal(calls(),1);
 const status=await (await mf.dispatchFetch(url.replace('snapshot','status'))).json();
 assert.equal(status.state,'unavailable');assert.equal(status.error_code,'aborted');assert.equal(status.fetched_at,null);
 const cold=await (await mf.getWorker('cold')).fetch(url);
 assert.equal(cold.status,503);assert.equal((await cold.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 console.log('PASS cancellation after HTTP response: owner-token cleanup retained; no candidate published; cold-worker cooldown');
});
console.log('PASS zero real network calls; no captured provider observations');
