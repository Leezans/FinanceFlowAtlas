/** OFFLINE only: native workerd + transactional D1, independent isolates sharing
 * one database. Every upstream request is synthetic; real networking is disabled.
 * All SQL fault/clock fixtures apply only to ephemeral Miniflare databases. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare');
const {build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
import {ashareHandler} from './lib/ashare/host';
import {createAshareHandler} from './lib/ashare/ashare';
import {D1SourceGate} from './lib/ashare/source-gate';
import {D1SnapshotStore} from './lib/ashare/snapshot-store';
import {env,waitUntil} from 'cloudflare:workers';
const store=new D1SnapshotStore(env.DB);
let commitStarted=false,complete=false,bodyStarted=false,started;
const cancellable=createAshareHandler({enabled:()=>true,runtime:'cloudflare-workers',isolatedForTests:true,
 sourceGate:new D1SourceGate(env.DB),snapshotStore:store,waitUntil,
 fetcher:async()=>{bodyStarted=true;started?.();return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"rc":0,"data":'));}}),{headers:{'content-type':'application/json'}});}});
const delayed=createAshareHandler({enabled:()=>true,runtime:'cloudflare-workers',isolatedForTests:true,
 sourceGate:new D1SourceGate(env.DB),snapshotStore:{read:scope=>store.read(scope),async commit(token,snapshot){
  commitStarted=true;started?.();await new Promise(resolve=>setTimeout(resolve,500));await store.commit(token,snapshot);complete=true;
 }},waitUntil});
export default {async fetch(request){
 const path=new URL(request.url).pathname;
 if(path==='/offline/commit') {const input=await request.json();try{await store.commit(input.token,input.snapshot);return Response.json({ok:true});}catch(error){return Response.json({code:error.code??error.message},{status:409});}}
 if(path==='/offline/cancel-collection'){const ready=new Promise(resolve=>{started=resolve;});const controller=new AbortController();void cancellable(new Request(new URL('/api/v1/ashare/snapshot',request.url),{signal:controller.signal})).then(r=>r.body?.cancel());await ready;setTimeout(()=>controller.abort(),500);return new Response('early cancellation fixture',{status:202});}
 if(path==='/offline/early') {const ready=new Promise(resolve=>{started=resolve;});const controller=new AbortController();void delayed(new Request(new URL('/api/v1/ashare/snapshot',request.url),{signal:controller.signal})).then(r=>r.body?.cancel());await ready;setTimeout(()=>controller.abort(),100);return new Response('early',{status:202});}
 if(path==='/offline/progress')return Response.json({commitStarted,complete,bodyStarted});
 return ashareHandler(request);
}};`,resolveDir:root,sourcefile:'offline-shared-snapshots.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migrations=(await Promise.all(['0001_wild_jigsaw','0012_ashare_shared_snapshots','0014_ashare_staged_acquisitions'].map(n=>readFile(new URL('../drizzle/'+n+'.sql',import.meta.url),'utf8')))).join('\n--> statement-breakpoint\n');
const endpoint='https://offline.invalid/api/v1/ashare/snapshot';
const nowSQL="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const numeric=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'];
const row=stock=>({f12:stock?'000001':'BK0001',f14:stock?'合成股票':'合成行业',...Object.fromEntries(numeric.map(k=>[k,1]))});
async function withWorkers(check){
 let calls=0,mode='success';const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://push2.eastmoney.com').intercept({method:'GET',path:/^\/api\/qt\/clist\/get\?/}).reply(options=>{
  calls++;const statusCode=mode==='denied'?403:mode==='failure'?503:200;
  const stock=new URL(options.path,'https://push2.eastmoney.com').searchParams.get('fs').startsWith('b:');
  return {statusCode,data:JSON.stringify(statusCode===200?{rc:0,data:{total:1,diff:[row(stock)]}}:{}),responseOptions:{headers:{'content-type':'application/json'}}};
 }).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-ashare-snapshots'},fetchMock:mock});
 const mf=new Miniflare({workers:['warm','cold','colder'].map(worker)});
 try{
  const db=await mf.getD1Database('DB','warm');for(const sql of migrations.split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
  const fetchers=[(url,init)=>mf.dispatchFetch(url,init),...(await Promise.all(['cold','colder'].map(n=>mf.getWorker(n)))).map(w=>(url,init)=>w.fetch(url,init))];
  await check({mf,db,fetchers,calls:()=>calls,setMode:value=>{mode=value;}});
 }finally{await mf.dispose();await mock.close();}
}
const elapseSuccess=db=>db.prepare("UPDATE ashare_source_gate SET not_before_ms=0 WHERE status='idle'").run();
const age=db=>db.prepare('UPDATE ashare_snapshot_cache SET committed_ms=committed_ms-61000,expires_ms=expires_ms-61000').run();
const cache=db=>db.prepare('SELECT * FROM ashare_snapshot_cache ORDER BY scope_key').all();
const gate=db=>db.prepare('SELECT * FROM ashare_source_gate').first();
async function data(fetcher,scope='level1',init){const response=await fetcher(endpoint+'?scope='+scope,init);assert.equal(response.status,200,await response.clone().text());return {body:await response.json(),etag:response.headers.get('etag'),response};}
async function unavailable(fetcher,scope,code,etag){const r=await fetcher(endpoint+'?scope='+scope,{headers:etag?{'if-none-match':etag}:{}});assert.equal(r.status,503);const b=await r.json();assert.equal(b.error_code,code);assert.equal(b.rows,undefined);assert.equal(b.fetched_at,undefined);return r;}
async function until(check,message){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw new Error(message);}

await withWorkers(async({db,fetchers,calls})=>{
 const first=await data(fetchers[0]);assert.equal(calls(),1);
 for(const f of fetchers.slice(1)){const next=await data(f);assert.deepEqual(next.body,first.body);assert.equal(next.etag,first.etag);const r=await f(endpoint,{headers:{'if-none-match':first.etag}});assert.equal(r.status,304);}
 assert.equal(calls(),1,'cold fresh reads must never acquire');
 await elapseSuccess(db);const stock=await data(fetchers[0],'BK0001');assert.equal(calls(),2);
 assert.deepEqual((await data(fetchers[1],'BK0001')).body,stock.body);assert.deepEqual((await data(fetchers[2])).body,first.body);assert.equal(calls(),2);
 assert.deepEqual((await cache(db)).results.map(r=>r.scope_key),['BK0001','level1']);
});
console.log('PASS fresh industry and stock survive independent cold isolates; identical ETags; zero extra source calls');

await withWorkers(async({db,fetchers,calls,setMode})=>{
 const initial=await data(fetchers[0]);await age(db);await elapseSuccess(db);setMode('failure');
 const stale=await data(fetchers[0]);assert.equal(calls(),2);assert.equal(stale.body.stale,true);assert.equal(stale.body.has_error,true);
 assert.equal(stale.body.fetched_at,initial.body.fetched_at);assert.deepEqual(stale.body.rows,initial.body.rows);assert.equal(stale.body.source_observed_at,null);assert.equal(stale.body.trade_date,null);
 const failed=await gate(db);assert.equal(failed.not_before_ms-failed.finished_ms,60000);
 for(const f of fetchers.slice(1)){const cold=await data(f);assert.equal(cold.body.stale,true);assert.equal(cold.body.has_error,true);assert.equal(cold.body.fetched_at,initial.body.fetched_at);await unavailable(f,'BK0002','source_cooldown');}
 assert.equal(calls(),2);assert.deepEqual(await gate(db),failed,'reads cannot extend or shorten failure pacing');
 // Leave one second on the shared cooldown: no bounded 3.1s admission wait or
 // implicit refresh may bypass this known failure cooldown.
 await db.prepare(`UPDATE ashare_source_gate SET finished_ms=${nowSQL}-59000,not_before_ms=${nowSQL}+1000`).run();
 await data(fetchers[2]);assert.equal(calls(),2);
});
console.log('PASS 503 preserves last-good provenance on warm/cold isolates and strict shared 60s pacing');

await withWorkers(async({db,fetchers,calls,setMode})=>{
 const industry=await data(fetchers[0]);await elapseSuccess(db);const stock=await data(fetchers[0],'BK0001');
 await elapseSuccess(db);setMode('denied');await unavailable(fetchers[1],'BK0002','source_denied');assert.equal(calls(),3);
 for(const f of fetchers)for(const [scope,etag]of [['level1',industry.etag],['BK0001',stock.etag],['BK0003','"unused"']]){
  // Each independently initialized host must consult denial before conditional GET.
  const r=await f(endpoint+'?scope='+scope,{headers:{'if-none-match':etag}});assert.equal(r.status,503);const b=await r.json();assert.match(b.error_code,/source_(denied|access_denied|denial_latched)/);assert.equal(b.rows,undefined);
 }
 assert.equal(calls(),3);assert.equal((await gate(db)).status,'blocked');assert.equal((await cache(db)).results.length,2);
});
console.log('PASS durable provider denial suppresses all cached scopes and conditional 304s across warm/cold isolates');

for(const invalid of ['wrong_scope','missing_field','expired'])await withWorkers(async({db,fetchers,calls,setMode})=>{
 await data(fetchers[0]);const saved=(await cache(db)).results[0];
 if(invalid==='expired')await db.prepare('UPDATE ashare_snapshot_cache SET committed_ms=committed_ms-86400001,expires_ms=expires_ms-86400001').run();
 else {const payload=JSON.parse(saved.payload);if(invalid==='wrong_scope')payload.scope.fs='b:BK0001';else delete payload.rows[0].f62;await db.prepare('UPDATE ashare_snapshot_cache SET payload=?').bind(JSON.stringify(payload)).run();}
 setMode('failure');await elapseSuccess(db);
 if(invalid==='expired'){await unavailable(fetchers[1],'level1','upstream_http');assert.equal(calls(),2);}
 else{for(const f of fetchers)await unavailable(f,'level1','snapshot_invalid');assert.equal(calls(),1);}
});
console.log('PASS invalid and expired evidence never returns values, including previously warm cache');

for(const unknown of [false,true])await withWorkers(async({db,fetchers,calls})=>{
 const initial=await data(fetchers[0]);await db.prepare(`UPDATE ashare_source_gate SET status='busy',lease_token='fixture-live',acquired_ms=${nowSQL}-${unknown?180001:0}`).run();const before=await gate(db);
 for(const f of fetchers)await unavailable(f,'level1',unknown?'source_outcome_unconfirmed':'source_busy',initial.etag);
 assert.equal(calls(),1);assert.deepEqual(await gate(db),before);assert.equal((await cache(db)).results.length,1);
});
console.log('PASS known busy and unknown outcome suppress cache without fetch, takeover, or gate mutation');

await withWorkers(async({mf,db,fetchers,calls})=>{
 await data(fetchers[0]);const before=await cache(db);const snapshot=JSON.parse(before.results[0].payload);snapshot.rows[0].f62=999;
 await db.prepare(`UPDATE ashare_source_gate SET status='busy',lease_token='current',acquired_ms=${nowSQL}`).run();const prior=await gate(db);
 const r=await mf.dispatchFetch('https://offline.invalid/offline/commit',{method:'POST',body:JSON.stringify({token:'stale',snapshot})});assert.equal(r.status,409);assert.equal((await r.json()).code,'source_stale_lease');
 assert.deepEqual((await cache(db)).results,before.results);assert.deepEqual(await gate(db),prior);assert.equal(calls(),1);
});
console.log('PASS stale lease cannot publish, prune, or release a current acquisition');

await withWorkers(async({db,fetchers,calls})=>{
 // Trigger aborts the fourth statement in the real transactional batch, after
 // INSERT and retention have executed. Native D1 must roll all of them back.
 await db.prepare("CREATE TRIGGER fixture_abort_release BEFORE UPDATE ON ashare_source_gate WHEN OLD.status='busy' AND NEW.status='idle' BEGIN SELECT RAISE(ABORT,'offline commit fault'); END").run();
 await unavailable(fetchers[0],'level1','source_gate_release_unconfirmed');assert.equal(calls(),1);assert.equal((await cache(db)).results.length,0);assert.equal((await gate(db)).status,'busy');
 await unavailable(fetchers[1],'level1','source_busy');assert.equal(calls(),1);
});
console.log('PASS failed native D1 atomic commit leaves no partial publication and never retries unresolved acquisition');

await withWorkers(async({mf,db,fetchers,calls})=>{
 const early=await mf.dispatchFetch('https://offline.invalid/offline/early');assert.equal(early.status,202);await early.text();
 await until(async()=> (await (await mf.dispatchFetch('https://offline.invalid/offline/progress')).json()).commitStarted,'commit never started');
 assert.equal(calls(),1);assert.equal((await gate(db)).status,'busy');assert.equal((await cache(db)).results.length,0);
 // The origin-event timer simulates disconnect after collection while the
 // persistence delay is outstanding. The complete
 // retained promise must finish the already-started atomic commit, not publish
 // an in-memory-only value or abandon an owned lease.
 await until(async()=> (await (await mf.dispatchFetch('https://offline.invalid/offline/progress')).json()).complete,'retained commit did not finish after early response/disconnect');
 assert.equal((await gate(db)).status,'idle');assert.equal((await cache(db)).results.length,1);await data(fetchers[1]);assert.equal(calls(),1);
});
console.log('PASS early response/disconnect retains complete atomic commit; cold reader sees only committed snapshot');

await withWorkers(async({mf,db,fetchers,calls})=>{
 const early=await mf.dispatchFetch('https://offline.invalid/offline/cancel-collection');assert.equal(early.status,202);await early.text();
 await until(async()=> (await (await mf.dispatchFetch('https://offline.invalid/offline/progress')).json()).bodyStarted,'streaming fixture never started');
 assert.equal((await gate(db)).status,'busy');assert.equal((await cache(db)).results.length,0);
 await until(async()=> (await gate(db)).status==='idle','cancelled collection did not retain release');
 const ended=await gate(db);assert.equal(ended.not_before_ms-ended.finished_ms,60000);assert.equal(ended.lease_token,null);
 assert.equal((await cache(db)).results.length,0);await unavailable(fetchers[1],'level1','source_cooldown');assert.equal(calls(),0);
});
console.log('PASS cancellation during collection retains cleanup and publishes no incomplete snapshot');
