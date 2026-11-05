/** Synthetic offline workerd + D1 tests; real source downloads prohibited. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wr('miniflare'),{build}=wr('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const compiled=await build({stdin:{contents:"import {japanMofHandler} from './lib/japan/host'; import {readCp932CSV} from './lib/reports/json'; export default {async fetch(request){if(new URL(request.url).pathname==='/offline/cp932'){const text=await readCp932CSV(new Response(new Uint8Array([0x93,0xfa,0x96,0x7b]),{headers:{'content-type':'text/csv'}}),request.signal,20);return Response.json({header:text});}return japanMofHandler(request);}};",resolveDir:root},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const fixtureBuild=await build({entryPoints:[root+'/tests/japan-mof-fixture.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {csv,mofFixture}=await import('data:text/javascript;base64,'+Buffer.from(fixtureBuild.outputFiles[0].text).toString('base64'));
const rows=mofFixture();const now=new Date(),end=new Date(now);end.setUTCDate(end.getUTCDate()-((end.getUTCDay()+1)%7)-7);const start=new Date(end);start.setUTCDate(start.getUTCDate()-6);const fmt=d=>`${d.getUTCFullYear()}.${d.getUTCMonth()+1}.${d.getUTCDate()}`;rows[14][0]=fmt(start)+'~'+fmt(end);rows[1][19]='Final Update '+now.toLocaleString('en-US',{month:'long',timeZone:'UTC'})+' '+now.getUTCDate()+' , '+now.getUTCFullYear();
const migration=await readFile(new URL('../drizzle/0020_japan_mof_weekly.sql',import.meta.url),'utf8');
const url='https://local/api/v1/japan/mof/snapshot';
async function scenario(status){let calls=0;const mock=createFetchMock();mock.disableNetConnect();mock.get('https://www.mof.go.jp').intercept({method:'GET',path:'/policy/international_policy/reference/itn_transactions_in_securities/week.csv'}).reply(()=>{calls++;return {statusCode:status,data:status===200?csv(rows):'',responseOptions:{headers:{'content-type':'text/csv'}}};}).persist();
 const worker=name=>({name,modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'japan-offline'},fetchMock:mock});const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{const db=await mf.getD1Database('DB','warm');for(const statement of migration.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();const warm=await mf.getWorker('warm'),cold=await mf.getWorker('cold');assert.deepEqual(await (await warm.fetch('https://local/offline/cp932')).json(),{header:'日本'});await warm.fetch(url.replace('snapshot','status'));assert.equal(calls,0);const first=await (await warm.fetch(url)).json(),second=await (await cold.fetch(url)).json();assert.equal(calls,1);
 if(status===200){assert.equal(first.snapshot.assets[0].net,60);assert.deepEqual(second.snapshot,first.snapshot);const payload=(await db.prepare('SELECT payload FROM japan_mof_source_gate').first()).payload;assert(payload.length<2000);assert(!payload.includes('Final Update'));await db.prepare("UPDATE japan_mof_source_gate SET status='blocked'").run();for(const w of [warm,cold]){const r=await (await w.fetch(url)).json();assert.equal(r.status.state,'denied');assert.equal(r.snapshot,null);}}
 else if(status===503){assert.equal(first.snapshot,null);assert.equal(second.snapshot,null);assert.equal((await db.prepare('SELECT status FROM japan_mof_source_gate').first()).status,'idle');}
 else{assert.equal(first.status.state,'denied');assert.equal(second.status.state,'denied');assert.equal((await db.prepare('SELECT status FROM japan_mof_source_gate').first()).status,'blocked');}assert.equal(calls,1);
 }finally{await mf.dispose();}}
for(const status of [200,302,403,429,503])await scenario(status);
console.log('Japan MOF native runtime: 5 synthetic D1/cache/cooldown/denial scenarios passed.');
