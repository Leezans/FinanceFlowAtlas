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
 import {cftcHandler} from './lib/futures/host';
 import {createCftcHandler} from './lib/futures/handler';
 import {D1CftcGate} from './lib/futures/source-gate';
 export default {fetch(request,env){return request.headers.has('x-test-cold')?createCftcHandler({gate:new D1CftcGate(env.DB)})(request):cftcHandler(request);}};`,resolveDir:root,sourcefile:'cftc-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migration=await readFile(new URL('../drizzle/0005_cftc_futures_gate.sql',import.meta.url),'utf8');
const aMigration=await readFile(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const url='https://test.invalid/api/v1/futures/cftc/snapshot';
const {outputFiles:modelFiles}=await build({stdin:{contents:"export {CFTC_URL} from './lib/futures/adapter';export {CONTRACTS} from './lib/futures/model';",resolveDir:root,sourcefile:'cftc-runtime-model.ts'},bundle:true,format:'esm',platform:'node',write:false});
const {CFTC_URL,CONTRACTS}=await import('data:text/javascript;base64,'+Buffer.from(modelFiles[0].text).toString('base64'));
const fixture=CONTRACTS.flatMap(c=>[7,14].map(days=>({market_and_exchange_names:c.name,cftc_contract_market_code:c.code,contract_units:c.units,futonly_or_combined:'FutOnly',report_date_as_yyyy_mm_dd:new Date(Date.now()-days*86400000).toISOString().slice(0,10)+'T00:00:00.000',open_interest_all:'1000',noncomm_positions_long_all:'300',noncomm_positions_short_all:'200',noncomm_postions_spread_all:'100',comm_positions_long_all:'400',comm_positions_short_all:'500',nonrept_positions_long_all:'200',nonrept_positions_short_all:'200'})));
async function scenario(mode,fn){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://publicreporting.cftc.gov').intercept({method:'GET',path:new URL(CFTC_URL).pathname+new URL(CFTC_URL).search}).reply(()=>{
  calls++;if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'7200'}}};
  const raw=Buffer.from(JSON.stringify(fixture)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(mode==='plain'?{}:{'content-encoding':mode})}}};
 }).persist();
 const mf=new Miniflare({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],fetchMock:mock});
 try{const db=await mf.getD1Database('DB');for(const sql of [aMigration,migration])for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();await fn(mf,db,()=>calls,value=>{mode=value;});assert.equal((await db.prepare('SELECT status FROM ashare_source_gate').first()).status,'blocked');}
 finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].current.open_interest,1000);assert.equal(body.snapshot.rows.length,4);assert.equal(body.snapshot.source_released_at,null);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),1);
 const cold=await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms FROM cftc_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+3_590_000);
 await db.prepare("UPDATE cftc_source_gate SET payload='{}' WHERE id='legacy_futures'").run();
 const corrupt=await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).status.error_code,'source_gate_unavailable');assert.equal(calls(),1);
 console.log(`PASS checked-in Cftc host ${encoding}; balanced contract positions; shared cold-worker report cache and cooldown; A-share gate untouched`);
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'unavailable');
 const row=await db.prepare('SELECT status,not_before_ms FROM cftc_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+7_190_000);
 await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal(calls(),1);console.log('PASS temporary 2h Retry-After persists across workers');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 const warm=await mf.dispatchFetch(url);assert.equal(warm.status,200);assert.ok((await db.prepare('SELECT payload FROM cftc_source_gate').first()).payload);
 // Test-only scheduling change in the isolated synthetic DB, never production.
 await db.prepare('UPDATE cftc_source_gate SET not_before_ms=0').run();setMode('denied');
 const other=await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal((await other.json()).status.state,'denied');
 assert.equal((await db.prepare('SELECT payload FROM cftc_source_gate').first()).payload,null);
 const previouslyWarm=await mf.dispatchFetch(url);const result=await previouslyWarm.json();assert.equal(result.status.state,'denied');assert.equal(result.snapshot,null);assert.equal(calls(),2);
 console.log('PASS denial atomically clears previous shared report and invalidates warm-worker evidence');
});
await scenario('denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');
 const cold=await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),1);
 const blocked=await db.prepare('SELECT status,payload FROM cftc_source_gate').first();assert.equal(blocked.status,'blocked');assert.equal(blocked.payload,null);console.log('PASS denial persists across workers; no fallback requests');
});
console.log('PASS zero real network calls; no captured provider observations');
