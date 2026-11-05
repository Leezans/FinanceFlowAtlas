/** Native workerd with real shared SQLite/D1. Synthetic XML only; all real network disabled. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {fxService} from './lib/fx/host';
 import {waitUntil} from 'cloudflare:workers';
 import {createFxService} from './lib/fx/service';
 import {D1FxGate,FX_SQL} from './lib/fx/source-gate';
 import {serveFx} from './lib/fx/route';
 export default {async fetch(request,env){
  if(new URL(request.url).pathname==='/offline/end-early'){
   void serveFx(fxService).then(response=>response.body?.cancel());
   for(let i=0;i<100;i++){
    if((await env.DB.prepare('SELECT status FROM ecb_fx_source_gate').first()).status==='busy')return new Response('synthetic response ended',{status:202});
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   return new Response('synthetic acquisition did not start',{status:500});
  }
  const failure=request.headers.get('x-test-db-failure');
  if(!failure)return serveFx(fxService);
  const db={prepare(sql){return {bind(...values){return {async run(){
   if((failure==='acquire-late'&&sql===FX_SQL.acquire)||(failure==='finish-late'&&sql===FX_SQL.finish))await new Promise(resolve=>setTimeout(resolve,2100));
   if((failure==='inspect'&&sql===FX_SQL.inspect)||(failure==='finish'&&sql===FX_SQL.finish))throw new Error('synthetic D1 unavailable');
   const result=await env.DB.prepare(sql).bind(...values).run();
   if((failure==='acquire-uncertain'&&sql===FX_SQL.acquire)||(failure==='finish-uncertain'&&sql===FX_SQL.finish))throw new Error('synthetic lost commit acknowledgement');
   return result;
  }}}}}};
  return serveFx(createFxService(fetch,Date.now,new D1FxGate(db),waitUntil));
 }};`,resolveDir:root,sourcefile:'offline-fx-host.ts'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],target:'es2022',external:['cloudflare:workers'],write:false});
const migrations=[];
for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())migrations.push(await readFile(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));
const xml=Buffer.from(`<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube><Cube time="2020-01-02"><Cube currency="USD" rate="2.0000"/><Cube currency="CNY" rate="10.0000"/></Cube></Cube></gesmes:Envelope>`);
const url='https://offline.invalid/api/v1/fx/reference';
async function scenario(initialMode,fn){
 let calls=0,mode=initialMode;const mock=createFetchMock();mock.disableNetConnect();
 const interception=mock.get('https://www.ecb.europa.eu').intercept({method:'GET',path:'/stats/eurofxref/eurofxref-daily.xml'}).reply(()=>{
  calls++;const data=mode==='gzip'?gzipSync(xml):mode==='br'?brotliCompressSync(xml):mode==='invalid'?Buffer.from('<bad/>'):xml;
  const statusCode=['denied','response-ended-denied'].includes(mode)?403:mode==='legal'?451:mode==='temporary'?503:200;
  return {statusCode,data,responseOptions:{headers:{'content-type':mode==='xhtml'?'application/xhtml+xml':'text/xml',...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode.startsWith('response-ended'))interception.delay(500);
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'fx-shared'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const migration of migrations)for(const sql of migration.split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();
  const priorTables=['ashare_source_gate','sina_source_gate','kraken_source_gate'];
  if(await db.prepare("SELECT name FROM sqlite_master WHERE name='cftc_source_gate'").first())priorTables.push('cftc_source_gate');
  for(const table of priorTables.slice(1))await db.prepare(`UPDATE ${table} SET status='blocked'`).run();
  const priorRows=await Promise.all(priorTables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  const warm=await mf.getWorker('warm'),cold=await mf.getWorker('cold');
  await fn({db,warm,cold,calls:()=>calls,setMode:next=>{mode=next}});
  for(let i=0;i<priorTables.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${priorTables[i]}`).all()).results,priorRows[i].results,`${priorTables[i]} must remain unchanged`);
 }finally{await mf.dispose();await mock.close()}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async({db,warm,cold,calls})=>{
 const first=await warm.fetch(url),body=await first.json();assert.equal(first.status,200,JSON.stringify(body));assert.equal(first.headers.get('cache-control'),'private, no-store');assert.equal(body.snapshot.reference_date,'2020-01-02');assert.equal(body.snapshot.rates.length,2);assert.equal(body.snapshot.rates[1].per_eur,'2.0000');
 assert.equal((await warm.fetch(url)).status,200);assert.equal(calls(),1);
 const freshIsolate=await cold.fetch(url);assert.equal(freshIsolate.status,200);assert.deepEqual(await freshIsolate.json(),body);assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms FROM ecb_fx_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+3_590_000);
 console.log(`PASS FX ${encoding}: actual worker isolates share identical validated D1 cache and cooldown; exact source decimals; existing gates unchanged`);
});
for(const mode of ['invalid','temporary'])await scenario(mode,async({db,warm,cold,calls})=>{
 const first=await warm.fetch(url);assert.equal(first.status,503);assert.equal((await first.json()).snapshot,null);
 await cold.fetch(url);assert.equal(calls(),1);const row=await db.prepare('SELECT status,not_before_ms FROM ecb_fx_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+890_000);
 console.log(`PASS FX ${mode}: shared conservative failure cooldown`);
});
for(const mode of ['denied','legal','xhtml'])await scenario(mode,async({db,warm,cold,calls})=>{
 for(const worker of [warm,cold]){const response=await worker.fetch(url),body=await response.json();assert.equal(response.status,503);assert.equal(body.snapshot,null);assert.equal(body.source_state,'stopped');assert.equal(body.error_code,'source_stopped');}
 assert.equal(calls(),1);assert.equal((await db.prepare('SELECT status FROM ecb_fx_source_gate').first()).status,'blocked');
 console.log(`PASS FX ${mode}: persistent stop prevents another isolate fetching`);
});
await scenario('plain',async({db,warm,cold,calls,setMode})=>{
 assert.equal((await warm.fetch(url)).status,200);setMode('denied');
 // Synthetic clock advancement of the metadata cooldown only, never a blocked/busy reset.
 await db.prepare("UPDATE ecb_fx_source_gate SET not_before_ms=0 WHERE status='idle'").run();
 assert.equal((await cold.fetch(url)).status,503);assert.equal(calls(),2);
 const cached=await warm.fetch(url),body=await cached.json();assert.equal(cached.status,503);assert.equal(body.snapshot,null);assert.equal(body.source_state,'stopped');assert.equal(calls(),2);
 console.log('PASS FX warm cache cleared after another actual worker isolate records denial');
});
await scenario('plain',async({warm,cold,calls})=>{
 const response=await warm.fetch(url,{headers:{'x-test-db-failure':'inspect'}});assert.equal(response.status,503);assert.equal((await response.json()).snapshot,null);assert.equal(calls(),0);
 // A later healthy isolate may start only because no acquisition occurred.
 assert.equal((await cold.fetch(url)).status,200);assert.equal(calls(),1);
 console.log('PASS FX failed gate inspection never reaches provider');
});
await scenario('plain',async({db,warm,calls})=>{
 assert.equal((await warm.fetch(url)).status,200);await db.prepare('DROP TABLE ecb_fx_source_gate').run();
 const response=await warm.fetch(url);assert.equal(response.status,503);assert.equal((await response.json()).snapshot,null);assert.equal(calls(),1);
 console.log('PASS FX failed gate inspection suppresses warm cached values');
});
for(const failure of ['finish','acquire-uncertain'])await scenario('denied',async({db,warm,cold,calls})=>{
 const first=await warm.fetch(url,{headers:{'x-test-db-failure':failure}});assert.equal(first.status,503);assert.equal((await first.json()).snapshot,null);
 const expectedCalls=failure==='finish'?1:0;assert.equal(calls(),expectedCalls);
 assert.equal((await db.prepare('SELECT status FROM ecb_fx_source_gate').first()).status,'busy');
 const other=await cold.fetch(url);assert.equal(other.status,503);assert.equal((await other.json()).snapshot,null);assert.equal(calls(),expectedCalls);
 assert.equal((await db.prepare('SELECT status FROM ecb_fx_source_gate').first()).status,'busy');
 console.log(`PASS FX ${failure}: uncertain D1 outcome remains busy; no takeover or cold-isolate retry`);
});
await scenario('denied',async({db,warm,cold,calls})=>{
 const first=await warm.fetch(url,{headers:{'x-test-db-failure':'finish-uncertain'}});assert.equal(first.status,503);assert.equal((await first.json()).snapshot,null);
 assert.equal((await db.prepare('SELECT status FROM ecb_fx_source_gate').first()).status,'blocked');
 const other=await cold.fetch(url);assert.equal(other.status,503);assert.equal((await other.json()).source_state,'stopped');assert.equal(calls(),1);
 console.log('PASS FX lost denial commit acknowledgement: persisted blocked state survives another worker isolate');
});
for(const failure of ['finish','finish-uncertain'])await scenario('plain',async({db,warm,cold,calls})=>{
 const first=await warm.fetch(url,{headers:{'x-test-db-failure':failure}});assert.equal(first.status,503);assert.equal((await first.json()).snapshot,null);
 const row=await db.prepare('SELECT status,payload,expires_ms FROM ecb_fx_source_gate').first();
 const other=await cold.fetch(url);assert.equal(calls(),1);
 if(failure==='finish'){
  assert.equal(row.status,'busy');assert.equal(row.payload,null);assert.equal(row.expires_ms,0);assert.equal(other.status,503);assert.equal((await other.json()).snapshot,null);
 }else{
  assert.equal(row.status,'idle');assert.ok(row.expires_ms>Date.now());assert.equal(other.status,200);assert.deepEqual((await other.json()).snapshot,JSON.parse(row.payload));
 }
 console.log(`PASS FX ${failure}: snapshot publication and cooldown are atomic, including lost commit acknowledgement`);
});
await scenario('plain',async({db,warm,cold,calls,setMode})=>{
 const first=await (await warm.fetch(url)).json();const expiry=(await db.prepare('SELECT expires_ms FROM ecb_fx_source_gate').first()).expires_ms;
 await db.prepare("UPDATE ecb_fx_source_gate SET not_before_ms=0 WHERE status='idle'").run();setMode('temporary');
 const stale=await (await cold.fetch(url)).json();assert.equal(stale.source_state,'stale');assert.equal(stale.error_code,'source_unavailable');assert.deepEqual(stale.snapshot,first.snapshot);
 assert.deepEqual(await (await warm.fetch(url)).json(),stale);assert.equal(calls(),2);assert.equal((await db.prepare('SELECT expires_ms FROM ecb_fx_source_gate').first()).expires_ms,expiry);
 const old=structuredClone(first.snapshot);old.retrieved_at=new Date(Date.now()-7*86_400_000-1000).toISOString();
 await db.prepare('UPDATE ecb_fx_source_gate SET payload=?,expires_ms=?').bind(JSON.stringify(old),Date.parse(old.retrieved_at)+7*86_400_000).run();
 const expired=await cold.fetch(url);assert.equal(expired.status,503);assert.equal((await expired.json()).error_code,'cache_expired');assert.equal(calls(),2);
 assert.equal((await db.prepare('SELECT status FROM ecb_fx_source_gate').first()).status,'idle');
 console.log('PASS FX shared transient error and acquisition expiry preserve cooldown without renewing data or fetching');
});
for(const mode of ['response-ended','response-ended-denied'])await scenario(mode,async({db,warm,cold,calls})=>{
 const early=await warm.fetch('https://offline.invalid/offline/end-early');assert.equal(early.status,202);await early.text();
 const until=Date.now()+5000;
 let row;
 while(Date.now()<until){row=await db.prepare('SELECT status,lease_token,payload FROM ecb_fx_source_gate').first();if(row.status!=='busy')break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(calls(),1);assert.equal(row.lease_token,null);
 const other=await cold.fetch(url);const body=await other.json();
 if(mode==='response-ended'){assert.equal(row.status,'idle');assert.equal(other.status,200);assert.deepEqual(body.snapshot,JSON.parse(row.payload));}
 else{assert.equal(row.status,'blocked');assert.equal(row.payload,null);assert.equal(other.status,503);assert.equal(body.source_state,'stopped');}
 assert.equal(calls(),1);
 console.log(`PASS FX ${mode}: native waitUntil retains atomic success/denial after original HTTP response ends`);
});
for(const phase of ['acquire','finish'])await scenario('plain',async({db,warm,cold,calls})=>{
 const first=await warm.fetch(url,{headers:{'x-test-db-failure':`${phase}-late`}});assert.equal(first.status,503);assert.equal((await first.json()).error_code,'source_gate_unavailable');
 const until=Date.now()+3000;let row;
 while(Date.now()<until){row=await db.prepare('SELECT status,lease_token,checked_ms,payload FROM ecb_fx_source_gate').first();if(row.checked_ms>0)break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(row.status,'idle');assert.equal(row.lease_token,null);assert.ok(row.checked_ms>0);
 const other=await cold.fetch(url),body=await other.json();
 if(phase==='acquire'){assert.equal(other.status,503);assert.equal(row.payload,null);assert.equal(calls(),0);}
 else{assert.equal(other.status,200);assert.deepEqual(body.snapshot,JSON.parse(row.payload));assert.equal(calls(),1);}
 console.log(`PASS FX delayed ${phase} settles in native retained lifetime after HTTP timeout without retry`);
});
console.log('PASS FX all native SQLite/workerd tests; zero real networking or captured provider observations');
