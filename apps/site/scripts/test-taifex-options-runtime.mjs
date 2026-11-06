/** Native workerd + actual D1/SQLite. Synthetic fixtures only; external networking disabled. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';

const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wr('miniflare'),{build}=wr('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const bundled=await build({stdin:{contents:`
 import {taifexPayload} from './tests/taifex-options-fixture';
 import {TAIFEX_URL} from './lib/options/taifex/adapter';
 export {taifexPayload,TAIFEX_URL};
 `,resolveDir:root,sourcefile:'offline-taifex-fixture.ts'},bundle:true,format:'esm',platform:'node',target:'es2022',write:false});
const {taifexPayload,TAIFEX_URL}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {outputFiles}=await build({stdin:{contents:`
 import {waitUntil} from 'cloudflare:workers';
 import {taifexHandler} from './lib/options/taifex/host';
 import {createTaifexHandler} from './lib/options/taifex/handler';
 import {D1TaifexGate,TAIFEX_SQL} from './lib/options/taifex/source-gate';
 let abort,earlyResult=null;
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function faultHandler(env,fault){
  const db={prepare(sql){return {bind(...values){return {async run(){
   if(fault==='finish-late'&&sql===TAIFEX_SQL.finish)await pause(2500);
   if(fault==='inspect-unavailable'&&sql===TAIFEX_SQL.inspect)throw new Error('synthetic D1 unavailable');
   const result=await env.DB.prepare(sql).bind(...values).run();
   if(fault==='acquire-late'&&sql===TAIFEX_SQL.acquire)await pause(750);
   return result;
  }}}}}};
  return createTaifexHandler({gate:new D1TaifexGate(db),waitUntil});
 }
 export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/offline/abort'){abort?.();return new Response('synthetic cancellation');}
  if(path==='/offline/result')return Response.json(earlyResult);
  if(path==='/offline/early'){
   const controller=new AbortController();void new Promise(resolve=>{abort=resolve;}).then(()=>controller.abort());
   const handler=request.headers.has('x-offline-fault')?faultHandler(env,request.headers.get('x-offline-fault')):taifexHandler;
   void handler(new Request(new URL('/api/v1/options/taifex/snapshot',request.url),{signal:controller.signal})).then(async r=>{earlyResult=await r.json();});
   for(let i=0;i<100;i++){
    const row=await env.DB.prepare('SELECT status FROM taifex_options_gate').first();
    if(row.status==='busy')return new Response('response ended before owned work',{status:202});
    await pause(10);
   }
   return new Response('synthetic acquisition did not start',{status:500});
  }
  const fault=request.headers.get('x-offline-fault');
  return (fault?faultHandler(env,fault):taifexHandler)(request);
 }};`,resolveDir:root,sourcefile:'offline-taifex-host.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migrationName='0023_taifex_options_gate.sql';
const migration=await readFile(new URL('../drizzle/'+migrationName,import.meta.url),'utf8');
const priorMigrations=(await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>/^\d{4}.*\.sql$/.test(name)&&name<migrationName).sort();
assert.ok(priorMigrations.includes('0022_deribit_options_gate.sql'),'apply the complete prior migration chain, including Deribit');
const url='https://app.invalid/api/v1/options/taifex/snapshot';
const statusUrl=url.replace('/snapshot','/status');
const HOUR=3_600_000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function apply(db,sql){for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();}
async function row(db){return await db.prepare("SELECT * FROM taifex_options_gate WHERE id='daily_institutions'").first();}
async function until(check,message,attempts=150){for(let i=0;i<attempts;i++){const result=await check();if(result)return result;await pause(20);}assert.fail(message);}

async function scenario(initial,fn){
 let mode=initial,calls=0;const mock=createFetchMock();mock.disableNetConnect();
 // Date is always yesterday in Taipei, not a captured or permanently aging market observation.
 const reportDate=new Date(Date.now()+8*HOUR-24*HOUR).toISOString().slice(0,10);
 const payload=taifexPayload().map(row=>({...row,Date:reportDate.replaceAll('-','')}));
 const source=new URL(TAIFEX_URL);
 const responseForMode=()=>{
  calls++;
  if(mode==='403'||mode==='429')return {statusCode:Number(mode),data:'synthetic denied'};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'7200'}}};
  if(mode==='html')return {statusCode:200,data:'<html>synthetic challenge</html>',responseOptions:{headers:{'content-type':'text/html'}}};
  if(mode==='json-html')return {statusCode:200,data:'<html>synthetic challenge</html>',responseOptions:{headers:{'content-type':'application/octet-stream'}}};
  // JSON compressed responses work through fetchMock. Compressed octet-stream
  // responses use the raw offline outbound handler below, avoiding the observed
  // decompression failure in fetchMock's Node-to-workerd response forwarding.
  const encoding=mode.split('-')[0];
  const raw=Buffer.from(JSON.stringify(payload)),encoded=encoding==='gzip'?gzipSync(raw):encoding==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':['json','gzip','br'].includes(mode)?'application/json':'application/octet-stream','content-length':String(encoded.length),...(['gzip','br'].includes(encoding)?{'content-encoding':encoding}:{})}}};
 };
 const interception=mock.get(source.origin).intercept({method:'GET',path:source.pathname,headers:{accept:'application/json'}}).reply(responseForMode).persist();
 if(initial==='disconnect')interception.delay(5000);
 // This callback can only return synthetic bytes for the one fixed source URL.
 // Every other request throws; no default external network route is available.
 const egress=initial.endsWith('-octet')?{outboundService:request=>{
  assert.equal(request.url,TAIFEX_URL);assert.equal(request.method,'GET');assert.equal(request.headers.get('accept'),'application/json');
  const r=responseForMode();return new Response(r.data,{status:r.statusCode,headers:r.responseOptions?.headers});
 }}:{fetchMock:mock};
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-taifex'},...egress});
 const mf=new Miniflare({workers:['warm','cold','refresh','observer'].map(worker)});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const name of priorMigrations)await apply(db,await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const tableSchema=(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
  const tables=tableSchema.map(table=>table.name);
  // Seed stopped providers, independent leases/cooldowns, and cache sentinels in this ephemeral DB only.
  for(const table of tables.filter(name=>name.endsWith('_gate')&&name!=='ashare_source_gate')){
   await db.prepare(`UPDATE ${table} SET status='blocked',lease_token=NULL`).run();
  }
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',lease_token=NULL,reason_code='http_403'").run();
  await db.prepare("UPDATE deribit_options_gate SET status='busy',lease_token='synthetic-deribit-owner',payload=?,updated_ms=123,not_before_ms=456").bind('{"synthetic":"existing Deribit cache must remain byte-for-byte intact"}').run();
  await db.prepare("INSERT INTO tic_snapshot_cache (id,payload,version,last_attempt_ms,last_success_ms,error,lease_until_ms,lease_token) VALUES ('synthetic-preserve','{}','synthetic',1,2,'synthetic',3,'existing-owner')").run();
  await db.prepare("INSERT INTO ashare_snapshot_cache VALUES ('level1',1,'{}',1,86400001)").run();
  await db.prepare("INSERT INTO ashare_staged_acquisitions VALUES ('level1',1,'{}',1,2,180001)").run();
  await db.prepare("INSERT INTO kraken_snapshot_cache VALUES ('00000000-0000-4000-8000-000000000001',1,'{}',1,900001)").run();
  await db.prepare("INSERT INTO kraken_snapshot_refs VALUES ('latest','00000000-0000-4000-8000-000000000001')").run();
  const before=await Promise.all(tables.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
  const schemaBefore=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
  await apply(db,migration);
  assert.deepEqual(await row(db),{id:'daily_institutions',status:'idle',lease_token:null,payload:null,updated_ms:0,not_before_ms:0});
  const warm=await mf.getWorker('warm'),cold=await mf.getWorker('cold'),refresh=await mf.getWorker('refresh'),observer=await mf.getWorker('observer');
  await fn({mf,db,warm,cold,refresh,observer,calls:()=>calls,setMode:value=>{mode=value;},reportDate});
  for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${tables[i]} ORDER BY 1`).all()).results,before[i].results,`${tables[i]} rows remain exact`);
  const schemaAfter=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND tbl_name!='taifex_options_gate' ORDER BY type,name").all()).results;
  assert.deepEqual(schemaAfter,schemaBefore,'all prior tables, indexes and triggers remain exact');
 }finally{await mf.dispose();await mock.close();}
}

for(const encoding of ['plain','json','gzip','br','gzip-octet','br-octet'])await scenario(encoding,async({db,warm,cold,refresh,calls,reportDate})=>{
 const untouched=await row(db);assert.equal((await warm.fetch(statusUrl)).status,200);assert.deepEqual(await row(db),untouched);assert.equal(calls(),0);
 const response=await warm.fetch(url),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(response.headers.get('cache-control'),'no-store');
 const snapshot=body.snapshot;assert.equal(snapshot.rows.length,30);assert.equal(snapshot.report_date,reportDate);assert.equal(snapshot.source_released_at,null);assert.equal(snapshot.frequency,'daily');assert.equal(snapshot.currency,'TWD');assert.equal(snapshot.source_unit,'thousand_TWD');assert.equal(snapshot.net_capital_flow,null);
 assert.deepEqual([snapshot.rows[0].buy_amount,snapshot.rows[0].sell_amount,snapshot.rows[0].reported_net_amount],[12000,9000,4000]);
 const accepted=await row(db);assert.equal(accepted.status,'idle');assert.equal(accepted.lease_token,null);assert.ok(accepted.not_before_ms>=accepted.updated_ms+HOUR);assert.deepEqual(JSON.parse(accepted.payload),snapshot);
 assert.deepEqual((await(await cold.fetch(url)).json()).snapshot,snapshot);assert.deepEqual((await(await warm.fetch(url)).json()).snapshot,snapshot);assert.equal(calls(),1,'cold and warm workers reuse exactly one hourly GET');
 const beforeStatus=await row(db);await cold.fetch(statusUrl);assert.deepEqual(await row(db),beforeStatus,'status must not mutate D1');
 // Simulate an unrelated in-flight acquisition, never expire or take over its ownership.
 await db.prepare("UPDATE taifex_options_gate SET status='busy',lease_token='synthetic-owner',updated_ms=0,not_before_ms=0").run();
 const busyBefore=await row(db);for(const worker of [warm,cold,refresh]){const r=await worker.fetch(url),body=await r.json();assert.equal(r.status,503);assert.equal(body.snapshot,null);assert.equal(body.status.error_code,'source_busy');}
 await warm.fetch(statusUrl);assert.deepEqual(await row(db),busyBefore);assert.equal(calls(),1);
 // Only the isolated test fixture advances the schedule. No production reset exists.
 await db.prepare("UPDATE taifex_options_gate SET status='idle',lease_token=NULL,not_before_ms=0").run();
 assert.equal((await refresh.fetch(url)).status,200);assert.equal(calls(),2);assert.ok((await row(db)).not_before_ms>Date.now()+HOUR-1000);
 console.log(`PASS ${encoding}: 30 rows, exact thousand-TWD conversion, daily date, shared hourly cache, read-only status, busy fail-closed, all prior tables unchanged`);
});

for(const mode of ['403','429','html','json-html'])await scenario(mode,async({db,warm,cold,calls})=>{
 const response=await warm.fetch(url),body=await response.json();assert.equal(response.status,503);assert.equal(body.status.state,'denied');assert.equal(body.snapshot,null);
 const blocked=await row(db);assert.equal(blocked.status,'blocked');assert.equal(blocked.payload,null);assert.equal(blocked.lease_token,null);
 assert.equal((await(await cold.fetch(url)).json()).status.state,'denied');await warm.fetch(statusUrl);assert.equal(calls(),1);assert.deepEqual(await row(db),blocked);
 console.log(`PASS ${mode}: persistent denial survives cold workers with no retry or fallback`);
});

await scenario('plain',async({db,warm,cold,calls})=>{
 await warm.fetch(url);const saved=await row(db);await db.prepare("UPDATE taifex_options_gate SET status='blocked',lease_token=NULL").run();
 const blocked=await row(db);assert.equal(blocked.payload,saved.payload);for(const worker of [warm,cold]){const r=await(await worker.fetch(url)).json();assert.equal(r.snapshot,null);assert.equal(r.status.state,'denied');}
 await cold.fetch(statusUrl);assert.equal(calls(),1);assert.deepEqual(await row(db),blocked,'already blocked rows are read-only, even with a legacy retained payload');
 console.log('PASS pre-existing blocked state suppresses warm and cold stale cache without resetting the gate');
});

for(const deniedMode of ['403','429','json-html'])await scenario('plain',async({db,warm,cold,observer,calls,setMode})=>{
 await warm.fetch(url);assert.ok((await row(db)).payload);await db.prepare('UPDATE taifex_options_gate SET not_before_ms=0').run();setMode(deniedMode);
 // The trigger rejects any non-atomic attempt to publish blocked state before clearing cache/lease.
 await db.prepare("CREATE TRIGGER offline_atomic_denial BEFORE UPDATE ON taifex_options_gate WHEN NEW.status='blocked' AND (NEW.payload IS NOT NULL OR NEW.lease_token IS NOT NULL) BEGIN SELECT RAISE(ABORT,'denial must atomically purge'); END").run();
 const response=await cold.fetch(url);assert.equal((await response.json()).status.state,'denied');const stopped=await row(db);assert.equal(stopped.status,'blocked');assert.equal(stopped.payload,null);assert.equal(stopped.lease_token,null);
 for(const worker of [warm,observer]){const body=await(await worker.fetch(url)).json();assert.equal(body.snapshot,null);assert.equal(body.status.state,'denied');}assert.equal(calls(),2);
 console.log(`PASS ${deniedMode}: denial atomically purges cached evidence and all warm-worker copies`);
});

await scenario('temporary',async({db,warm,cold,calls})=>{
 const r=await warm.fetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.error_code,'upstream_http');const after=await row(db);assert.equal(after.status,'idle');assert.equal(after.lease_token,null);assert.ok(after.not_before_ms>=after.updated_ms+2*HOUR);
 await cold.fetch(url);await cold.fetch(statusUrl);assert.equal(calls(),1);assert.deepEqual(await row(db),after);
 console.log('PASS two-hour Retry-After remains durable across cold workers');
});

await scenario('plain',async({db,warm,cold,calls})=>{
 await warm.fetch(url);const before=await row(db);const response=await cold.fetch(url,{headers:{'x-offline-fault':'inspect-unavailable'}});assert.equal(response.status,503);const body=await response.json();assert.equal(body.snapshot,null);assert.equal(body.status.error_code,'source_gate_unavailable');assert.equal(calls(),1);assert.deepEqual(await row(db),before);
 console.log('PASS unknown D1 inspection suppresses shared evidence without any source request or write');
});

await scenario('disconnect',async({db,warm,cold,calls})=>{
 const early=await warm.fetch('https://app.invalid/offline/early');assert.equal(early.status,202);await early.text();await until(()=>calls()===1,'synthetic source did not start');
 await warm.fetch('https://app.invalid/offline/abort');const cleaned=await until(async()=>{const r=await row(db);return r.status==='idle'&&r;},'aborted native request did not release its owned D1 lease',300);
 assert.equal(cleaned.lease_token,null);assert.equal(cleaned.payload,null);assert.ok(cleaned.not_before_ms>=cleaned.updated_ms+HOUR);await cold.fetch(url);assert.equal(calls(),1);
 console.log('PASS response-ended source cancellation retains exact owned D1 cleanup');
});

await scenario('plain',async({db,warm,cold,calls})=>{
 const early=await warm.fetch('https://app.invalid/offline/early',{headers:{'x-offline-fault':'acquire-late'}});assert.equal(early.status,202);await early.text();assert.equal((await row(db)).status,'busy');assert.equal(calls(),0);
 await warm.fetch('https://app.invalid/offline/abort');const cleaned=await until(async()=>{const r=await row(db);return r.status==='idle'&&r;},'late D1 acknowledgement did not clean its owned acquisition');
 assert.equal(cleaned.lease_token,null);assert.equal(cleaned.payload,null);assert.ok(cleaned.not_before_ms>=cleaned.updated_ms+HOUR);await cold.fetch(url);assert.equal(calls(),0);
 console.log('PASS late D1 acquisition acknowledgement cleans up after HTTP completion and abort, with zero source calls');
});

await scenario('temporary',async({db,warm,cold,calls})=>{
 const response=await warm.fetch(url,{headers:{'x-offline-fault':'finish-late'}});assert.equal(response.status,503);const body=await response.json();assert.equal(body.snapshot,null);assert.equal(body.status.error_code,'source_gate_outcome_unconfirmed');
 const outstanding=await row(db);assert.equal(outstanding.status,'busy');const busy=await(await cold.fetch(url)).json();assert.equal(busy.status.error_code,'source_busy');assert.equal(calls(),1);
 const cleaned=await until(async()=>{const r=await row(db);return r.status==='idle'&&r;},'late D1 release was dropped after response deadline');assert.equal(cleaned.lease_token,null);assert.equal(cleaned.payload,null);assert.ok(cleaned.not_before_ms>=cleaned.updated_ms+2*HOUR);assert.equal(calls(),1);
 console.log('PASS retained late D1 release settles after response deadline, with no retry or lease takeover');
});
console.log(`PASS ${priorMigrations.length} prior migrations and all original tables/Deribit rows preserved; every provider request mocked; no captured observations bundled`);
