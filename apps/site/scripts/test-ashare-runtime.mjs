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
    contents:"import {ashareHandler} from './lib/ashare/host'; export default {fetch:ashareHandler};",
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
  mock.get('https://push2.eastmoney.com')
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
  // Distinct workerd workers have independent module state but share the exact
  // same D1 database. A new handler in an existing isolate is not sufficient.
  const worker=name=>({
    name,
    modules:true,
    script:outputFiles[0].text,
    compatibilityDate:'2026-05-15',
    compatibilityFlags:['nodejs_compat'],
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
