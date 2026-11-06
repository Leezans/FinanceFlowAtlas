/** OFFLINE native workerd + real transactional D1. No provider networking.
 * Normal paced snapshot requests run across independently initialized isolates. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock,fetch:mockFetch}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`import {ashareHandler} from './lib/ashare/host';export default {fetch:ashareHandler};`,resolveDir:root,sourcefile:'offline-ashare-staged.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const clientBundle=await build({stdin:{contents:`export {runCollectionBatch} from './lib/ashare/collection-batch';export {consumeReply,emptyState} from './components/ashare/client';export {parseScope} from './lib/ashare/snapshot';`,resolveDir:root,sourcefile:'offline-batch-client.ts'},bundle:true,format:'esm',platform:'node',target:'es2022',write:false});
const {runCollectionBatch,consumeReply,emptyState,parseScope}=await import('data:text/javascript;base64,'+Buffer.from(clientBundle.outputFiles[0].text).toString('base64'));
const migrations=await Promise.all(['0001_wild_jigsaw','0019_lean_golden_guardian','0012_ashare_shared_snapshots','0014_ashare_staged_acquisitions'].map(name=>readFile(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8')));
const endpoint='https://offline.invalid/api/v1/ashare/snapshot?scope=BK1216';
const fields=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'];
const row=id=>({f12:String(id).padStart(6,'0'),f14:'Synthetic '+id,...Object.fromEntries(fields.map(f=>[f,f==='f62'?(id%2?-id:id):1]))});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(total,check,{redirect=false}={}){
 const calls=[];let mode='good';const mock=createFetchMock();mock.disableNetConnect();
 for(const hostname of ['push2.eastmoney.com','push2delay.eastmoney.com'])mock.get('https://'+hostname).intercept({method:'GET',path:/^\/api\/qt\/clist\/get\?/}).reply(options=>{
  const u=new URL(options.path,'https://'+hostname),page=Number(u.searchParams.get('pn'));calls.push({page,hostname,at:Date.now()});
  if(redirect&&hostname==='push2.eastmoney.com')return {statusCode:302,data:'',responseOptions:{headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}}};
  if(mode==='denied')return {statusCode:403,data:'',responseOptions:{headers:{'content-type':'application/json'}}};
  const count=mode==='drift'?total+1:total,start=(page-1)*100;
  return {statusCode:200,data:JSON.stringify({rc:0,data:{total:count,diff:Array.from({length:Math.min(100,count-start)},(_,i)=>row(count-start-i))}}),responseOptions:{headers:{'content-type':'application/json'}}};
 }).persist();
 const names=['first','second','third'],mf=new Miniflare({workers:names.map(name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-staged'},outboundService:request=>mockFetch(request,{dispatcher:mock,redirect:'manual'})}))});
 try{
  const db=await mf.getD1Database('DB','first');for(const migration of migrations)for(const sql of migration.split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
  const fetchers=[(url,init)=>mf.dispatchFetch(url,init),...(await Promise.all(names.slice(1).map(n=>mf.getWorker(n)))).map(worker=>(url,init)=>worker.fetch(url,init))];
  const gate=()=>db.prepare('SELECT * FROM ashare_source_gate').first();
  const stages=()=>db.prepare('SELECT * FROM ashare_staged_acquisitions').all();
  const snapshots=()=>db.prepare('SELECT * FROM ashare_snapshot_cache').all();
  const waitPacing=async()=>{const state=await gate();await sleep(Math.max(0,state.not_before_ms-Date.now()+100));};
  await check({db,fetchers,calls,gate,stages,snapshots,waitPacing,setMode:value=>{mode=value;}});
 }finally{await mf.dispose();await mock.close();}
}
await fixture(801,async({fetchers,calls,gate,stages,snapshots,waitPacing})=>{
 for(let part=0;part<2;part++){
  const response=await fetchers[part](endpoint);assert.equal(response.status,503,await response.clone().text());assert.equal((await response.json()).error_code,'collection_in_progress');
  assert.equal((await snapshots()).results.length,0);const stage=JSON.parse((await stages()).results[0].payload);assert.equal(stage.rows.length,(part+1)*300);assert.equal(stage.page_count,(part+1)*3);assert.equal(stage.endpoint,'primary');assert.equal((await gate()).status,'idle');await waitPacing();
 }
 const response=await fetchers[2](endpoint);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.equal(result.rows.length,801);assert.equal(new Set(result.rows.map(row=>row.f12)).size,801);assert.equal(result.source_total,801);assert.equal(result.page_count,9);assert.equal(result.source_observed_at,null);assert.equal(result.trade_date,null);assert.ok(Date.parse(result.collection_started_at)<Date.parse(result.fetched_at));
 assert.equal((await stages()).results.length,0);assert.equal((await snapshots()).results.length,1);assert.equal((await gate()).status,'idle');
 assert.deepEqual(calls.map(call=>call.page),[1,2,3,4,5,6,7,8,9]);for(let n=1;n<calls.length;n++)assert.ok(calls[n].at-calls[n-1].at>=2950,'source pacing not preserved');
 const cached=await fetchers[0](endpoint,{headers:{'if-none-match':response.headers.get('etag')}});assert.equal(cached.status,304);assert.equal(calls.length,9);
});
console.log('PASS native 801-stock / nine-page complete publication across three cold requests, durable partial prefixes, original clock and pacing');
for(const mode of ['drift','denied'])await fixture(401,async({fetchers,calls,gate,stages,snapshots,waitPacing,setMode})=>{
 const first=await fetchers[0](endpoint);assert.equal(first.status,503);assert.equal((await first.json()).error_code,'collection_in_progress');await waitPacing();setMode(mode);
 const next=await fetchers[1](endpoint);assert.equal(next.status,503);const code=(await next.json()).error_code;assert.ok(mode==='denied'?['source_denied','source_access_denied'].includes(code):code==='unstable_total',code);assert.equal((await snapshots()).results.length,0);
 assert.equal((await gate()).status,mode==='denied'?'blocked':'idle');assert.equal((await stages()).results.length,mode==='denied'?1:0);const count=calls.length;const later=await fetchers[2](endpoint);assert.equal(later.status,503);assert.equal(calls.length,count);
});
console.log('PASS native resumed drift discards partial evidence; observed denial persists before stage cleanup and prevents later requests');
await fixture(401,async({db,fetchers,calls,gate,stages,snapshots,waitPacing})=>{
 const first=await fetchers[0](endpoint);assert.equal(first.status,503);await first.text();await waitPacing();
 await db.prepare("CREATE TRIGGER offline_abort_final_release BEFORE UPDATE ON ashare_source_gate WHEN OLD.status='busy' AND NEW.status='idle' AND EXISTS (SELECT 1 FROM ashare_snapshot_cache) BEGIN SELECT RAISE(ABORT,'offline final publication fault'); END").run();
 const final=await fetchers[1](endpoint);assert.equal(final.status,503);assert.equal((await final.json()).error_code,'source_gate_release_unconfirmed');assert.equal((await snapshots()).results.length,0);assert.equal(JSON.parse((await stages()).results[0].payload).page_count,3);assert.equal((await gate()).status,'busy');
 const count=calls.length;const cold=await fetchers[2](endpoint);assert.equal(cold.status,503);assert.equal((await cold.json()).error_code,'source_busy');assert.equal(calls.length,count);
});
console.log('PASS native failed final commit rolls back snapshot, stage deletion and lease release; no retry after uncertain publication');

await fixture(512,async({fetchers,calls,gate,stages,snapshots})=>{
 const started=Date.now(),first=await fetchers[0](endpoint);
 assert.equal(first.status,503);assert.equal((await first.json()).error_code,'collection_in_progress');
 assert.equal((await snapshots()).results.length,0);assert.equal(JSON.parse((await stages()).results[0].payload).rows.length,300);
 // Follow only the endpoint's ordinary Retry-After, without manual inspection
 // pauses, clock rewrites, gate resets, background work or parallel requests.
 const retrySeconds=Number(first.headers.get('retry-after'));assert.ok(retrySeconds>=1&&retrySeconds<=3);
 await sleep(retrySeconds*1000+100);
 const final=await fetchers[1](endpoint);assert.equal(final.status,200,await final.clone().text());const snapshot=await final.json();
 assert.equal(snapshot.rows.length,512);assert.equal(new Set(snapshot.rows.map(row=>row.f12)).size,512);assert.equal(snapshot.page_count,6);
 assert.equal(snapshot.stale,false);assert.equal(snapshot.has_error,false);assert.equal(snapshot.source_observed_at,null);assert.equal(snapshot.trade_date,null);
 assert.deepEqual(calls.map(call=>call.page),[1,1,2,3,4,5,6]);for(let n=1;n<calls.length;n++)assert.ok(calls[n].at-calls[n-1].at>=2950,'source pacing not preserved');
 const seconds=Number(final.headers.get('x-ashare-refresh-after'));assert.ok(seconds>=1&&seconds<=60);
 const age=Date.now()-Date.parse(snapshot.collection_started_at);assert.ok(Math.abs(seconds*1000-(60000-age))<2000,'next check must use oldest-page age');
 assert.equal((await gate()).status,'idle');assert.equal((await stages()).results.length,0);assert.equal((await snapshots()).results.length,1);
 const cached=await fetchers[2](endpoint,{headers:{'if-none-match':final.headers.get('etag')}});assert.equal(cached.status,304);assert.ok(Number(cached.headers.get('x-ashare-refresh-after'))<=seconds);assert.equal(calls.length,7);
 console.log('PASS native 512-stock / six-page auto-continuation with one official redirect: '+(Date.now()-started)+'ms total; next check in '+seconds+'s; original timing and pacing preserved');
},{redirect:true});

// A future once-per-minute job must finish this finite operation rather than
// treating every partial acquisition as an ordinary minute cache check.
for(const total of [901,2000])await fixture(total,async({fetchers,calls,gate,stages,snapshots})=>{
 const started=Date.now(),scope=parseScope(new URL(endpoint));let state=emptyState(),index=0;
 const result=await runCollectionBatch({request:async signal=>{
  const response=await fetchers[index++%fetchers.length](endpoint,{signal});
  state=consumeReply(state,{status:response.status,payload:await response.json(),errorCode:response.headers.get('x-ashare-error-code')??undefined,recoveryMode:response.headers.get('x-ashare-recovery')??undefined,retryAfter:response.headers.get('retry-after')??undefined},scope);
  if(state.continuationAt!==undefined){assert.equal(state.snapshot,null);assert.equal((await snapshots()).results.length,0);}
  return state;
 }});
 assert.equal(result.reason,'response');assert.equal(result.requests,Math.ceil(Math.ceil(total/100)/3));assert.equal(result.value.snapshot.rows.length,total);assert.equal(result.value.snapshot.source_total,total);
 assert.equal(new Set(result.value.snapshot.rows.map(row=>row.f12)).size,total);assert.equal(result.value.snapshot.source_observed_at,null);assert.equal(result.value.snapshot.trade_date,null);
 assert.equal((await snapshots()).results.length,1);assert.equal((await stages()).results.length,0);assert.equal((await gate()).status,'idle');
 assert.deepEqual(calls.map(call=>call.page),Array.from({length:Math.ceil(total/100)},(_,i)=>i+1));for(let n=1;n<calls.length;n++)assert.ok(calls[n].at-calls[n-1].at>=2950,'source pacing not preserved');
 assert.ok(Date.parse(result.value.snapshot.fetched_at)-Date.parse(result.value.snapshot.collection_started_at)<180000);
 console.log('PASS finite driver with native workerd/D1: '+total+' complete synthetic rows, '+result.requests+' cold-worker requests, '+(Date.now()-started)+'ms, no partial publication');
});
