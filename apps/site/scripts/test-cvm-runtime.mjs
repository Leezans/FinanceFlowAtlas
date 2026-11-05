/** Native workerd, synthetic fixtures only. Every external network call is blocked. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {cvmHandler} from './lib/cvm/host';
 let releaseAbort;
 export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/offline/abort'){releaseAbort?.();return new Response('synthetic cancellation released');}
  if(path==='/offline/cancel-after-response'){
   const controller=new AbortController();
   void new Promise(resolve=>{releaseAbort=resolve;}).then(()=>controller.abort());
   void cvmHandler(new Request(new URL('/api/v1/brazil/cvm/snapshot',request.url),{signal:controller.signal})).then(response=>response.body?.cancel());
   // The read-only inspect precedes retention. Finish this synthetic request
   // only after admission, so the test specifically exercises owned cleanup.
   for(let i=0;i<100;i++){
    const row=await env.DB.prepare('SELECT status FROM cvm_source_gate').first();
    if(row.status==='busy')return new Response('synthetic early response',{status:202});
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   return new Response('synthetic acquisition did not start',{status:500});
  }
  return cvmHandler(request);
 }};`,resolveDir:root,sourcefile:'cvm-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers','node:*'],write:false});
const migration=await readFile(new URL('../drizzle/0009_cvm_monthly_fund_gate.sql',import.meta.url),'utf8');
const priorMigrations=await Promise.all(['0000_silly_ogun','0001_wild_jigsaw','0002_faithful_pyro','0003_brainy_donald_blake','0004_ecb_fx_gate','0005_cftc_futures_gate','0006_ecb_fx_shared_cache','0007_tpex_institutional_gate','0008_asean_fdi_gate'].map(name=>readFile(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8')));
const priorGates=['ashare_source_gate','sina_source_gate','kraken_source_gate','ecb_fx_source_gate','cftc_source_gate','tpex_source_gate','asean_source_gate'];
const url='https://test.invalid/api/v1/brazil/cvm/snapshot';
const {outputFiles:modelFiles}=await build({stdin:{contents:"export {sourceSelection} from './lib/cvm/transport';export {zip,header,row,confid,general,securities} from './tests/cvm-fixture';",resolveDir:root,sourcefile:'cvm-runtime-model.ts'},bundle:true,format:'esm',platform:'node',write:false});
const {sourceSelection,zip,header,row,confid,general,securities}=await import('data:text/javascript;base64,'+Buffer.from(modelFiles[0].text).toString('base64'));
const selection=sourceSelection(Date.now()),year=selection.period.slice(0,4),period=selection.period.replace('-',''),reportDate=new Date(Date.UTC(Number(year),Number(selection.period.slice(5,7)),0)).toISOString().slice(0,10);
const revise=s=>s.replaceAll('2026-09-30',reportDate).replaceAll('2026-01-01',`${year}-01-01`);
const fca=zip({[`fca_cia_aberta_geral_${year}.csv`]:revise(general),[`fca_cia_aberta_valor_mobiliario_${year}.csv`]:revise(securities)}),cda=zip({[`cda_fi_BLC_4_${period}.csv`]:header+revise(row()),[`cda_fi_CONFID_${period}.csv`]:revise(confid)});
const FLOW_URL=selection.cdaUrl,COMPANY_URL=selection.fcaUrl;
async function scenario(mode,fn){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 for(const target of [COMPANY_URL,FLOW_URL]){
 const interception=mock.get('https://dados.cvm.gov.br').intercept({method:'GET',path:new URL(target).pathname}).reply(()=>{
  calls++;if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/zip','retry-after':'172800'}}};
  const raw=Buffer.from(target===FLOW_URL?cda:fca),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/octet-stream',...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')interception.delay(5000);
 }
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-shared-cvm-gate'},...(['gzip','br'].includes(mode)?{outboundService:request=>{
  // Miniflare fetchMock uses undici.fetch, which decompresses but preserves
  // Content-Encoding. Its octet-stream bridge does not re-encode, causing
  // workerd to decompress twice. Deliver actual wire bytes directly instead.
  assert.equal(request.method,'GET');assert.ok([COMPANY_URL,FLOW_URL].includes(request.url),'unexpected outbound URL');
  calls++;const raw=Buffer.from(request.url===FLOW_URL?cda:fca);
  return new Response(mode==='gzip'?gzipSync(raw):brotliCompressSync(raw),{headers:{'content-type':'application/octet-stream','content-encoding':mode}});
 }}:{fetchMock:mock})});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const sql of priorMigrations)for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();
  for(const table of priorGates.slice(1))await db.prepare(`UPDATE ${table} SET status='blocked'`).run();
  const previous=await Promise.all(priorGates.map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  for(const statement of migration.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  await fn(mf,db,()=>calls,value=>{mode=value;});
  for(let i=0;i<priorGates.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${priorGates[i]}`).all()).results,previous[i].results,`${priorGates[i]} must be unchanged`);
 }
 finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].flow.net,999);assert.equal(body.snapshot.rows.length,2);assert.equal(body.snapshot.rows[1].flow,null);assert.equal(body.snapshot.counts.confidential_rows,1);assert.equal(body.snapshot.source_released_at,null);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(calls(),2);
 for(const [name,bytes] of Object.entries({cda,fca}))assert.equal(body.snapshot.source_sha256[name],createHash('sha256').update(bytes).digest('hex'),'source digest must match the decoded ZIP bytes');
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),2);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.equal(calls(),2);
 const row=await db.prepare('SELECT status,not_before_ms FROM cvm_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+86_390_000);
 await db.prepare("UPDATE cvm_source_gate SET payload='{}' WHERE id='monthly_fund_equity'").run();
 const corrupt=await (await mf.getWorker('cold')).fetch(url);assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).status.error_code,'source_gate_unavailable');assert.equal(calls(),2);
 console.log(`PASS checked-in Cvm host ${encoding}; exact industry join and actual purchase minus sale amounts; distinct cold-worker shared cache and cooldown; all prior gates untouched`);
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'unavailable');
 const row=await db.prepare('SELECT status,not_before_ms FROM cvm_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+172_790_000);
 await (await mf.getWorker('cold')).fetch(url);assert.equal(calls(),1);console.log('PASS temporary 2d Retry-After persists across workers');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 const warm=await mf.dispatchFetch(url);assert.equal(warm.status,200);assert.ok((await db.prepare('SELECT payload FROM cvm_source_gate').first()).payload);
 // Test-only scheduling change in the isolated synthetic DB, never production.
 await db.prepare('UPDATE cvm_source_gate SET not_before_ms=0').run();setMode('denied');
 const other=await (await mf.getWorker('cold')).fetch(url);assert.equal((await other.json()).status.state,'denied');
 assert.equal((await db.prepare('SELECT payload FROM cvm_source_gate').first()).payload,null);
 const previouslyWarm=await mf.dispatchFetch(url);const result=await previouslyWarm.json();assert.equal(result.status.state,'denied');assert.equal(result.snapshot,null);assert.equal(calls(),3);
 console.log('PASS denial atomically clears previous shared report and invalidates warm-worker evidence');
});
await scenario('denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),1);
 const blocked=await db.prepare('SELECT status,payload FROM cvm_source_gate').first();assert.equal(blocked.status,'blocked');assert.equal(blocked.payload,null);console.log('PASS denial persists across workers; no fallback requests');
});
await scenario('disconnect',async(mf,db,calls)=>{
 // Miniflare's proxy does not forward Node-client socket cancellation. Abort
 // explicitly after the HTTP response ends to verify native retained cleanup.
 const early=await mf.dispatchFetch('https://test.invalid/offline/cancel-after-response');assert.equal(early.status,202);await early.text();
 const waitFor=async(check,message)=>{const until=Date.now()+3000;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(message);};
 await waitFor(()=>calls()===1,'synthetic source did not start');
 assert.equal((await db.prepare('SELECT status FROM cvm_source_gate').first()).status,'busy');
 await (await mf.dispatchFetch('https://test.invalid/offline/abort')).text();
 await waitFor(async()=> (await db.prepare('SELECT status FROM cvm_source_gate').first()).status==='idle','canceled request must retain its exact lease release');
 const gate=await db.prepare('SELECT status,lease_token,payload,not_before_ms-updated_ms AS cooldown_ms FROM cvm_source_gate').first();
 assert.equal(gate.lease_token,null);assert.equal(gate.payload,null);assert.equal(gate.cooldown_ms,86400000);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,503);assert.equal((await cold.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 console.log('PASS abort after HTTP response retains owned D1 cleanup; distinct cold worker respects cooldown');
});
console.log('PASS zero real network calls; no captured provider observations');
