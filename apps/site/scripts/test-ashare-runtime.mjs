/** Offline native-workerd integration. Every source request is intercepted by a
 * synthetic service, with all real network access disabled. This does not prove
 * source availability in production and never loads captured financial data. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';

const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare');
const {build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({
  stdin:{
    contents:`import {ashareHandler} from './lib/ashare/host';
      import {createAshareHandler} from './lib/ashare/ashare';
      import {D1SourceGate} from './lib/ashare/source-gate';
      import {env,waitUntil} from 'cloudflare:workers';
      const hangingDenial=createAshareHandler({enabled:()=>true,runtime:'cloudflare-workers',isolatedForTests:true,
        sourceGate:new D1SourceGate(env.DB),waitUntil,
        fetcher:async()=>new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}),
          {status:403,headers:{'content-type':'application/json'}})});
      let releaseAbort;
      export default {fetch(request){
        if(new URL(request.url).pathname==='/offline/hanging-denial')return hangingDenial(new Request(new URL('/api/v1/ashare/snapshot',request.url)));
        if(new URL(request.url).pathname==='/offline/abort'){releaseAbort?.();return new Response('synthetic cancellation released');}
        if(new URL(request.url).pathname==='/offline/cancel-after-response'){
          const controller=new AbortController();
          void ashareHandler(new Request(new URL('/api/v1/ashare/snapshot',request.url),{signal:controller.signal})).then(response=>response.body?.cancel());
          void new Promise(resolve=>{releaseAbort=resolve;}).then(()=>controller.abort());
          return new Response('synthetic early response',{status:202});
        }
        return ashareHandler(request);
      }};`,
    resolveDir:root,
    sourcefile:'offline-ashare-host.ts',
  },
  bundle:true,
  format:'esm',
  platform:'neutral',
  target:'es2022',
  external:['cloudflare:workers'],
  write:false,
});
const migration=await readFile(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const endpoint='https://offline.invalid/api/v1/ashare/snapshot';
const numericFields=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'];
const syntheticRow={f12:'BK0001',f14:'合成行业',...Object.fromEntries(numericFields.map(field=>[field,1]))};
const syntheticBody=Buffer.from(JSON.stringify({rc:0,data:{total:1,diff:[syntheticRow]}}));

async function withWorkers(mode,check){
  let calls=0;
  const mock=createFetchMock();
  mock.disableNetConnect();
  const interception=mock.get('https://push2.eastmoney.com')
    .intercept({method:'GET',path:/^\/api\/qt\/clist\/get\?/})
    .reply(()=>{
      calls++;
      const statusCode=mode==='temporary_failure'?503:mode==='denied'?403:200;
      const data=mode==='gzip'?gzipSync(syntheticBody):mode==='br'?brotliCompressSync(syntheticBody):statusCode===200?syntheticBody:Buffer.from('{}');
      return {statusCode,data,responseOptions:{headers:{
        'content-type':'application/json',
        'content-length':String(data.length),
        ...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{}),
      }}};
    }).persist();
  if(mode==='disconnect')interception.delay(5000);
  // Distinct workerd workers have independent module state but share the exact
  // same D1 database. A new handler in an existing isolate is not sufficient.
  const worker=name=>({
    name,
    modules:true,
    script:outputFiles[0].text,
    compatibilityDate:'2026-05-15',
    compatibilityFlags:['nodejs_compat','enable_request_signal'],
    d1Databases:{DB:'offline-shared-ashare-gate'},
    fetchMock:mock,
  });
  const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
  try{
    const db=await mf.getD1Database('DB','warm');
    for(const statement of migration.split('--> statement-breakpoint')){
      await db.prepare(statement.trim()).run();
    }
    await check(mf,db,()=>calls);
  }finally{
    await mf.dispose();
    await mock.close();
  }
}

for(const coding of ['plain','gzip','br']){
  await withWorkers(coding,async(mf,db,calls)=>{
    const response=await mf.dispatchFetch(endpoint);
    const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.deepEqual(body.rows,[syntheticRow]);
    assert.equal(body.trade_date,null);
    assert.equal(body.source_observed_at,null);
    const cached=await mf.dispatchFetch(endpoint,{headers:{'if-none-match':response.headers.get('etag')}});
    assert.equal(cached.status,304);
    assert.equal(calls(),1);
    const gate=await db.prepare('SELECT status,not_before_ms-finished_ms AS quiet_ms FROM ashare_source_gate').first();
    assert.equal(gate.status,'idle');
    assert.equal(gate.quiet_ms,3000);
  });
  console.log(`PASS native workerd ${coding}; synthetic JSON; cached 304; 3s success pacing`);
}

await withWorkers('temporary_failure',async(mf,db,calls)=>{
  const first=await mf.dispatchFetch(endpoint);
  assert.equal(first.status,503);
  assert.equal((await first.json()).error_code,'upstream_http');
  assert.equal(calls(),1);
  const gate=await db.prepare('SELECT status,finished_ms,not_before_ms FROM ashare_source_gate').first();
  assert.equal(gate.status,'idle');
  assert.equal(gate.not_before_ms-gate.finished_ms,60_000);
  const cold=await mf.getWorker('cold');
  // Handler's bounded admission wait exceeds the old 3s database interval.
  const result=await cold.fetch(`${endpoint}?scope=BK0001`);
  assert.equal(result.status,503);
  assert.equal((await result.json()).error_code,'source_cooldown');
  assert.equal(calls(),1,'cold isolate must not retry the failing provider');
  const unchanged=await db.prepare('SELECT finished_ms,not_before_ms FROM ashare_source_gate').first();
  assert.equal(unchanged.finished_ms,gate.finished_ms);
  assert.equal(unchanged.not_before_ms,gate.not_before_ms);
});
console.log('PASS temporary failure: shared 60s cooldown; cold isolate/different scope makes no source request');

await withWorkers('denied',async(mf,db,calls)=>{
  const first=await mf.dispatchFetch(endpoint);
  assert.equal(first.status,503);
  assert.equal((await first.json()).error_code,'source_access_denied');
  const cold=await mf.getWorker('cold');
  const result=await cold.fetch(`${endpoint}?scope=BK0001`);
  assert.equal(result.status,503);
  assert.equal((await result.json()).error_code,'persistent_source_denial');
  assert.equal(calls(),1);
  assert.equal((await db.prepare('SELECT status FROM ashare_source_gate').first()).status,'blocked');
});
console.log('PASS permanent denial survives cold isolate; zero real provider/network calls throughout');


await withWorkers('disconnect',async(mf,db,calls)=>{
  // Miniflare's incoming proxy does not forward Node-client socket cancellation.
  // Exercise an explicit request abort after the HTTP response has finished:
  // the real host must retain native workerd execution through the D1 release.
  const response=await mf.dispatchFetch('https://offline.invalid/offline/cancel-after-response');
  assert.equal(response.status,202);await response.text();
  const waitFor=async(check,message)=>{
    const end=Date.now()+3000;
    while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}
    throw new Error(message);
  };
  await waitFor(()=>calls()===1,'synthetic upstream did not start');
  assert.equal((await db.prepare('SELECT status FROM ashare_source_gate').first()).status,'busy');
  const releaseAbort=await mf.dispatchFetch('https://offline.invalid/offline/abort');await releaseAbort.text();
  await waitFor(async()=> (await db.prepare('SELECT status FROM ashare_source_gate').first()).status==='idle',
    'request abort must retain confirmed gate release after response completion');
  const gate=await db.prepare('SELECT status,lease_token,not_before_ms-finished_ms AS quiet_ms FROM ashare_source_gate').first();
  assert.equal(gate.lease_token,null);assert.equal(gate.quiet_ms,60_000);assert.equal(calls(),1);
  const cold=await mf.getWorker('cold');
  const next=await cold.fetch(endpoint);assert.equal(next.status,503);
  assert.equal((await next.json()).error_code,'source_cooldown');assert.equal(calls(),1);
});
console.log('PASS abort after HTTP response: native retained cleanup releases only its own lease; cooldown persists');


await withWorkers('plain',async(mf,db,calls)=>{
  // A never-settling cancel() is synthetic, but the handler, workerd stream, and
  // D1 denial transition are real. No external/provider request is made.
  const pending=mf.dispatchFetch('https://offline.invalid/offline/hanging-denial');
  const deadline=Date.now()+3000;
  let gate;
  while(Date.now()<deadline){
    gate=await db.prepare('SELECT status,lease_token FROM ashare_source_gate').first();
    if(gate.status==='blocked')break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(gate.status,'blocked','observed denial must persist without waiting for body cancellation');
  assert.equal(gate.lease_token,null);
  let timer;
  try{
    const result=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('denial cleanup exceeded bound')),3000);})]);
    assert.equal(result.status,503);assert.equal((await result.json()).error_code,'source_access_denied');
  }finally{clearTimeout(timer);}
  const cold=await mf.getWorker('cold');const result=await cold.fetch(endpoint);
  assert.equal(result.status,503);assert.equal((await result.json()).error_code,'persistent_source_denial');
  assert.equal(calls(),0,'denied fixtures must not result in an external mock or actual source call');
});
console.log('PASS native hanging body cancellation cannot delay durable denial; cold isolate remains blocked');


await withWorkers('plain',async(mf,db,calls)=>{
  // Synthetic legacy operation with unknown outcome. Never touch production.
  await db.prepare("UPDATE ashare_source_gate SET status='busy',lease_token='synthetic-unconfirmed',acquired_ms=1000,updated_ms=1000,reason_code=NULL WHERE id='single_upstream'").run();
  const before=await db.prepare('SELECT * FROM ashare_source_gate').first();
  const coldStatus=await (await mf.getWorker('cold')).fetch(endpoint.replace('/snapshot','/status'));
  assert.equal((await coldStatus.json()).error_code,'source_outcome_unconfirmed');
  assert.equal(coldStatus.headers.get('x-ashare-recovery'),'stopped');assert.equal(calls(),0);
  assert.deepEqual(await db.prepare('SELECT * FROM ashare_source_gate').first(),before);
  for(const fetcher of [mf,await mf.getWorker('cold')]) {
    const response=fetcher===mf?await mf.dispatchFetch(endpoint):await fetcher.fetch(endpoint);
    assert.equal(response.status,503);
    assert.equal(response.headers.get('x-ashare-error-code'),'source_outcome_unconfirmed');
    assert.equal(response.headers.get('x-ashare-recovery'),'stopped');
    assert.equal(response.headers.get('retry-after'),null);
    assert.equal((await response.json()).error_code,'source_outcome_unconfirmed');
  }
  assert.equal(calls(),0,'unconfirmed operation must not permit any source call');
  assert.deepEqual(await db.prepare('SELECT * FROM ashare_source_gate').first(),before,'diagnosis must preserve every lease/denial field exactly');
});
console.log('PASS native unconfirmed legacy operation: zero source calls; every D1 field preserved across isolates');

await withWorkers('plain',async(mf,db,calls)=>{
  // Test only: initialize operation metadata matching the one-time repair.
  // This is not a production mutation and no captured provider values are used.
  await db.prepare("UPDATE ashare_source_gate SET status='busy',lease_token='5c3f28a0-6303-4432-8dab-019ff369586e',acquired_ms=1793856991992,finished_ms=1793842921309,updated_ms=1793856991992,not_before_ms=1793842924309,reason_code=NULL WHERE id='single_upstream'").run();
  const before=await db.prepare('SELECT * FROM ashare_source_gate').first();
  const migration=await readFile(new URL('../drizzle/0010_ashare_legacy_reconciliation.sql',import.meta.url),'utf8');
  for(const sql of migration.split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
  const gate=await db.prepare('SELECT * FROM ashare_source_gate').first();
  assert.equal(gate.status,'idle');assert.equal(gate.lease_token,null);assert.equal(gate.not_before_ms-gate.finished_ms,60_000);
  const audit=await db.prepare('SELECT * FROM ashare_recovery_audit').first();
  assert.equal(audit.prior_lease_token,before.lease_token);assert.equal(audit.source_outcome,'unknown');assert.equal(audit.invocation_outcome,'canceled_terminal');
  const deniedDuringCooldown=await mf.dispatchFetch(endpoint);assert.equal(deniedDuringCooldown.status,503);assert.equal(calls(),0);
  // Elapse cooldown in the isolated fixture only; the production migration never skips it.
  await db.prepare('UPDATE ashare_source_gate SET not_before_ms=0 WHERE status=\'idle\'').run();
  const cold=await mf.getWorker('cold');const snapshot=await cold.fetch(endpoint);assert.equal(snapshot.status,200);
  assert.equal((await snapshot.json()).rows.length,1);assert.equal(calls(),1);
  const finished=await db.prepare('SELECT * FROM ashare_source_gate').first();
  for(const sql of migration.split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
  assert.deepEqual(await db.prepare('SELECT * FROM ashare_source_gate').first(),finished);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM ashare_recovery_audit').first()).n,1);
});
console.log('PASS native one-time audited repair: exact legacy lease only, shared cooldown, synthetic cold-start snapshot, replay no-op');
