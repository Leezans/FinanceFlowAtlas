/** Native workerd and D1. All external networking disabled; synthetic market data only. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wr('miniflare'),{build}=wr('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {optionsHandler} from './lib/options/host';
 let abort;
 export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/offline/abort'){abort?.();return new Response('synthetic abort');}
  if(path==='/offline/early'){
   const controller=new AbortController();void new Promise(resolve=>{abort=resolve;}).then(()=>controller.abort());
   void optionsHandler(new Request(new URL('/api/v1/options/deribit/snapshot',request.url),{signal:controller.signal})).then(r=>r.body?.cancel());
   for(let i=0;i<100;i++){const row=await env.DB.prepare('SELECT status FROM deribit_options_gate').first();if(row.status==='busy')return new Response('early',{status:202});await new Promise(r=>setTimeout(r,10));}
   return new Response('admission failed',{status:500});
  }
  return optionsHandler(request);
 }};`,resolveDir:root,sourcefile:'deribit-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migration=await readFile(new URL('../drizzle/0022_deribit_options_gate.sql',import.meta.url),'utf8');
const migrations=(await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)&&n<'0022').sort();
const names=['BTC-27NOV36-80000-C','BTC-27NOV36-80000-P'];
const envelope=result=>({jsonrpc:'2.0',testnet:false,result});
function summaries(){return envelope(names.map((instrument_name,i)=>({instrument_name,base_currency:'BTC',quote_currency:'BTC',creation_timestamp:Date.now(),mark_price:.02,mark_iv:50,price_change:i?-2:2,bid_price:.019,ask_price:.021,last:.02,volume:i?1:3,volume_usd:i?100:300,open_interest:10})));}
function metadata(){return envelope(names.map((instrument_name,i)=>({instrument_name,base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',kind:'option',is_active:true,expiration_timestamp:Date.parse('2036-11-27T08:00:00Z'),strike:80000,contract_size:1,option_type:i?'put':'call'})));}
const url='https://app.invalid/api/v1/options/deribit/snapshot';
async function scenario(initial,fn){
 let mode=initial,summaryCalls=0,metadataCalls=0;const mock=createFetchMock();mock.disableNetConnect();
 const source=mock.get('https://www.deribit.com');
 const summary=source.intercept({method:'GET',path:'/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option'}).reply(()=>{
  summaryCalls++;
  if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='limited')return {statusCode:200,data:JSON.stringify({jsonrpc:'2.0',error:{code:10028,message:'synthetic limit'}}),responseOptions:{headers:{'content-type':'application/json'}}};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'3600'}}};
  const raw=Buffer.from(JSON.stringify(summaries())),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')summary.delay(5000);
 source.intercept({method:'GET',path:'/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false'}).reply(()=>{metadataCalls++;return {statusCode:200,data:JSON.stringify(metadata()),responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-deribit'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold'),worker('refresh')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const name of migrations){const sql=await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();}
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(x=>x.name);
  // Preserve pre-existing stopped providers exactly; the new gate cannot reset them.
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',lease_token=NULL,reason_code='http_403'").run();
  for(const table of ['sina_source_gate','kraken_source_gate','ecb_fx_source_gate','cftc_source_gate','tpex_source_gate','asean_source_gate','cvm_source_gate','worldbank_equity_source_gate','polymarket_source_gate','tpex_summary_gate','cboe_delayed_source_gate','japan_mof_source_gate'])await db.prepare(`UPDATE ${table} SET status='blocked',lease_token=NULL`).run();
  const before=await Promise.all(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  for(const statement of migration.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
  await fn(mf,db,()=>({summaryCalls,metadataCalls}),value=>{mode=value;});
  for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${tables[i]}`).all()).results,before[i].results,`${tables[i]} remains unchanged`);
 }finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 assert.equal((await mf.dispatchFetch(url.replace('snapshot','status'))).status,200);assert.equal(calls().summaryCalls,0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].volume_usd,300);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(body.snapshot.rows.length,2);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.deepEqual(calls(),{summaryCalls:1,metadataCalls:1});
 await db.prepare("UPDATE deribit_options_gate SET status='busy',lease_token='synthetic-owned-busy'").run();const busy=await mf.dispatchFetch(url);assert.equal(busy.status,503);assert.equal((await busy.json()).snapshot,null);assert.deepEqual(calls(),{summaryCalls:1,metadataCalls:1});await db.prepare("UPDATE deribit_options_gate SET status='idle',lease_token=NULL").run();
 await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();await (await mf.getWorker('refresh')).fetch(url);assert.deepEqual(calls(),{summaryCalls:2,metadataCalls:1});
 const row=await db.prepare('SELECT * FROM deribit_options_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+59_000);
 console.log(`PASS ${encoding}: source units, cold cache, global cooldown, metadata reuse, all prior provider rows untouched`);
});
for(const mode of ['denied','limited'])await scenario(mode,async(mf,db,calls)=>{const r=await mf.dispatchFetch(url);assert.equal((await r.json()).status.state,'denied');await (await mf.getWorker('cold')).fetch(url);assert.deepEqual(calls(),{summaryCalls:1,metadataCalls:0});assert.equal((await db.prepare('SELECT status FROM deribit_options_gate').first()).status,'blocked');console.log(`PASS persistent ${mode}, including across cold workers`);});
await scenario('temporary',async(mf,db,calls)=>{assert.equal((await mf.dispatchFetch(url)).status,503);const row=await db.prepare('SELECT not_before_ms FROM deribit_options_gate').first();assert.ok(row.not_before_ms>Date.now()+3_590_000);await (await mf.getWorker('cold')).fetch(url);assert.equal(calls().summaryCalls,1);console.log('PASS 1-hour Retry-After and no busy-gate takeover');});
await scenario('plain',async(mf,db,calls,setMode)=>{await mf.dispatchFetch(url);await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();setMode('denied');await (await mf.getWorker('cold')).fetch(url);const warm=await (await mf.dispatchFetch(url)).json();assert.equal(warm.snapshot,null);assert.equal(warm.status.state,'denied');assert.equal((await db.prepare('SELECT payload FROM deribit_options_gate').first()).payload,null);assert.equal(calls().summaryCalls,2);console.log('PASS denial atomically purges shared and warm-worker evidence');});
await scenario('disconnect',async(mf,db,calls)=>{const early=await mf.dispatchFetch('https://app.invalid/offline/early');assert.equal(early.status,202);await early.text();for(let i=0;i<100&&calls().summaryCalls===0;i++)await new Promise(r=>setTimeout(r,20));await mf.dispatchFetch('https://app.invalid/offline/abort');let row;for(let i=0;i<250;i++){row=await db.prepare('SELECT * FROM deribit_options_gate').first();if(row.status==='idle')break;await new Promise(r=>setTimeout(r,20));}assert.equal(row.status,'idle');assert.equal(row.lease_token,null);assert.equal(row.payload,null);assert.equal(calls().metadataCalls,0);console.log('PASS response-finished cancellation retains exact owned D1 cleanup');});
console.log('PASS all external network disabled; no captured provider observations bundled');
