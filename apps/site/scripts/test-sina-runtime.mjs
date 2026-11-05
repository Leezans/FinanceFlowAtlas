/** Offline workerd integration. All outbound requests terminate in this synthetic
 * service. Never contact a financial provider or load captured observations. */
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
const {outputFiles}=await build({stdin:{contents:`
 import {createSinaIndustryHandler} from './lib/sina/industry';
 import {D1SinaGate} from './lib/sina/source-gate';
 let handler;
 export default {fetch(request,env){
  const create=()=>createSinaIndustryHandler({enabled:()=>true,runtime:'cloudflare-workers',sourceGate:new D1SinaGate(env.DB),isolatedForTests:true});
  handler??=create();return (request.headers.has('x-new-test-handler')?create():handler)(request);
 }};`,resolveDir:root,sourcefile:'synthetic-worker.ts',loader:'ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false});
const migration=await readFile(new URL('../drizzle/0002_faithful_pyro.sql',import.meta.url),'utf8');
const eastmoneyMigration=await readFile(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const url='https://test.invalid/api/v1/ashare/sina/snapshot';
async function withWorker(mode,fn){
 let calls=0;
 const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://vip.stock.finance.sina.com.cn').intercept({method:'GET',path:/^\/quotes_service\/api\/json_v2.php\/MoneyFlow\.(ssc|ssl)_bkzj_bk\?/}).reply(options=>{
  calls++;
  if(mode==='denial')return {statusCode:403,data:''};
  const count=options.path.includes('ssc_bkzj_bk?');
  // GBK test text is synthetic "合成行业", not captured financial data.
  const bytes=count?Buffer.from('"1"'):Buffer.concat([Buffer.from('[{"cate_type":"0","category":"new_test","name":"'),Buffer.from([186,207,179,201,208,208,210,181]),Buffer.from('","inamount":"0.30","outamount":"0.20","netamount":"0.10","ratioamount":"0.02","avg_price":"2.00","avg_changeratio":"-0.01"}]')]);
  const encoded=mode==='gzip'?gzipSync(bytes):mode==='br'?brotliCompressSync(bytes):bytes;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json; charset=gbk','content-length':String(encoded.length),...(mode==='plain'?{}:{'content-encoding':mode})}}};
 }).persist();
 const mf=new Miniflare({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],fetchMock:mock});
 try{
  const db=await mf.getD1Database('DB');
  for(const sql of [eastmoneyMigration,migration])for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();
  await fn(mf,db,()=>calls);
  assert.equal((await db.prepare('SELECT status,reason_code FROM ashare_source_gate').first()).status,'blocked');
 }finally{await mf.dispose();await mock.close();}
}
for(const coding of ['plain','gzip','br']){
 await withWorker(coding,async(mf,db,calls)=>{
  const result=await mf.dispatchFetch(url);const body=await result.json();
  assert.equal(result.status,200,JSON.stringify(body));assert.equal(body.rows[0].name,'合成行业');assert.equal(body.rows[0].net_flow_cny,'0.10');assert.equal(body.trade_date,null);assert.equal(calls(),3);
  const cached=await mf.dispatchFetch(url,{headers:{'if-none-match':result.headers.get('etag')}});assert.equal(cached.status,304);assert.equal(calls(),3);
  const restart=await mf.dispatchFetch(url,{headers:{'x-new-test-handler':'1'}});assert.equal(restart.status,503);assert.equal((await restart.json()).error_code,'source_cooldown');assert.equal(calls(),3);
  const row=await db.prepare('SELECT status,not_before_ms FROM sina_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+290000);
 });
 console.log(`PASS native workerd ${coding} GBK; exact decimals; D1 cooldown; Eastmoney independence`);
}
await withWorker('denial',async(mf,db,calls)=>{
 const first=await mf.dispatchFetch(url);assert.equal(first.status,503);assert.equal(first.headers.get('retry-after'),null);assert.equal(calls(),1);
 const restarted=await mf.dispatchFetch(url,{headers:{'x-new-test-handler':'1'}});assert.equal(restarted.status,503);assert.equal((await restarted.json()).error_code,'source_denied');assert.equal(calls(),1);
 assert.equal((await db.prepare('SELECT status FROM sina_source_gate').first()).status,'blocked');
});
console.log('PASS denial persists through fresh handler; zero real network calls');
// Exercise the checked-in host, not a test-supplied enable flag. No DB binding is
// provided: the disabled route must not touch storage or the financial source.
const hostBuild=await build({stdin:{contents:"import {sinaIndustryHandler} from './lib/sina/host'; export default {fetch:sinaIndustryHandler};",resolveDir:root,sourcefile:'disabled-host.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const disabledMock=createFetchMock();disabledMock.disableNetConnect();
const disabledHost=new Miniflare({modules:true,script:hostBuild.outputFiles[0].text,compatibilityDate:'2026-05-15',fetchMock:disabledMock});
try{
 for(const endpoint of ['snapshot','status']){
  const r=await disabledHost.dispatchFetch(`https://test.invalid/api/v1/ashare/sina/${endpoint}`);
  assert.equal(r.status,403);assert.equal((await r.json()).state,'source_use_review_pending');
 }
 console.log('PASS checked-in host disabled; no database or source access');
}finally{await disabledHost.dispose();await disabledMock.close();}
