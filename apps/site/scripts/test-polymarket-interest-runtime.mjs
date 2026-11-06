/** Synthetic workerd/D1 tests. Real external networking disabled. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wr('miniflare'),{build}=wr('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`import {polymarketHandler} from './lib/polymarket/host';
import {D1PolymarketGate} from './lib/polymarket/source-gate';
let priorInspect;
export default {async fetch(request,env){
 const path=new URL(request.url).pathname,gate=new D1PolymarketGate(env.DB);
 if(path==='/offline/save-inspect'){priorInspect=await gate.inspect('interest');return Response.json(priorInspect);}
 if(path==='/offline/admit-after-stale-inspect'){
  try{const lease=await gate.acquire(undefined,'interest');await gate.release(lease.token,{kind:'temporary_failure'});return Response.json({admitted:true,priorInspect});}
  catch(error){return Response.json({admitted:false,code:error.code,priorInspect});}
 }
 return polymarketHandler(request);
}};`,resolveDir:root,sourcefile:'oi-offline.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const initial=await readFile(new URL('../drizzle/0015_polymarket_market_cache.sql',import.meta.url),'utf8'),migration=await readFile(new URL('../drizzle/0021_polymarket_interest_cooldown.sql',import.meta.url),'utf8');
const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
const added=journal.entries.find(e=>e.tag==='0021_polymarket_interest_cooldown'),prior=journal.entries.filter(e=>e.idx<added.idx);
assert.ok(added.when>Math.max(...prior.map(e=>e.when)),'0021 timestamp must exceed all deployed migrations for Drizzle D1 admission');
const ids=['a','b','c'].map(x=>'0x'+x.repeat(64));
const market=(id,condition)=>({id,conditionId:condition,question:`Synthetic market ${id}`,active:true,closed:false,archived:false,acceptingOrders:true,outcomes:'["Yes","No"]',outcomePrices:'["0.6","0.4"]',volume24hr:100-Number(id),updatedAt:null,tags:[]});
async function scenario(name,fn,{size=3}={}){
 const mock=createFetchMock();mock.disableNetConnect();let gamma=0,oi=0,batch=0,mode='ok',lastPath='';
 const cohort=size===3?ids:Array.from({length:size},(_,i)=>'0x'+(i+1).toString(16).padStart(64,'0'));
 mock.get('https://gamma-api.polymarket.com').intercept({method:'GET',path:/^\/markets\?/}).reply(()=>{gamma++;batch=0;if(mode==='gamma_failure')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json'}}};return {statusCode:200,data:JSON.stringify(mode==='empty'?[market('1',null)]:cohort.map((id,i)=>market(String(i+1),id))),responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 mock.get('https://data-api.polymarket.com').intercept({method:'GET',path:/^\/v2\/oi\?/}).reply(r=>{oi++;batch++;lastPath=r.path;const selected=new URL(r.path,'https://data-api.polymarket.com').searchParams.get('condition').split(',');assert.ok(selected.length<=20);const data=size===3?[{condition_id:ids[1],value:0},{condition_id:ids[0],value:123.456789}]:selected.map((condition_id,i)=>({condition_id,value:i}));return {statusCode:mode==='denied'||mode==='second_denied'&&batch===2?403:mode==='temporary'||mode==='retry'||mode==='second_failure'&&batch===2?503:200,data:JSON.stringify({data}),responseOptions:{headers:{'content-type':'application/json',...(mode==='retry'?{'retry-after':'3600'}:{})}}};}).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'synthetic-interest'},fetchMock:mock});
 const mf=new Miniflare({workers:['warm','cold','third','fourth'].map(worker)});
 try{
  const db=await mf.getD1Database('DB','warm');for(const s of initial.split('--> statement-breakpoint'))await db.prepare(s.trim()).run();
  const before=await db.prepare('SELECT * FROM polymarket_source_gate').first();
  await db.prepare("UPDATE polymarket_source_gate SET status='blocked',lease_token=NULL,not_before_ms=123456,error_code='source_denied'").run();
  const sentinel=await db.prepare('SELECT * FROM polymarket_source_gate').first();
  for(const s of migration.split('--> statement-breakpoint'))await db.prepare(s.trim()).run();
  const after=await db.prepare('SELECT * FROM polymarket_source_gate').first();for(const key of Object.keys(sentinel))assert.deepEqual(after[key],sentinel[key]);assert.equal(after.interest_not_before_ms,0);assert.equal(after.lease_view,null);
  // Restore only the isolated synthetic fixture, never a production gate.
  await db.prepare('UPDATE polymarket_source_gate SET status=?,lease_token=?,not_before_ms=?,error_code=?').bind(before.status,before.lease_token,before.not_before_ms,before.error_code).run();
  const fetch=async(worker,view)=>{const r=await(await mf.getWorker(worker)).fetch(`https://test.invalid/api/v1/polymarket/snapshot?view=${view}`);return {code:r.status,...await r.json()};};
  const row=()=>db.prepare('SELECT * FROM polymarket_source_gate').first();
  const advanceShared=()=>db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0').run();
  const probe=async(worker,path)=>await(await(await mf.getWorker(worker)).fetch('https://test.invalid/offline/'+path)).json();
  await fn({fetch,probe,row,advanceShared,resetFixture:()=>db.prepare('UPDATE polymarket_source_gate SET not_before_ms=0,interest_not_before_ms=0').run(),saveFixture:value=>db.prepare('UPDATE polymarket_source_gate SET payload=?').bind(JSON.stringify(value)).run(),calls:()=>({gamma,oi}),path:()=>lastPath,setMode:v=>{mode=v;}});console.log('PASS '+name);
 }finally{await mf.dispose();await mock.close();}
}
await scenario('migration preserves stopped lease; two requests; cold-worker independent cooldowns',async({fetch,probe,row,advanceShared,calls,path})=>{
 const inspected=await probe('cold','save-inspect');assert.equal(inspected.retryAt,0);
 const r=await fetch('warm','interest');assert.equal(r.code,200,JSON.stringify(r));assert.equal(r.snapshot.currency,'USDC');assert.equal(r.snapshot.source_observed_at,null);assert.equal(r.snapshot.net_capital_flow,null);assert.equal(r.snapshot.rows.length,3);assert.deepEqual(r.snapshot.values,[{condition_id:ids[1],value:0},{condition_id:ids[0],value:123.456789}]);assert.deepEqual(calls(),{gamma:1,oi:1});assert.equal(new URL(path(),'https://data-api.polymarket.com').searchParams.get('condition'),ids.join(','));
 const gate=await row();assert.equal(gate.status,'idle');assert.equal(gate.lease_token,null);assert.equal(gate.lease_view,null);assert.ok(gate.interest_not_before_ms>Date.now()+290000);assert.ok(gate.not_before_ms>Date.now()+27000);assert.ok(gate.not_before_ms<Date.now()+31000);
 assert.equal((await fetch('cold','hot')).snapshot,null);await advanceShared();const admission=await probe('cold','admit-after-stale-inspect');assert.equal(admission.admitted,false);assert.equal(admission.code,'source_cooldown');assert.equal(admission.priorInspect.retryAt,0);const hot=await fetch('third','hot');assert.equal(hot.code,200);assert.equal(hot.snapshot.schema,'polymarket-gamma/hot/1');assert.deepEqual(calls(),{gamma:2,oi:1});assert.equal((await row()).interest_not_before_ms,gate.interest_not_before_ms);
 await advanceShared();assert.deepEqual((await fetch('fourth','interest')).snapshot,r.snapshot);assert.deepEqual(calls(),{gamma:2,oi:1});
});
await scenario('OI failure isolated in D1; hot resumes independently',async({fetch,row,advanceShared,calls,setMode})=>{
 setMode('temporary');assert.equal((await fetch('warm','interest')).status.error_code,'upstream_http');const gate=await row();assert.equal(gate.error_code,null);assert.equal(gate.interest_error_code,'upstream_http');assert.equal(gate.checked_ms,0);assert.ok(gate.interest_checked_ms>0);assert.ok(gate.interest_not_before_ms>Date.now()+290000);
 await advanceShared();setMode('ok');const hot=await fetch('cold','hot');assert.equal(hot.status.state,'available');assert.equal(hot.status.error_code,null);assert.equal((await fetch('third','interest')).status.error_code,'upstream_http');assert.deepEqual(calls(),{gamma:2,oi:1});
});
await scenario('Retry-After remains shared',async({fetch,row,calls,setMode})=>{setMode('retry');await fetch('warm','interest');const gate=await row();assert.ok(gate.not_before_ms>Date.now()+3590000);assert.ok(gate.interest_not_before_ms>Date.now()+3590000);await fetch('cold','hot');assert.deepEqual(calls(),{gamma:1,oi:1});});
await scenario('no eligible conditions never requests GLOBAL',async({fetch,row,advanceShared,calls,setMode})=>{setMode('empty');assert.equal((await fetch('warm','interest')).status.error_code,'no_eligible_conditions');assert.ok((await row()).interest_not_before_ms>Date.now()+290000);await advanceShared();await fetch('cold','interest');assert.deepEqual(calls(),{gamma:1,oi:0});});
await scenario('OI denial globally clears and stops warm/cold workers',async({fetch,row,advanceShared,calls,setMode})=>{await fetch('warm','hot');await advanceShared();setMode('denied');assert.equal((await fetch('cold','interest')).status.state,'denied');assert.equal((await row()).status,'blocked');assert.equal((await row()).payload,null);assert.equal((await fetch('warm','hot')).snapshot,null);assert.equal((await fetch('third','newest')).status.state,'denied');assert.deepEqual(calls(),{gamma:2,oi:1});});
await scenario('concurrent workers admit a single bounded acquisition',async({fetch,calls})=>{const results=await Promise.all([fetch('warm','interest'),fetch('cold','hot')]);assert.equal(results.filter(r=>r.snapshot!==null).length,1);assert.ok(calls().gamma===1);assert.ok(calls().oi<=1);assert.ok(results.some(r=>['source_busy','source_cooldown'].includes(r.status.error_code)));});
await scenario('same warm handler keeps OI failure count out of hot backoff',async({fetch,row,advanceShared,setMode,calls})=>{setMode('temporary');await fetch('warm','interest');await advanceShared();setMode('gamma_failure');const result=await fetch('warm','hot');assert.equal(result.status.error_code,'upstream_http');const gate=await row();assert.equal(gate.not_before_ms-gate.checked_ms,30000);assert.ok(gate.interest_not_before_ms>Date.now()+290000);assert.deepEqual(calls(),{gamma:2,oi:1});});
await scenario('40-market cohort, two batches, cold-worker reuse, unchanged five-minute cooldown',async({fetch,row,calls})=>{
 const first=await fetch('warm','interest');assert.equal(first.code,200,JSON.stringify(first));assert.equal(first.snapshot.schema,'polymarket-open-interest/2');assert.equal(first.snapshot.rows.length,40);assert.equal(first.snapshot.values.length,40);assert.equal(first.snapshot.batches.length,2);assert.deepEqual(first.snapshot.batches.map(b=>b.condition_ids.length),[20,20]);assert.equal(new Set(first.snapshot.batches.flatMap(b=>b.condition_ids)).size,40);assert.deepEqual(calls(),{gamma:1,oi:2});assert.deepEqual((await fetch('cold','interest')).snapshot,first.snapshot);assert.deepEqual(calls(),{gamma:1,oi:2});const gate=await row();assert.equal(gate.status,'idle');assert.equal(gate.lease_token,null);assert.ok(gate.interest_not_before_ms>Date.now()+290000);
},{size:60});
await scenario('later batch failure preserves full prior snapshot across cold workers',async({fetch,row,resetFixture,setMode,calls})=>{
 const first=await fetch('warm','interest'),prior=(await row()).payload;await resetFixture();setMode('second_failure');const failed=await fetch('cold','interest');assert.equal(failed.status.state,'stale');assert.deepEqual(failed.snapshot,first.snapshot);assert.equal((await row()).payload,prior);assert.equal((await row()).lease_token,null);assert.deepEqual((await fetch('third','interest')).snapshot,first.snapshot);assert.deepEqual(calls(),{gamma:2,oi:4});
},{size:60});
await scenario('legacy 20-market cache remains exact after later-batch failure',async({fetch,row,resetFixture,saveFixture,setMode,calls})=>{
 const first=await fetch('warm','interest');const old={...first.snapshot},batches=old.batches;delete old.batch_size;delete old.batches;const legacy={...old,schema:'polymarket-open-interest/1',sample_limit:20,rows:old.rows.slice(0,20),values:old.values.filter(v=>batches[0].condition_ids.includes(v.condition_id))};await saveFixture(legacy);const prior=(await row()).payload;await resetFixture();setMode('second_failure');const failed=await fetch('cold','interest');assert.equal(failed.status.state,'stale');assert.deepEqual(failed.snapshot,legacy);assert.equal((await row()).payload,prior);assert.deepEqual((await fetch('third','interest')).snapshot,legacy);assert.deepEqual(calls(),{gamma:2,oi:4});
},{size:60});
await scenario('later batch denial stops all cold and warm modes without partial publication',async({fetch,row,resetFixture,setMode,calls})=>{
 await fetch('warm','interest');await resetFixture();setMode('second_denied');const denied=await fetch('cold','interest');assert.equal(denied.status.state,'denied');assert.equal(denied.snapshot,null);assert.equal((await row()).payload,null);assert.equal((await row()).status,'blocked');assert.equal((await row()).lease_token,null);for(const view of ['interest','hot','newest'])assert.equal((await fetch('third',view)).snapshot,null);assert.deepEqual(calls(),{gamma:2,oi:4});
},{size:60});
console.log('PASS synthetic workerd/D1 OI checks; no real provider requests');
