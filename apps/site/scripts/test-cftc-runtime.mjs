/** Native workerd, synthetic fixtures only. Every external network call is blocked. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {cftcHandler} from './lib/futures/host';
 let releaseAbort;
 export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/offline/abort'){releaseAbort?.();return new Response('synthetic cancellation released');}
  if(path==='/offline/cancel-after-response'){
   const controller=new AbortController();
   void new Promise(resolve=>{releaseAbort=resolve;}).then(()=>controller.abort());
   void cftcHandler(new Request(new URL('/api/v1/futures/cftc/snapshot',request.url),{signal:controller.signal})).then(response=>response.body?.cancel());
   // The read-only inspect precedes retention. Finish this synthetic request
   // only after admission, so the test specifically exercises owned cleanup.
   for(let i=0;i<100;i++){
    const row=await env.DB.prepare('SELECT status FROM cftc_source_gate').first();
    if(row.status==='busy')return new Response('synthetic early response',{status:202});
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   return new Response('synthetic acquisition did not start',{status:500});
  }
  return cftcHandler(request);
 }};`,resolveDir:root,sourcefile:'cftc-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migrationNames=(await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
const migrations=await Promise.all(migrationNames.map(name=>readFile(new URL(`../drizzle/${name}`,import.meta.url),'utf8')));
const blockedGates=['ashare_source_gate','sina_source_gate','kraken_source_gate','ecb_fx_source_gate'];
const url='https://test.invalid/api/v1/futures/cftc/snapshot';
const {outputFiles:modelFiles}=await build({stdin:{contents:"export {CFTC_URL,parseCftc} from './lib/futures/adapter';export {CONTRACTS,LEGACY_CONTRACT_CODES,MAX_SOURCE_BYTES} from './lib/futures/model';",resolveDir:root,sourcefile:'cftc-runtime-model.ts'},bundle:true,format:'esm',platform:'node',write:false});
const {CFTC_URL,parseCftc,CONTRACTS,LEGACY_CONTRACT_CODES,MAX_SOURCE_BYTES}=await import('data:text/javascript;base64,'+Buffer.from(modelFiles[0].text).toString('base64'));
const fixture=CONTRACTS.flatMap(c=>[7,14].map(days=>({market_and_exchange_names:c.name,cftc_contract_market_code:c.code,contract_units:c.units,futonly_or_combined:'FutOnly',report_date_as_yyyy_mm_dd:new Date(Date.now()-days*86400000).toISOString().slice(0,10)+'T00:00:00.000',open_interest_all:'1000',noncomm_positions_long_all:'300',noncomm_positions_short_all:'200',noncomm_postions_spread_all:'100',comm_positions_long_all:'400',comm_positions_short_all:'500',nonrept_positions_long_all:'200',nonrept_positions_short_all:'200'})));
async function scenario(mode,fn){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 const interception=mock.get('https://publicreporting.cftc.gov').intercept({method:'GET',path:new URL(CFTC_URL).pathname+new URL(CFTC_URL).search}).reply(()=>{
  calls++;if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'7200'}}};
  let records=structuredClone(fixture);
  if(mode==='four-periods')for(const row of structuredClone(fixture))records.push({...row,report_date_as_yyyy_mm_dd:new Date(Date.parse(row.report_date_as_yyyy_mm_dd)-14*86400000).toISOString().slice(0,10)+'T00:00:00.000'});
  if(mode==='missing')records.pop();
  if(mode==='imbalance')records[100].nonrept_positions_long_all='201';
  if(mode==='prior-date')records[101].report_date_as_yyyy_mm_dd=new Date(Date.parse(records[101].report_date_as_yyyy_mm_dd)-7*86400000).toISOString().slice(0,10)+'T00:00:00.000';
  if(mode==='wrong-units')records[100].contract_units='UNREVIEWED';
  const raw=Buffer.from(mode==='oversized'?' '.repeat(MAX_SOURCE_BYTES+1):JSON.stringify(records)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')interception.delay(5000);
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-shared-cftc-gate'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const sql of migrations)for(const statement of sql.split('--> statement-breakpoint').filter(value=>value.trim()))await db.prepare(statement.trim()).run();
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();
  for(const table of blockedGates.slice(1))await db.prepare(`UPDATE ${table} SET status='blocked'`).run();
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map(row=>row.name);
  const otherTables=tables.filter(name=>name!=='cftc_source_gate');
  const previous=await Promise.all(otherTables.map(table=>db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all()));
  await fn(mf,db,()=>calls,value=>{mode=value;});
  for(let i=0;i<otherTables.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM "${otherTables[i]}" ORDER BY 1`).all()).results,previous[i].results,`${otherTables[i]} must be unchanged`);

 }
 finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br','four-periods'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].current.open_interest,1000);assert.equal(body.snapshot.rows.length,52);assert.equal(body.snapshot.source_released_at,null);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms FROM cftc_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+3_590_000);
 await db.prepare("UPDATE cftc_source_gate SET payload='{}' WHERE id='legacy_futures'").run();
 const corrupt=await (await mf.getWorker('cold')).fetch(url);assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).status.error_code,'source_gate_unavailable');assert.equal(calls(),1);
 console.log(`PASS checked-in Cftc host ${encoding}; balanced contract positions; distinct cold-worker shared cache and cooldown; all prior gates untouched`);
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'unavailable');
 const row=await db.prepare('SELECT status,not_before_ms FROM cftc_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+7_190_000);
 await (await mf.getWorker('cold')).fetch(url);assert.equal(calls(),1);console.log('PASS temporary 2h Retry-After persists across workers');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 const warm=await mf.dispatchFetch(url);assert.equal(warm.status,200);assert.ok((await db.prepare('SELECT payload FROM cftc_source_gate').first()).payload);
 // Test-only scheduling change in the isolated synthetic DB, never production.
 await db.prepare('UPDATE cftc_source_gate SET not_before_ms=0').run();setMode('denied');
 const other=await (await mf.getWorker('cold')).fetch(url);assert.equal((await other.json()).status.state,'denied');
 assert.equal((await db.prepare('SELECT payload FROM cftc_source_gate').first()).payload,null);
 const previouslyWarm=await mf.dispatchFetch(url);const result=await previouslyWarm.json();assert.equal(result.status.state,'denied');assert.equal(result.snapshot,null);assert.equal(calls(),2);
 console.log('PASS denial atomically clears previous shared report and invalidates warm-worker evidence');
});
await scenario('denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),1);
 const blocked=await db.prepare('SELECT status,payload FROM cftc_source_gate').first();assert.equal(blocked.status,'blocked');assert.equal(blocked.payload,null);console.log('PASS denial persists across workers; no fallback requests');
});
await scenario('disconnect',async(mf,db,calls)=>{
 // Miniflare's proxy does not forward Node-client socket cancellation. Abort
 // explicitly after the HTTP response ends to verify native retained cleanup.
 const early=await mf.dispatchFetch('https://test.invalid/offline/cancel-after-response');assert.equal(early.status,202);await early.text();
 const waitFor=async(check,message)=>{const until=Date.now()+3000;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(message);};
 await waitFor(()=>calls()===1,'synthetic source did not start');
 assert.equal((await db.prepare('SELECT status FROM cftc_source_gate').first()).status,'busy');
 await (await mf.dispatchFetch('https://test.invalid/offline/abort')).text();
 await waitFor(async()=> (await db.prepare('SELECT status FROM cftc_source_gate').first()).status==='idle','canceled request must retain its exact lease release');
 const gate=await db.prepare('SELECT status,lease_token,payload,not_before_ms-updated_ms AS cooldown_ms FROM cftc_source_gate').first();
 assert.equal(gate.lease_token,null);assert.equal(gate.payload,null);assert.equal(gate.cooldown_ms,3600000);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,503);assert.equal((await cold.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 console.log('PASS abort after HTTP response retains owned D1 cleanup; distinct cold worker respects cooldown');
});
const legacySnapshot=()=>{
 const stamp=new Date().toISOString(),current=parseCftc(fixture,stamp,stamp);
 return {...current,schema:'cftc-legacy-futures/1',coverage:'four_selected_us_cftc_futures_markets',rows:current.rows.filter(row=>LEGACY_CONTRACT_CODES.includes(row.code))};
};
await scenario('plain',async(mf,db,calls)=>{
 const legacy=legacySnapshot(),payload=JSON.stringify(legacy),retry=Date.now()+3600000;
 await db.prepare('UPDATE cftc_source_gate SET payload=?,not_before_ms=?').bind(payload,retry).run();
 const before=await db.prepare('SELECT * FROM cftc_source_gate').first();
 const cached=await(await mf.dispatchFetch(url)).json();assert.deepEqual(cached.snapshot,legacy);assert.equal(calls(),0);
 assert.deepEqual(await db.prepare('SELECT * FROM cftc_source_gate').first(),before);
 await db.prepare('UPDATE cftc_source_gate SET not_before_ms=0').run();
 const upgraded=await(await (await mf.getWorker('cold')).fetch(url)).json();assert.equal(upgraded.snapshot.schema,'cftc-legacy-futures/2');assert.equal(upgraded.snapshot.rows.length,52);assert.equal(calls(),1);
 console.log('PASS exact legacy-cache cooldown reuse then full 52-market upgrade without relabeling');
});
for(const mode of ['missing','imbalance','prior-date','wrong-units','oversized'])await scenario(mode,async(mf,db,calls)=>{
 const legacy=legacySnapshot();await db.prepare('UPDATE cftc_source_gate SET payload=?').bind(JSON.stringify(legacy)).run();
 const result=await(await mf.dispatchFetch(url)).json();assert.deepEqual(result.snapshot,legacy);assert.equal(result.status.state,'stale');
 const retained=await db.prepare('SELECT status,payload,not_before_ms FROM cftc_source_gate').first();assert.equal(retained.status,'idle');assert.deepEqual(JSON.parse(retained.payload),legacy);assert.ok(retained.not_before_ms>Date.now()+3590000);
 const cold=await(await (await mf.getWorker('cold')).fetch(url)).json();assert.deepEqual(cold.snapshot,legacy);assert.equal(calls(),1);
 console.log(`PASS ${mode} expansion rejects the whole candidate and preserves exact legacy evidence/cooldown`);
});
for(const state of ['busy','blocked'])await scenario('plain',async(mf,db,calls)=>{
 const legacy=legacySnapshot();await db.prepare('UPDATE cftc_source_gate SET status=?,payload=?,lease_token=?').bind(state,JSON.stringify(legacy),state==='busy'?'unchanged-owned':null).run();
 const before=await db.prepare('SELECT * FROM cftc_source_gate').first();
 const result=await(await mf.dispatchFetch(url)).json();assert.equal(calls(),0);assert.deepEqual(await db.prepare('SELECT * FROM cftc_source_gate').first(),before);
 if(state==='blocked'){assert.equal(result.snapshot,null);assert.equal(result.status.state,'denied');}
 else assert.deepEqual(result.snapshot,legacy);
 console.log(`PASS legacy schema does not reset or bypass existing ${state} gate`);
});
console.log(`PASS all ${migrationNames.length} migrations applied; all 20 unrelated data tables preserved per scenario`);
console.log('PASS zero real network calls; no captured provider observations');
