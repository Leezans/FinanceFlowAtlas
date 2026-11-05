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
// Exercise broad cardinality in the native runtime, not only two-row fixtures.
for(let i=0;i<700;i++){catalog.result[`S${i}USD`]={aclass_base:'currency',aclass_quote:'currency',base:`S${i}`,quote:'ZUSD',wsname:`S${i}/USD`,status:'online'};fixture.result[`S${i}USD`]={c:['1.25','1'],v:['99','3'],p:['99','1.2'],t:[99,8]};}
async function scenario(mode,fn){
 let calls=0,metadataCalls=0;const events=[];const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://api.kraken.com').intercept({method:'GET',path:'/0/public/AssetPairs?aclass_base=currency'}).reply(()=>{metadataCalls++;events.push({endpoint:'metadata',at:Date.now()});if(mode==='metadata-denied')return {statusCode:403,data:''};const raw=Buffer.from(JSON.stringify(catalog)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json',...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};}).persist();
 const interception=mock.get('https://api.kraken.com').intercept({method:'GET',path:'/0/public/Ticker?asset_class=forex'}).reply(()=>{
  calls++;events.push({endpoint:'ticker',at:Date.now()});if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'1800'}}};
  const data=structuredClone(fixture);if(mode==='partial')delete data.result.XETHZUSD;const raw=Buffer.from(JSON.stringify(data)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')interception.delay(5000);
 // Separate native worker module state sharing the exact same D1 gate.
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-shared-kraken-gate'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{const db=await mf.getD1Database('DB','warm');for(const sql of [aMigration,migration])for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();await fn(mf,db,()=>calls);assert.equal(metadataCalls,1);if(events.length>1)assert.ok(events[1].at-events[0].at>=1000,'metadata/ticker calls require source pacing');assert.equal((await db.prepare('SELECT status FROM ashare_source_gate').first()).status,'blocked');}
 finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].last_price_usd,'12.34567890');assert.equal(body.snapshot.rows[0].volume_base_24h,'3.125');assert.equal(body.snapshot.source_observed_at,null);assert.equal(body.snapshot.rows.length,702);assert.equal(body.snapshot.universe_pair_count,702);assert.equal(body.snapshot.quality,'complete');assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,503);assert.equal((await cold.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms FROM kraken_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+50_000);
 console.log(`PASS checked-in Kraken host ${encoding}; exact decimals; shared cold-worker cooldown; A-share gate untouched`);
});
await scenario('metadata-denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');assert.equal(calls(),0);assert.equal((await db.prepare('SELECT status FROM kraken_source_gate').first()).status,'blocked');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),0);console.log('PASS catalog denial stops before ticker; shared block persists');
});
await scenario('partial',async(mf,_db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200);assert.equal(body.snapshot.rows.length,701);assert.equal(body.snapshot.universe_pair_count,702);assert.deepEqual(body.snapshot.missing,[{pair:'ETH/USD',reason:'missing_ticker'}]);assert.equal(body.snapshot.quality,'partial');assert.equal(calls(),1);console.log('PASS explicit partial universe coverage with 701 valid peers');
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
