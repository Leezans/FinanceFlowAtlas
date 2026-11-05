/** Native workerd + D1 integration; synthetic data, all external network blocked. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const {outputFiles}=await build({stdin:{contents:"import {tpexSummaryHandler} from './lib/national/tpex-summary-host'; import {D1TpexSummaryGate} from './lib/national/tpex-summary-gate'; export default {async fetch(request,env){if(new URL(request.url).pathname==='/offline/acquire'){try{await new D1TpexSummaryGate(env.DB).acquire();return Response.json({acquired:true});}catch(error){return Response.json({error:error.code});}}return tpexSummaryHandler(request);}};",resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'summary-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migrations=await Promise.all(['0007_tpex_institutional_gate','0016_tpex_summary_gate'].map(name=>readFile(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8')));
const date=new Date(Date.now()-86_400_000).toISOString().slice(0,10),roc=String(Number(date.slice(0,4))-1911)+date.slice(5,7)+date.slice(8,10);
const row=(Investor,buy,sell)=>({Date:roc,Investor,PurchaseAmount:String(buy),SaleAmount:String(sell),Net:String(buy-sell)});
const fixture=[row('外資及陸資合計',110,60),row('外資及陸資(不含自營商)',100,40),row('外資自營商',10,20),row('投信',30,45),row('自營商合計',60,90),row('自營商(自行買賣)',20,30),row('自營商(避險)',40,60),row('三大法人合計*',190,175)];
const url='https://test.invalid/api/v1/taiwan/tpex/summary/snapshot';
async function scenario(provider,upstreamStatus=200){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://www.tpex.org.tw').intercept({method:'GET',path:'/openapi/v1/tpex_3insti_summary'}).reply(()=>{calls++;return {statusCode:upstreamStatus,data:JSON.stringify(fixture),responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'summary-test'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const statement of migrations[0].split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  if(provider==='missing')await db.prepare('DELETE FROM tpex_source_gate').run();
  else await db.prepare("UPDATE tpex_source_gate SET status=?,lease_token=?").bind(['cooldown','invalid_deadline'].includes(provider)?'idle':provider,provider==='busy'?'original-lease':null).run();
  if(provider==='cooldown')await db.prepare('UPDATE tpex_source_gate SET not_before_ms=?').bind(Date.now()+3_600_000).run();
  if(provider==='invalid_deadline')await db.prepare("UPDATE tpex_source_gate SET not_before_ms='invalid'").run();
  for(const statement of migrations[1].split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  const warm=await mf.getWorker('warm'),cold=await mf.getWorker('cold');
  const first=await (await warm.fetch(url)).json();
  if(provider!=='idle'){
   assert.equal(first.snapshot,null);assert.equal(first.status.state,provider==='blocked'?'denied':'unavailable');
   assert.equal((await (await cold.fetch(url)).json()).snapshot,null);assert.equal(calls,0);
   const admission=await (await warm.fetch('https://test.invalid/offline/acquire')).json();assert.equal(admission.error,provider==='blocked'?'source_denied':provider==='busy'?'source_busy':provider==='cooldown'?'source_cooldown':'source_gate_unavailable');
   assert.equal((await db.prepare('SELECT status FROM tpex_source_gate').first())?.status,provider==='missing'?undefined:['cooldown','invalid_deadline'].includes(provider)?'idle':provider);
  }else if(upstreamStatus!==200){
   assert.equal(first.status.state,'denied');assert.equal(first.snapshot,null);
   assert.equal((await db.prepare('SELECT status FROM tpex_summary_gate').first()).status,'blocked');
   await cold.fetch(url);assert.equal(calls,1);
  }else{
   assert.equal(first.status.state,'available');assert.equal(first.snapshot.unit,'TWD');assert.equal(first.snapshot.net_capital_flow,null);assert.equal(first.snapshot.participants[3].net,15);
   const shared=await (await cold.fetch(url)).json();assert.deepEqual(shared.snapshot,first.snapshot);assert.equal(calls,1);
   await db.prepare("UPDATE tpex_source_gate SET status='blocked'").run();
   for(const worker of [warm,cold]){const stopped=await (await worker.fetch(url)).json();assert.equal(stopped.status.state,'denied');assert.equal(stopped.snapshot,null);}
   assert.equal(calls,1);
  }
 }finally{await mf.dispose();}
}
for(const provider of ['blocked','busy','missing','cooldown','invalid_deadline','idle'])await scenario(provider);
for(const status of [302,403,429])await scenario('idle',status);
console.log('TPEx summary native runtime: 9 offline provider-gate/cache/denial scenarios passed.');
