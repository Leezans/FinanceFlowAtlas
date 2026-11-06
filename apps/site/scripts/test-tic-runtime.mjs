/** Native workerd/D1 integration. All upstream responses are synthetic; outbound network is disabled. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=async contents=>(await build({stdin:{contents,resolveDir:root,sourcefile:'tic-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers','node:*'],write:false})).outputFiles[0].text;
const script=await bundle(`import {serveTic} from './lib/tic/route';import {serveTicHistory} from './lib/tic/history-route';export default {fetch(request){const path=new URL(request.url).pathname;return path.endsWith('/history')?serveTicHistory(request):serveTic(request,path.endsWith('/status')?'status':'snapshot')}};`);
const fixtures=await bundle("export {valid} from './tests/tic-fixture';export {SOURCE_URL} from './lib/tic/adapter';export {TIC_SOURCE_GATE_KEY} from './lib/tic/source-gate';");
const {valid,SOURCE_URL,TIC_SOURCE_GATE_KEY}=await import('data:text/javascript;base64,'+Buffer.from(fixtures).toString('base64'));
const migration=await readFile(new URL('../drizzle/0000_silly_ogun.sql',import.meta.url),'utf8');
const url='https://offline.invalid/api/v1/flows/tic';
async function scenario(initial,fn){
 let mode=initial,calls=0;
 const worker=name=>({name,modules:true,script,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'offline-shared-tic-gate'},outboundService:request=>{
  assert.equal(request.url,SOURCE_URL,'unexpected outbound destination');assert.equal(request.method,'GET');calls++;
  return mode==='valid'?new Response(valid()):new Response('synthetic source failure',{status:Number(mode),headers:{'Retry-After':'3600',Location:'https://redirect.invalid/never-follow'}});
 }});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{const db=await mf.getD1Database('DB','warm');await db.prepare(migration).run();await fn(mf,db,()=>calls,next=>{mode=next})}
 finally{await mf.dispose()}
}
for(const status of [403,429,302])await scenario(String(status),async(mf,db,calls)=>{
 const response=await mf.dispatchFetch(url);assert.equal(response.status,503);assert.equal(response.headers.get('X-Source-Status'),'denied');
 const cold=await (await mf.getWorker('cold')).fetch(url+'/history');assert.equal(cold.status,503);assert.equal(cold.headers.get('X-Source-Status'),'denied');
 const inspect=await mf.dispatchFetch(url+'/status');assert.equal((await inspect.json()).source_status,'denied');assert.equal(calls(),1);
 assert.equal((await db.prepare('SELECT version FROM tic_snapshot_cache WHERE id=?').bind(TIC_SOURCE_GATE_KEY).first()).version,'denied');
 console.log(`PASS native HTTP ${status}: refusal persists across workers and both cache keys; zero redirect following`);
});
await scenario('503',async(mf,db,calls)=>{
 const response=await mf.dispatchFetch(url);assert.equal(response.status,503);assert.ok(Number(response.headers.get('Retry-After'))>=3599);assert.equal(response.headers.get('X-Source-Status'),'cooldown');
 const cold=await (await mf.getWorker('cold')).fetch(url+'/history');assert.equal(cold.status,503);assert.ok(Number(cold.headers.get('Retry-After'))>=3599);assert.equal(calls(),1);
 const row=await db.prepare('SELECT lease_until_ms FROM tic_snapshot_cache WHERE id=?').bind(TIC_SOURCE_GATE_KEY).first();assert.ok(row.lease_until_ms>Date.now()+3598_000);
 console.log('PASS native one-hour Retry-After is persisted and shared without a five-minute reduction');
});
await scenario('valid',async(mf,db,calls,setMode)=>{
 const first=await mf.dispatchFetch(url);assert.equal(first.status,200);const snapshot=await first.json(),etag=first.headers.get('ETag');assert.equal(snapshot.period,'2026-08');assert.equal(snapshot.grand_total_net_foreign_purchases_usd,9000000);
 const cold=await (await mf.getWorker('cold')).fetch(url,{headers:{'If-None-Match':etag}});assert.equal(cold.status,304);assert.equal(calls(),1);
 const history=await (await mf.getWorker('cold')).fetch(url+'/history');assert.equal(history.status,200);assert.equal((await history.json()).end_period,'2026-08');assert.equal(calls(),2);
 // Isolated test data only. Expire this cache's ordinary daily schedule.
 await db.prepare("UPDATE tic_snapshot_cache SET last_attempt_ms=0 WHERE id='tic-equity-latest-v2'").run();setMode('403');
 const denied=await mf.dispatchFetch(url);assert.equal(denied.status,200);assert.equal(denied.headers.get('X-Data-Status'),'stale');assert.equal(denied.headers.get('X-Source-Status'),'denied');assert.equal((await denied.json()).version,snapshot.version);
 const stoppedHistory=await (await mf.getWorker('cold')).fetch(url+'/history');assert.equal(stoppedHistory.status,200);assert.equal(stoppedHistory.headers.get('X-Source-Status'),'denied');assert.equal(calls(),3);
 console.log('PASS validated current/history values and ETag survive across workers; denial keeps only stale cached data without reacquisition');
});
console.log('PASS all TIC native checks; no real Treasury, production, credentials or gate resets');
