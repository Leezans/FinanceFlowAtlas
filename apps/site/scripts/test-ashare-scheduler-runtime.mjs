/** Synthetic native scheduled events + real transactional D1. No real network,
 * accounts, credentials, deployment or production gate mutation. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=async contents=>(await build({stdin:{contents,resolveDir:root,sourcefile:'scheduler-native.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false})).outputFiles[0].text;
const script=await bundle("export {default} from './scheduler/worker';");
const visitorScript=await bundle("import {ashareHandler} from './lib/ashare/host';export default {fetch:ashareHandler};");
const migrations=await Promise.all(['0001_wild_jigsaw','0019_lean_golden_guardian','0012_ashare_shared_snapshots','0014_ashare_staged_acquisitions'].map(name=>readFile(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8')));
const schema=await readFile(new URL('../scheduler/schema.sql',import.meta.url),'utf8');
const statusSql=await readFile(new URL('../scheduler/status.sql',import.meta.url),'utf8');
const fields=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scenario({enabled='true',scopes='BK1216',mode='valid',total=1,migrate=true}={},run){
 const calls=[];
 const outboundService=request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://push2.eastmoney.com');assert.equal(url.pathname,'/api/qt/clist/get');assert.equal(request.method,'GET');
  const page=Number(url.searchParams.get('pn'));calls.push({page,at:Date.now(),scope:url.searchParams.get('fs')});
  if(mode!=='valid')return new Response('synthetic failure',{status:Number(mode),headers:{'content-type':'application/json','Retry-After':'900'}});
  const stock=url.searchParams.get('fs').startsWith('b:'),start=(page-1)*100;
  const rows=Array.from({length:Math.min(100,total-start)},(_,i)=>({f12:stock?String(total-start-i).padStart(6,'0'):'BK'+String(total-start-i).padStart(4,'0'),f14:'Synthetic '+i,...Object.fromEntries(fields.map(f=>[f,f==='f62'?10:1]))}));
  return new Response(JSON.stringify({rc:0,data:{total,diff:rows}}),{headers:{'content-type':'application/json'}});
 };
 const worker=(name,source=script)=>({name,modules:true,script:source,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'synthetic-scheduler'},bindings:{ASHARE_SCHEDULER_ENABLED:enabled,ASHARE_SCHEDULER_SCOPES:scopes},outboundService});
 const mf=new Miniflare({workers:[worker('first'),worker('cold'),worker('visitor',visitorScript)]});
 try{
  const db=await mf.getD1Database('DB','first');
  if(migrate){for(const migration of migrations)for(const sql of migration.split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();for(const sql of schema.split(';'))if(sql.trim())await db.prepare(sql).run();}
  const tick=async(time=Date.now(),name='first')=>{const worker=await mf.getWorker(name);const result=await worker.scheduled({scheduledTime:new Date(time),cron:'* * * * *'});assert.equal(result.outcome,'ok');};
  const job=()=>db.prepare('SELECT * FROM ashare_scheduler_job').first();
  const gate=()=>db.prepare('SELECT * FROM ashare_source_gate').first();
  const health=async()=> (await db.prepare(statusSql).all()).results;
  await run({mf,db,calls,tick,job,gate,health});
 }finally{await mf.dispose();}
}
await scenario({enabled:'false',migrate:false},async({mf,calls,tick,db})=>{
 await tick();assert.equal(calls.length,0);
 assert.equal((await mf.dispatchFetch('https://private.invalid/api/v1/ashare/snapshot')).status,404);
 assert.equal((await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ashare_%'").all()).results.length,0);
});
console.log('PASS disabled native scheduled handler does not touch storage/source; HTTP fetch remains 404');
await scenario({migrate:false},async({calls,tick})=>{await tick();assert.equal(calls.length,0);});
console.log('PASS missing schema fails closed without source requests');
await scenario({total:901},async({mf,db,calls,tick,job,gate,health})=>{
 const start=Date.now();const first=tick(start);while(calls.length===0)await sleep(10);
 // Same minute on another isolate cannot overlap the scheduled batch.
 await tick(start,'cold');
 const during=await (await mf.getWorker('visitor')).fetch('https://owner.invalid/api/v1/ashare/snapshot?scope=BK1216');
 assert.equal(during.status,503);assert.ok(['source_busy','collection_in_progress'].includes(during.headers.get('X-Ashare-Error-Code')));
 await first;assert.deepEqual(calls.map(c=>c.page),[1,2,3,4,5,6,7,8,9,10]);assert.equal((await gate()).status,'idle');
 let record=await job();assert.equal(record.status,'idle');assert.equal(record.last_code,'complete_snapshot');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM ashare_staged_acquisitions').first()).n,0);
 const snapshot=JSON.parse((await db.prepare('SELECT payload FROM ashare_snapshot_cache').first()).payload);assert.equal(snapshot.rows.length,901);
 await tick(start,'cold');assert.equal(calls.length,10,'same minute is idempotent even after completion');
 assert.ok((await health()).every(r=>['healthy','source_cooldown'].includes(r.health)));
 const firstAcquisition=(await db.prepare('SELECT last_acquisition_ms FROM ashare_scheduler_scope').first()).last_acquisition_ms;
 // A genuine wall-clock minute passes without a visitor. Trigger only native
 // scheduled events; neither browser polling nor a local production shell loop.
 await sleep(Math.max(0,start+61_000-Date.now()));
 await tick(Date.now(),'cold');
 assert.equal(calls.length,20,'a later native scheduled event refreshes with no visitors');
 assert.ok((await db.prepare('SELECT last_acquisition_ms FROM ashare_scheduler_scope').first()).last_acquisition_ms>firstAcquisition);
 for(let i=1;i<calls.length;i++)assert.ok(calls[i].at-calls[i-1].at>=2950,'source spacing was reduced');
 const same=await (await mf.getWorker('visitor')).fetch('https://owner.invalid/api/v1/ashare/snapshot?scope=BK1216');assert.equal(same.status,200);assert.equal((await same.json()).rows.length,901);assert.equal(calls.length,20,'owner handler reuses the exact primary D1 cache');
 await db.prepare('UPDATE ashare_scheduler_job SET last_seen_ms=last_seen_ms-240000').run();assert.equal((await health())[0].health,'tick_gap');
});
console.log('PASS native no-visitor minute refresh, 901 rows/10 pages, strict pacing, shared browser gate/cache, cold-isolate overlap/idempotency and tick-gap detection');
for(const mode of ['403','429'])await scenario({mode},async({calls,tick,job,gate})=>{
 await tick(Date.now()-60_000);assert.equal(calls.length,1);assert.equal((await gate()).status,'blocked');assert.equal((await job()).status,'stopped');
 await tick(Date.now(),'cold');assert.equal(calls.length,1,'refusal cannot be reset by another scheduled event');
});
console.log('PASS HTTP 403 and 429 persist in shared source gate and stop the scheduler across isolates');
await scenario({mode:'503'},async({calls,tick,job,gate,health})=>{
 await tick(Date.now()-60_000);assert.equal(calls.length,1);const state=await gate();assert.equal(state.status,'idle');assert.ok(state.not_before_ms>Date.now());
 await tick(Date.now(),'cold');assert.equal(calls.length,1);assert.equal((await job()).status,'idle');assert.ok((await health()).some(r=>r.health==='no_complete_snapshot'));
});
console.log('PASS temporary failure respects durable source cooldown; missing complete evidence is reported');
await scenario({scopes:'level1,BK0001'},async({calls,tick,job,db})=>{
 const now=Date.now();await tick(now-60_000);assert.equal(calls[0].scope,'b:BK0001');await sleep(3100);await tick(now,'cold');assert.equal(calls[1].scope,'m:90+s:2+f:!50');assert.equal((await job()).cursor,0);
 // Inject a simulated crashed job only in this synthetic DB. No production reset.
 await db.prepare("UPDATE ashare_scheduler_job SET status='busy',lease_token='synthetic-crash',last_started_ms=0").run();
 await tick(now,'cold');assert.equal(calls.length,2);assert.equal((await job()).lease_token,'synthetic-crash');
});
console.log('PASS bounded durable round-robin fairness and no takeover of crashed scheduler ownership');
await scenario({},async({calls,tick,job,db,health})=>{
 await db.prepare("UPDATE ashare_source_gate SET status='busy',lease_token='synthetic-source-crash',acquired_ms=0").run();
 await tick();assert.equal(calls.length,0);assert.equal((await job()).status,'stopped');assert.ok((await health()).some(r=>r.health==='source_outcome_unconfirmed'));
});
console.log('PASS source outcome uncertainty remains stopped; adapter cannot clear or steal its lease');
console.log('All events and providers were synthetic. No deployment, account binding, credential creation or live source access was performed.');
