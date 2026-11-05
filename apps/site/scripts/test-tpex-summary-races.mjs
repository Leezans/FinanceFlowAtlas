/** Adversarial native D1 publication/admission races. Synthetic transport only. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const {outputFiles}=await build({stdin:{contents:`
import {waitUntil} from 'cloudflare:workers';
import {createTpexSummaryHandler} from './lib/national/tpex-summary-runtime';
import {D1TpexSummaryGate} from './lib/national/tpex-summary-gate';
export default {async fetch(request,env){
 const [phase,state]=new URL(request.url).pathname.split('/').slice(1);let calls=0,releases=0;
 const flip=async()=>{
  if(state==='missing'){await env.DB.prepare('DELETE FROM tpex_source_gate').run();return;}
  if(state==='invalid'){await env.DB.prepare("UPDATE tpex_source_gate SET not_before_ms='invalid'").run();return;}
  if(state==='cooldown'){await env.DB.prepare('UPDATE tpex_source_gate SET not_before_ms=?').bind(Date.now()+3600000).run();return;}
  await env.DB.prepare('UPDATE tpex_source_gate SET status=?,lease_token=?').bind(state,state==='busy'?'provider-owned':null).run();
 };
 const actual=new D1TpexSummaryGate(env.DB);
 const gate={inspect:()=>actual.inspect(),acquire:async signal=>{const lease=await actual.acquire(signal);if(phase==='acquire')await flip();return lease;},release:async(token,outcome)=>{releases++;if(phase==='release')await flip();const result=await actual.release(token,outcome);if(phase==='after_release')await flip();return result;}};
 const handler=createTpexSummaryHandler({gate,waitUntil,fetcher:async()=>{calls++;if(phase==='fetch')await flip();return Response.json(JSON.parse(env.FIXTURE));}});
 const result=await (await handler(new Request('https://test.invalid/snapshot'))).json();
 const lease=await env.DB.prepare('SELECT status,lease_token,payload FROM tpex_summary_gate').first();
 return Response.json({result,lease,calls,releases});
}};`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'summary-race-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migrations=await Promise.all(['0007_tpex_institutional_gate','0016_tpex_summary_gate'].map(name=>readFile(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8')));
const day=new Date(Date.now()-86400000).toISOString().slice(0,10),roc=String(Number(day.slice(0,4))-1911)+day.slice(5,7)+day.slice(8,10);
const row=(Investor,buy,sell)=>({Date:roc,Investor,PurchaseAmount:String(buy),SaleAmount:String(sell),Net:String(buy-sell)});
const fixture=[row('外資及陸資合計',110,60),row('外資及陸資(不含自營商)',100,40),row('外資自營商',10,20),row('投信',30,45),row('自營商合計',60,90),row('自營商(自行買賣)',20,30),row('自營商(避險)',40,60),row('三大法人合計*',190,175)];
for(const phase of ['acquire','fetch','release','after_release'])for(const state of ['blocked','busy','cooldown','missing','invalid']){
 const mock=createFetchMock();mock.disableNetConnect();const mf=new Miniflare({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'summary-race'},bindings:{FIXTURE:JSON.stringify(fixture)},fetchMock:mock});
 try{
  const db=await mf.getD1Database('DB');for(const sql of migrations)for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  const reply=await (await mf.dispatchFetch(`https://test.invalid/${phase}/${state}`)).json();
  assert.equal(reply.result.snapshot,null,`${phase}/${state}: must withhold report`);
  assert.equal(reply.result.status.state,state==='blocked'?'denied':'unavailable',`${phase}/${state}: correct terminal status`);
  assert.equal(reply.calls,phase==='acquire'?0:1,`${phase}/${state}: no post-admission source bypass`);
  assert.equal(reply.releases,1,`${phase}/${state}: release exactly once`);
  assert.equal(reply.lease.lease_token,null,`${phase}/${state}: lease must settle`);
  assert.equal(reply.lease.status,phase!=='after_release'&&state==='blocked'?'blocked':'idle');
  if(phase!=='after_release')assert.equal(reply.lease.payload,null,`${phase}/${state}: rejected candidate must not persist`);
 }finally{await mf.dispose();}
}
console.log('TPEx summary native races: 20 post-admission, in-flight, publication, and post-publication provider transitions passed.');
