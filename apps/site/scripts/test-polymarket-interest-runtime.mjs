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
async function scenario(name,fn){
 const mock=createFetchMock();mock.disableNetConnect();let gamma=0,oi=0,mode='ok',lastPath='';
 mock.get('https://gamma-api.polymarket.com').intercept({method:'GET',path:/^\/markets\?/}).reply(()=>{gamma++;if(mode==='gamma_failure')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json'}}};return {statusCode:200,data:JSON.stringify(mode==='empty'?[market('1',null)]:ids.map((id,i)=>market(String(i+1),id))),responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 mock.get('https://data-api.polymarket.com').intercept({method:'GET',path:/^\/v2\/oi\?/}).reply(r=>{oi++;lastPath=r.path;return {statusCode:mode==='denied'?403:mode==='temporary'||mode==='retry'?503:200,data:JSON.stringify({data:[{condition_id:ids[1],value:0},{condition_id:ids[0],value:123.456789}]}),responseOptions:{headers:{'content-type':'application/json',...(mode==='retry'?{'retry-after':'3600'}:{})}}};}).persist();
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
  await fn({fetch,probe,row,advanceShared,calls:()=>({gamma,oi}),path:()=>lastPath,setMode:v=>{mode=v;}});console.log('PASS '+name);
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
console.log('PASS synthetic workerd/D1 OI checks; no real provider requests');
