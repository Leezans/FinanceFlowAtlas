/** Native workerd/D1 tests, synthetic observations only, external network disabled. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),runtime=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=runtime('miniflare'),{build}=runtime('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`import {cboeHandler} from './lib/cboe/host';export default {fetch:cboeHandler};`,resolveDir:root},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
const migrations=await Promise.all(journal.entries.map(({tag})=>readFile(new URL(`../drizzle/${tag}.sql`,import.meta.url),'utf8')));
const now=new Date(),day=now.toISOString().slice(0,10),sourceMinute=new Date(Math.floor((Date.now()-20*60000)/60000)*60000).toISOString();
assert.equal(sourceMinute.slice(0,10),day,'Run this test after 00:20 UTC');
const digits=sourceMinute.slice(0,10).replaceAll('-','')+'_'+sourceMinute.slice(11,16).replace(':','');
const filename=`eqt_trade_BATE_${digits}.csv`,serveUrl=`https://cdn.cboe.com/data/europe/equities/delayed_data/eqt_trade_BATE/synthetic/minute/${filename}`;
const sourceTime=sourceMinute.slice(0,19).replace('T',' ')+'.123456';
const csv=`${sourceTime},GB0000000001,12.34,GBP,MONE,10,BATE,CLOB,${sourceTime},BATE,SYNTHETIC1,""\n`;
const path=`/europe/equities/transparency_data/get_file_map?category=equities&venue=bxe&trade_type=trade&date=${day}`;
const url='https://test.invalid/api/v1/europe/cboe/snapshot';
async function scenario(mode,check){
 let calls=0,csvCalls=0;const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://www-api.cboe.com').intercept({method:'GET',path}).reply(()=>{calls++;if(mode==='denied')return {statusCode:403,data:''};if(mode==='temporary')return {statusCode:503,data:'',responseOptions:{headers:{'retry-after':'3600'}}};return {statusCode:200,data:JSON.stringify({daily:[],minute:[{filename,serveUrl}]}),responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 mock.get('https://cdn.cboe.com').intercept({method:'GET',path:new URL(serveUrl).pathname}).reply(()=>{csvCalls++;return {statusCode:200,data:mode==='badcsv'?csv+'bad,row\n':mode==='empty'?csv.replace('SYNTHETIC1','EMPTY2').replace('""','"NPFT,NETW"'):mode==='cancel'?csv.replace('SYNTHETIC1','CANCEL2').replace('""','"CANC"'):csv,responseOptions:{headers:{'content-type':'text/csv'}}};}).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-cboe-shared-cache'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold'),worker('observer')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const sql of migrations.slice(0,-1))for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.map(row=>row.name);
  const before=await Promise.all(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  for(const statement of migrations.at(-1).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
  await check(mf,db,()=>calls,()=>csvCalls,next=>{mode=next;});
  for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${tables[i]}`).all()).results,before[i].results,`${tables[i]} untouched`);
 }finally{await mf.dispose();await mock.close();}
}
await scenario('plain',async(mf,db,calls,csvCalls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].price,'12.34');assert.equal(body.snapshot.sourceDelaySeconds,900);assert.equal(body.snapshot.netCapitalFlow,null);assert.equal(calls(),1);assert.equal(csvCalls(),1);
 const cold=await(await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.equal(calls(),1);assert.equal(csvCalls(),1);
 const gate=await db.prepare('SELECT status,not_before_ms FROM cboe_delayed_source_gate').first();assert.equal(gate.status,'idle');assert.ok(gate.not_before_ms>Date.now()+55000);
 await db.prepare('UPDATE cboe_delayed_source_gate SET payload=?').bind(JSON.stringify(body.snapshot)).run();
 const legacy=await(await(await mf.getWorker('observer')).fetch(url)).json();assert.deepEqual(legacy.snapshot,body.snapshot);assert.equal(legacy.latest_empty_check,null);assert.equal(calls(),1);
 await db.prepare("UPDATE cboe_delayed_source_gate SET payload='{}'").run();const corrupt=await(await mf.getWorker('cold')).fetch(url);assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).status.error_code,'source_gate_unavailable');assert.equal(calls(),1);
 console.log('PASS atomic shared snapshot, cold cache reuse, source timestamps, cooldown and corrupt-cache fail-closed');
});
await scenario('plain',async(mf,db,calls,csvCalls,setMode)=>{
 const first=await(await mf.dispatchFetch(url)).json();
 await db.prepare('UPDATE cboe_delayed_source_gate SET payload=?').bind(JSON.stringify(first.snapshot)).run();
 await db.prepare('UPDATE cboe_delayed_source_gate SET not_before_ms=0').run();setMode('empty');
 const retained=await(await(await mf.getWorker('cold')).fetch(url)).json();
 assert.equal(retained.status.state,'stale');assert.deepEqual(retained.snapshot,first.snapshot);assert.equal(retained.latest_empty_check.rows.length,0);
 assert.equal(calls(),2);assert.equal(csvCalls(),2);
 const observer=await(await(await mf.getWorker('observer')).fetch(url)).json();assert.deepEqual(observer.snapshot,retained.snapshot);assert.deepEqual(observer.latest_empty_check,retained.latest_empty_check);assert.equal(observer.status.state,'stale');assert.equal(calls(),2);
 const stored=JSON.parse((await db.prepare('SELECT payload FROM cboe_delayed_source_gate').first()).payload);
 assert.equal(stored.schema,'cboe-cache/1');assert.deepEqual(stored.snapshot,first.snapshot);assert.equal(stored.latestEmptyCheck.rows.length,0);
 await db.prepare("UPDATE cboe_delayed_source_gate SET status='blocked',payload=NULL").run();
 const blocked=await(await mf.dispatchFetch(url)).json();assert.equal(blocked.status.state,'denied');assert.equal(blocked.snapshot,null);assert.equal(blocked.latest_empty_check,null);assert.equal(calls(),2);
 console.log('PASS bounded eligible evidence across an empty window and cold worker; separate check clock; durable denial still clears all evidence');
});
await scenario('plain',async(mf,db,calls,csvCalls,setMode)=>{
 await mf.dispatchFetch(url);await db.prepare('UPDATE cboe_delayed_source_gate SET not_before_ms=0').run();setMode('cancel');
 const result=await(await(await mf.getWorker('cold')).fetch(url)).json();assert.equal(result.snapshot.rows.length,0);assert.equal(result.latest_empty_check,null);assert.equal(calls(),2);assert.equal(csvCalls(),2);
 console.log('PASS later cancellation clears previous prices instead of reviving them');
});
await scenario('temporary',async(mf,db,calls)=>{
 assert.equal((await mf.dispatchFetch(url)).status,503);const gate=await db.prepare('SELECT status,not_before_ms FROM cboe_delayed_source_gate').first();assert.equal(gate.status,'idle');assert.ok(gate.not_before_ms>Date.now()+3595000);await(await mf.getWorker('cold')).fetch(url);assert.equal(calls(),1);console.log('PASS durable Retry-After across workers');
});
await scenario('plain',async(mf,db,calls,csvCalls,setMode)=>{
 assert.equal((await mf.dispatchFetch(url)).status,200);await db.prepare('UPDATE cboe_delayed_source_gate SET not_before_ms=0').run();setMode('denied');const denied=await(await mf.getWorker('cold')).fetch(url);assert.equal((await denied.json()).status.state,'denied');const gate=await db.prepare('SELECT status,payload FROM cboe_delayed_source_gate').first();assert.equal(gate.status,'blocked');assert.equal(gate.payload,null);const warm=await(await mf.dispatchFetch(url)).json();assert.equal(warm.snapshot,null);assert.equal(warm.status.state,'denied');assert.equal(calls(),2);assert.equal(csvCalls(),1);console.log('PASS durable denial, no bypass/retry, warm rows cleared');
});
await scenario('plain',async(mf,db,calls)=>{
 await db.prepare("UPDATE cboe_delayed_source_gate SET status='busy',lease_token='another-worker'").run();const body=await(await mf.dispatchFetch(url)).json();assert.equal(body.snapshot,null);assert.equal(calls(),0);console.log('PASS busy gate fails closed without takeover');
});
await scenario('badcsv',async(mf,db,calls)=>{const body=await(await mf.dispatchFetch(url)).json();assert.equal(body.snapshot,null);assert.equal(body.status.error_code,'invalid_source_rows');assert.equal(calls(),1);console.log('PASS malformed cancellation risk rejects entire sample');});
console.log('PASS all prior tables and data unchanged; zero live network and no captured observations');

// Actual production host/handler, real wall clock and native fetch aborts.
// Deliberately omit enable_request_signal: no caller disconnect reaches work.
async function absentClientSignalDeadline(phase){
 let mapCalls=0,fileCalls=0;const mock=createFetchMock();mock.disableNetConnect();
 const mapReply=mock.get('https://www-api.cboe.com').intercept({method:'GET',path}).reply(()=>{mapCalls++;return {statusCode:200,data:JSON.stringify({daily:[],minute:[{filename,serveUrl}]}),responseOptions:{headers:{'content-type':'application/json'}}};});
 mapReply.delay(phase==='map'?25_000:12_000).persist();
 const fileReply=mock.get('https://cdn.cboe.com').intercept({method:'GET',path:new URL(serveUrl).pathname}).reply(()=>{fileCalls++;return {statusCode:200,data:csv,responseOptions:{headers:{'content-type':'text/csv'}}};});
 fileReply.delay(25_000).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:`offline-cboe-deadline-${phase}`},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold'),worker('observer')]});
 try{
  const db=await mf.getD1Database('DB','warm');for(const statement of migrations.at(-1).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
  const started=Date.now(),response=await mf.dispatchFetch(url),body=await response.json();
  const gate=await db.prepare('SELECT status,lease_token,payload,not_before_ms FROM cboe_delayed_source_gate').first(),elapsed=Date.now()-started;
  assert.equal(response.status,503,JSON.stringify(body));assert.equal(body.snapshot,null);assert.equal(body.status.error_code,'timeout');
  assert.ok(elapsed>=17_500&&elapsed<27_000,`native ${phase} deadline/cleanup took ${elapsed}ms`);
  assert.equal(gate.status,'idle');assert.equal(gate.lease_token,null);assert.equal(gate.payload,null);assert.ok(gate.not_before_ms>Date.now()+50_000);
  assert.equal(mapCalls,1);assert.equal(fileCalls,phase==='map'?0:1);
  const cold=await(await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).snapshot,null);assert.equal(mapCalls,1);assert.equal(fileCalls,phase==='map'?0:1);
  console.log(`PASS native absent-client-signal ${phase} stall: fetch abort settled and durable release in ${elapsed}ms (<27s), cold cooldown, no overlap`);
 }finally{await mf.dispose();await mock.close();}
}
await Promise.all(['map','file'].map(absentClientSignalDeadline));
