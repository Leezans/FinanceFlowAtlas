/** Native workerd/D1. Synthetic fixtures only; real external network is disabled. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {polymarketHandler} from './lib/polymarket/host';
 let releaseAbort;
 export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/offline/abort'){releaseAbort?.();return new Response('synthetic cancellation released');}
  if(path==='/offline/cancel-after-response'){
   const controller=new AbortController();
   void new Promise(resolve=>{releaseAbort=resolve;}).then(()=>controller.abort());
   void polymarketHandler(new Request(new URL('/api/v1/polymarket/snapshot',request.url),{signal:controller.signal})).then(response=>response.body?.cancel());
   for(let i=0;i<100;i++){
    const row=await env.DB.prepare('SELECT status FROM polymarket_source_gate').first();
    if(row.status==='busy')return new Response('synthetic early response',{status:202});
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   return new Response('synthetic admission did not start',{status:500});
  }
  return polymarketHandler(request);
 }};`,resolveDir:root,sourcefile:'polymarket-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migration=await readFile(new URL('../drizzle/0015_polymarket_market_cache.sql',import.meta.url),'utf8');
const {outputFiles:modelFiles}=await build({stdin:{contents:"export {MAX_CACHE_AGE_MS} from './lib/polymarket/model';export {fixture,market,snapshot} from './tests/polymarket-fixture';",resolveDir:root,sourcefile:'polymarket-runtime-model.ts'},bundle:true,format:'esm',platform:'node',write:false});
const {MAX_CACHE_AGE_MS,fixture,market,snapshot}=await import('data:text/javascript;base64,'+Buffer.from(modelFiles[0].text).toString('base64'));
const url='https://test.invalid/api/v1/polymarket/snapshot';
async function scenario(mode,fn){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 const interception=mock.get('https://gamma-api.polymarket.com').intercept({method:'GET',path:/^\/markets(?:\/keyset)?\?/}).reply(request=>{
  const hot=request.path.startsWith('/markets?');
  calls++;
  if(mode==='paged_denied'&&calls===2)return {statusCode:403,data:''};
  if(mode==='hot_denied'&&hot)return {statusCode:403,data:''};
  if(mode==='hot_temporary'&&hot)return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'3600'}}};
  if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='rate_denied')return {statusCode:429,data:''};
  if(mode==='challenge')return {statusCode:200,data:'<html>challenge</html>',responseOptions:{headers:{'content-type':'application/json'}}};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'3600'}}};
  const paged=mode.startsWith('paged');
  const tags=Array.from({length:20},(_,i)=>({slug:`tag-${String(i).padStart(2,'0')}`,label:'x'.repeat(190)}));
  const data=paged?Array.from({length:100},(_,i)=>market(String(1000-(calls-1)*100-i),mode==='paged_oversize'?{tags}:{})):fixture();for(const market of data)if(market.updatedAt)market.updatedAt=new Date(Date.now()-60_000).toISOString();
  const raw=Buffer.from(JSON.stringify(hot?data:{markets:data,...(paged?{next_cursor:`cursor-${calls}`}:{})})),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')interception.delay(5000);
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-shared-polymarket-gate'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold'),worker('virgin'),worker('fresh')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  // Independent sentinel proves the append-only migration never changes an
  // existing stopped source. All setup is isolated synthetic test state.
  await db.prepare('CREATE TABLE ashare_source_gate (id TEXT, status TEXT, lease_token TEXT)').run();
  await db.prepare("INSERT INTO ashare_source_gate VALUES ('single_upstream','blocked','synthetic-sentinel')").run();
  const before=(await db.prepare('SELECT * FROM ashare_source_gate').all()).results;
  for(const statement of migration.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  await fn(mf,db,()=>calls,value=>{mode=value;});
  assert.deepEqual((await db.prepare('SELECT * FROM ashare_source_gate').all()).results,before,'prior source stop must be unchanged');
 }finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows.length,3);assert.equal(body.snapshot.rows[0].outcomes[1].price,'0.65');assert.equal(body.snapshot.rows[1].volume_24h,0);assert.equal(body.snapshot.rows[2].volume_24h,null);assert.equal(body.snapshot.source_observed_at,null);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(body.snapshot.complete_universe,false);assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms,error_code FROM polymarket_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+27_000);assert.equal(row.error_code,null);
 await db.prepare("UPDATE polymarket_source_gate SET payload='{}'").run();
 const corrupt=await (await mf.getWorker('cold')).fetch(url);assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).status.error_code,'source_gate_unavailable');assert.equal(calls(),1);
 console.log(`PASS native Polymarket ${encoding}; shared cold cache/cooldown; explicit time semantics; strict corrupt-cache rejection`);
});
await scenario('paged',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows.length,500);assert.equal(body.snapshot.source_market_count,500);assert.deepEqual(body.snapshot.source_page_sizes,[100,100,100,100,100]);assert.equal(body.snapshot.has_more,true);assert.equal(body.snapshot.total_market_count,null);assert.equal(body.snapshot.complete_universe,false);assert.equal(calls(),5);assert.equal(new Set(body.snapshot.rows.map(row=>row.id)).size,500);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.equal((await cold.json()).snapshot.rows.length,500);assert.equal(calls(),5);assert.equal((await db.prepare('SELECT status FROM polymarket_source_gate').first()).status,'idle');console.log('PASS five native keyset pages, exact 500-market bounded sample, one lease and shared cooldown');
});
await scenario('paged_denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,503);assert.equal(body.snapshot,null);assert.equal(body.status.state,'denied');assert.equal(calls(),2);const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),2);assert.equal((await db.prepare('SELECT status,payload FROM polymarket_source_gate').first()).payload,null);console.log('PASS second-page denial discards all partial evidence and permanently stops across isolates');
});
await scenario('paged_oversize',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,503);assert.equal(body.snapshot,null);assert.equal(body.status.error_code,'snapshot_byte_budget');assert.equal(calls(),5);const row=await db.prepare('SELECT status,lease_token,payload FROM polymarket_source_gate').first();assert.equal(row.status,'idle');assert.equal(row.lease_token,null);assert.equal(row.payload,null);console.log('PASS oversized normalized snapshot releases exact lease before publication, without permanent busy state');
});
await scenario('temporary',async(mf,db,calls,setMode)=>{
 const legacy={...snapshot(),schema:'polymarket-gamma/1',sample_limit:200,ordering:'source_volume24hr_descending'};for(const key of ['total_market_count','pagination','source_page_count','source_page_sizes','stop_reason','has_more','grouping'])delete legacy[key];legacy.fetched_at=new Date(Date.now()-1000).toISOString();legacy.acquisition_started_at=legacy.fetched_at;for(const row of legacy.rows)row.source_record_updated_at=null;
 const raw=JSON.stringify(legacy);await db.prepare('UPDATE polymarket_source_gate SET payload=?,not_before_ms=0').bind(raw).run();const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200);assert.equal(body.status.state,'stale');assert.deepEqual(body.snapshot,legacy);assert.equal((await db.prepare('SELECT payload FROM polymarket_source_gate').first()).payload,raw);const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,legacy);assert.equal(calls(),1);
 await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();setMode('denied');const denied=await (await mf.getWorker('virgin')).fetch(url);assert.equal((await denied.json()).status.state,'denied');assert.equal((await db.prepare('SELECT payload FROM polymarket_source_gate').first()).payload,null);assert.equal(calls(),2);console.log('PASS native v1 source evidence preserved unchanged after keyset503 across cold workers; denial still clears all rows');
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'unavailable');
 const row=await db.prepare('SELECT status,not_before_ms,error_code FROM polymarket_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+3590_000);assert.equal(row.error_code,'upstream_http');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.error_code,'upstream_http');assert.equal(calls(),1);console.log('PASS temporary failure and Retry-After persisted across isolates');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 const warm=await mf.dispatchFetch(url);const initial=await warm.json();assert.equal(warm.status,200);
 await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();setMode('temporary');
 const transient=await (await mf.getWorker('cold')).fetch(url);const stale=await transient.json();assert.equal(transient.status,200);assert.equal(stale.status.state,'stale');assert.equal(stale.snapshot.fetched_at,initial.snapshot.fetched_at);assert.equal(stale.status.error_code,'upstream_http');assert.equal(calls(),2);
 const previous=await mf.dispatchFetch(url);assert.equal((await previous.json()).status.state,'stale');assert.equal(calls(),2);
 // Modify only the isolated test fixture to exercise independent expiry.
 const record=await db.prepare('SELECT payload FROM polymarket_source_gate').first(),payload=JSON.parse(record.payload);
 payload.fetched_at=new Date(Date.now()-MAX_CACHE_AGE_MS-5000).toISOString();payload.acquisition_started_at=payload.fetched_at;for(const row of payload.rows)row.source_record_updated_at=null;
 await db.prepare('UPDATE polymarket_source_gate SET payload=?').bind(JSON.stringify(payload)).run();
 // Expiry is checked in an isolate with no retained local snapshot.
 const expired=await (await mf.getWorker('virgin')).fetch(url);assert.equal(expired.status,503);assert.equal((await expired.json()).snapshot,null);assert.equal(calls(),2);
 // Existing handlers must obey an explicit shared busy state, even when warm.
 await db.prepare("UPDATE polymarket_source_gate SET status='busy',lease_token='synthetic-other-owner'").run();
 const busy=await mf.dispatchFetch(url);assert.equal(busy.status,503);assert.equal((await busy.json()).snapshot,null);assert.equal(calls(),2);
 console.log('PASS shared stale error/time preserved; independent cold expiry; busy suppresses warm evidence');
});
for(const denial of ['denied','rate_denied','challenge'])await scenario(denial,async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),1);
 const blocked=await db.prepare('SELECT status,payload FROM polymarket_source_gate').first();assert.equal(blocked.status,'blocked');assert.equal(blocked.payload,null);console.log(`PASS ${denial} persists across workers with no fallback`);
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 assert.equal((await mf.dispatchFetch(url)).status,200);
 await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();setMode('denied');
 const denied=await (await mf.getWorker('cold')).fetch(url);assert.equal((await denied.json()).status.state,'denied');
 assert.equal((await db.prepare('SELECT payload FROM polymarket_source_gate').first()).payload,null);
 const previous=await mf.dispatchFetch(url);assert.equal((await previous.json()).snapshot,null);assert.equal(calls(),2);console.log('PASS denial atomically erases cache and invalidates warm worker');
});
await scenario('disconnect',async(mf,db,calls)=>{
 const early=await mf.dispatchFetch('https://test.invalid/offline/cancel-after-response');assert.equal(early.status,202);await early.text();
 const waitFor=async(check,message)=>{const until=Date.now()+3000;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(message);};
 await waitFor(()=>calls()===1,'synthetic source did not start');
 await (await mf.dispatchFetch('https://test.invalid/offline/abort')).text();
 await waitFor(async()=> (await db.prepare('SELECT status FROM polymarket_source_gate').first()).status==='idle','cancellation must retain exact owned release');
 const gate=await db.prepare('SELECT status,lease_token,payload,not_before_ms-updated_ms AS cooldown_ms FROM polymarket_source_gate').first();
 assert.equal(gate.lease_token,null);assert.equal(gate.payload,null);assert.equal(gate.cooldown_ms,30_000);assert.equal(calls(),1);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,503);assert.equal(calls(),1);console.log('PASS cancellation after response retains exact lease cleanup and cold-worker cooldown');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 const newest=await (await mf.dispatchFetch(url+'?view=newest')).json();
 const waiting=await (await mf.getWorker('cold')).fetch(url+'?view=hot');assert.equal(waiting.status,503);assert.equal((await waiting.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();
 const hot=await (await (await mf.getWorker('virgin')).fetch(url+'?view=hot')).json();assert.equal(hot.snapshot.schema,'polymarket-gamma/hot/1');assert.equal(hot.snapshot.source_market_count,3);assert.equal(hot.snapshot.has_more,null);assert.equal(calls(),2);
 const cachedNewest=await (await (await mf.getWorker('cold')).fetch(url+'?view=newest')).json();assert.deepEqual(cachedNewest.snapshot,newest.snapshot);assert.equal(calls(),2);
 const raw=(await db.prepare('SELECT payload FROM polymarket_source_gate').first()).payload;assert.equal(JSON.parse(raw).schema,'polymarket-discovery/1');
 await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();setMode('hot_temporary');
 const failed=await (await (await mf.getWorker('fresh')).fetch(url+'?view=hot')).json();assert.equal(failed.status.state,'stale');assert.deepEqual(failed.snapshot,hot.snapshot);assert.equal((await db.prepare('SELECT payload FROM polymarket_source_gate').first()).payload,raw);assert.equal(calls(),3);
 console.log('PASS native hot/newest share one cooldown, retain separate timestamps and cold-cache evidence after hot503');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 await (await mf.dispatchFetch(url+'?view=newest')).json();await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();
 await (await (await mf.getWorker('cold')).fetch(url+'?view=hot')).json();await db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();setMode('hot_denied');
 const denied=await (await (await mf.getWorker('virgin')).fetch(url+'?view=hot')).json();assert.equal(denied.status.state,'denied');assert.equal((await db.prepare('SELECT payload FROM polymarket_source_gate').first()).payload,null);
 const warm=await (await mf.dispatchFetch(url+'?view=newest')).json();assert.equal(warm.snapshot,null);assert.equal(warm.status.state,'denied');assert.equal(calls(),3);console.log('PASS hot denial removes both modes and suppresses warm newest without any fallback');
});
console.log('PASS no real provider network calls or captured observations');
