/** Offline native workerd + transactional D1. Outbound networking is denied. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
import {D1SourceGate} from './lib/ashare/source-gate';
import {D1SnapshotStore} from './lib/ashare/snapshot-store';
import {D1StageStore} from './lib/ashare/stage-store';
export default {async fetch(request,env){
 const input=await request.json(),gate=new D1SourceGate(env.DB);
 try{let result;
 if(input.action==='acquire')result=await gate.acquire('synthetic');
 else if(input.action==='release')result=await gate.release(input.token,input.outcome);
 else if(input.action==='commit')result=await new D1SnapshotStore(env.DB).commit(input.token,input.snapshot);
 else if(input.action==='stage')result=await new D1StageStore(env.DB).save(input.token,input.stage);
 return Response.json({ok:true,result});
 }catch(error){return Response.json({ok:false,code:error.code??error.message});}
}};`,resolveDir:root,sourcefile:'offline-backoff.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false});
const names=['first','second','third'];let outbound=0;
const mf=new Miniflare({workers:names.map(name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',d1Databases:{DB:'offline-backoff'},outboundService:()=>{outbound++;throw new Error('network forbidden');}}))});
try{
 const db=await mf.getD1Database('DB','first');
 for(const name of ['0001_wild_jigsaw','0012_ashare_shared_snapshots','0014_ashare_staged_acquisitions','0019_lean_golden_guardian']){
  const migration=await readFile(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8');
  for(const sql of migration.split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 }
 const fetchers=[(url,init)=>mf.dispatchFetch(url,init),...(await Promise.all(names.slice(1).map(name=>mf.getWorker(name)))).map(worker=>(url,init)=>worker.fetch(url,init))];
 const call=async(index,input)=>(await fetchers[index%3]('https://offline.invalid/',{method:'POST',body:JSON.stringify(input)})).json();
 const state=()=>db.prepare('SELECT * FROM ashare_source_gate').first();
 // Test-only clock advancement, never a production reset/reconciliation path.
 const elapse=()=>db.prepare('UPDATE ashare_source_gate SET not_before_ms=0').run();
 let old;
 for(let i=0;i<7;i++){
  await elapse();
  const race=await Promise.all([0,1,2].map(index=>call(index,{action:'acquire'})));
  assert.equal(race.filter(result=>result.ok).length,1);assert.ok(race.filter(result=>!result.ok).every(result=>result.code==='source_busy'));
  const lease=race.find(result=>result.ok).result;
  if(old){const before=await state();assert.equal((await call(i,{action:'release',token:old,outcome:{kind:'temporary_failure'}})).code,'source_stale_lease');assert.deepEqual(await state(),before);}
  assert.equal((await call(i,{action:'release',token:lease.token,outcome:{kind:'temporary_failure',reason:i===0?'private URL secret':'upstream_http'}})).ok,true);
  const row=await state();assert.equal(row.failure_count,Math.min(i+1,5));assert.equal(row.not_before_ms-row.finished_ms,[60000,120000,240000,480000,900000,900000,900000][i]);assert.equal(row.failure_code,i===0?'collection_failed':'upstream_http');assert.equal(row.last_failure_ms,row.finished_ms);
  const before=await state();assert.equal((await call(i+1,{action:'acquire'})).code,'source_cooldown');assert.deepEqual(await state(),before);old=lease.token;
 }
 console.log('PASS independent workers, atomic CAS contention, stale tokens, bounded 60/120/240/480/900s schedule and sanitized diagnostics');
 await elapse();let lease=(await call(0,{action:'acquire'})).result;
 assert.equal((await call(0,{action:'release',token:lease.token,outcome:{kind:'cancelled'}})).ok,true);
 assert.equal((await state()).failure_count,5);assert.equal((await state()).not_before_ms-(await state()).finished_ms,3000);
 const scope={kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'};
 // Scope comes from the same canonical parser used in production, below we derive it via known persisted fixture format.
 const fields=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'];
 const rows=Array.from({length:100},(_,i)=>({f12:String(200-i).padStart(6,'0'),f14:'Synthetic',...Object.fromEntries(fields.map(f=>[f,1]))}));
 await elapse();lease=(await call(1,{action:'acquire'})).result;
 const stage={scope,rows,source_total:101,page_count:1,started_at:new Date(lease.acquiredAtMs).toISOString(),updated_at:new Date(lease.acquiredAtMs).toISOString(),endpoint:'primary',redirect_count:0,bytes:20000};
 const staged=await call(1,{action:'stage',token:lease.token,stage});assert.equal(staged.ok,true,JSON.stringify(staged));assert.equal((await state()).failure_count,5);
 assert.equal((await state()).failure_code,'upstream_http');assert.equal((await state()).not_before_ms-(await state()).finished_ms,3000);
 await elapse();lease=(await call(2,{action:'acquire'})).result;
 const snapshot={scope,rows:[rows[0]],source_total:1,page_count:1,fetched_at:new Date().toISOString()};
 assert.equal((await call(2,{action:'commit',token:lease.token,snapshot})).ok,true);assert.equal((await state()).failure_count,0);assert.equal((await state()).failure_code,null);assert.equal((await state()).last_failure_ms,null);
 console.log('PASS cancellation and partial stages preserve history; atomic complete snapshot resets it and retains 3-second pacing');
 await elapse();lease=(await call(0,{action:'acquire'})).result;
 await db.prepare("CREATE TRIGGER fail_release BEFORE UPDATE ON ashare_source_gate WHEN OLD.status='busy' AND NEW.status='idle' BEGIN SELECT RAISE(ABORT,'offline fault'); END").run();
 assert.equal((await call(0,{action:'commit',token:lease.token,snapshot})).code,'source_gate_unavailable');assert.equal((await state()).status,'busy');
 await db.prepare('UPDATE ashare_source_gate SET acquired_ms=acquired_ms-180001').run();
 assert.equal((await call(1,{action:'acquire'})).code,'source_outcome_unconfirmed');
 await db.prepare('DROP TRIGGER fail_release').run();
 assert.equal((await call(0,{action:'release',token:lease.token,outcome:{kind:'denied',reason:'http_403'}})).ok,true);
 assert.equal((await call(2,{action:'acquire'})).code,'source_denied');assert.equal((await state()).reason_code,'http_403');
 assert.equal(outbound,0);console.log('PASS unknown completion remains busy and blocks retries; denial latch stays permanent; zero outbound calls');
}finally{await mf.dispose();}
