/** Native workerd/D1 with synthetic values only. Real network is disabled. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),runtime=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=runtime('miniflare'),{build}=runtime('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`import {equityHandler} from './lib/equity/host';export default {fetch:equityHandler};`,resolveDir:root},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const names=['0000_silly_ogun','0001_wild_jigsaw','0002_faithful_pyro','0003_brainy_donald_blake','0004_ecb_fx_gate','0005_cftc_futures_gate','0006_ecb_fx_shared_cache','0007_tpex_institutional_gate','0008_asean_fdi_gate','0009_cvm_monthly_fund_gate','0010_ashare_legacy_reconciliation','0011_worldbank_equity_cache'];
const migrations=await Promise.all(names.map(n=>readFile(new URL(`../drizzle/${n}.sql`,import.meta.url),'utf8')));
const priorGates=['ashare_source_gate','sina_source_gate','kraken_source_gate','ecb_fx_source_gate','cftc_source_gate','tpex_source_gate','asean_source_gate','cvm_source_gate'];
const end=new Date().getUTCFullYear()-1;
const path=`/v2/country/all/indicator/CM.MKT.LCAP.CD;CM.MKT.TRAD.CD?source=2&date=${end-2}:${end}&format=json&per_page=5000`;
const fixture=[{page:1,pages:1,per_page:5000,total:2,lastupdated:`${end}-12-31`},['CM.MKT.LCAP.CD','CM.MKT.TRAD.CD'].map(id=>({indicator:{id,value:'Synthetic indicator'},country:{id:'US',value:'Synthetic USA'},countryiso3code:'USA',date:String(end),value:1000000000,unit:'',obs_status:'',decimal:0}))];
const url='https://test.invalid/api/v1/equities/snapshot';
async function scenario(mode,check){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://api.worldbank.org').intercept({method:'GET',path}).reply(()=>{
  calls++;if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'172800'}}};
  const raw=Buffer.from(JSON.stringify(fixture)),data=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data,responseOptions:{headers:{'content-type':'application/json','content-length':String(data.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-equity-shared-cache'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const sql of migrations.slice(0,-1))for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();
  for(const table of priorGates.slice(1))await db.prepare(`UPDATE ${table} SET status='blocked'`).run();
  const previous=await Promise.all(priorGates.map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  for(const statement of migrations.at(-1).split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  await check(mf,db,()=>calls,next=>{mode=next});
  for(let i=0;i<priorGates.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${priorGates[i]}`).all()).results,previous[i].results,`${priorGates[i]} untouched`);
 }finally{await mf.dispose();await mock.close();}
}
for(const mode of ['plain','gzip','br'])await scenario(mode,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].iso3,'USA');assert.equal(body.snapshot.rows[0].capitalization.usd,1000000000);assert.equal(body.snapshot.rows[0].capitalization.year,end);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);const cold=await(await mf.getWorker('cold')).fetch(url);assert.equal(cold.status,200);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.equal(calls(),1);
 const state=await db.prepare('SELECT status,not_before_ms FROM worldbank_equity_source_gate').first();assert.equal(state.status,'idle');assert.ok(state.not_before_ms>Date.now()+86390000);
 await db.prepare("UPDATE worldbank_equity_source_gate SET payload='{}'").run();const bad=await(await mf.getWorker('cold')).fetch(url);assert.equal(bad.status,503);assert.equal((await bad.json()).status.error_code,'source_gate_unavailable');assert.equal(calls(),1);
 console.log(`PASS ${mode} JSON; atomic cache; cold worker; daily cooldown; corrupt-cache fail closed`);
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).snapshot,null);const state=await db.prepare('SELECT status,not_before_ms FROM worldbank_equity_source_gate').first();assert.equal(state.status,'idle');assert.ok(state.not_before_ms>Date.now()+172790000);await(await mf.getWorker('cold')).fetch(url);assert.equal(calls(),1);console.log('PASS shared 48h Retry-After');
});
await scenario('plain',async(mf,db,calls,setMode)=>{
 assert.equal((await mf.dispatchFetch(url)).status,200);await db.prepare('UPDATE worldbank_equity_source_gate SET not_before_ms=0').run();setMode('denied');
 const denied=await(await mf.getWorker('cold')).fetch(url);assert.equal((await denied.json()).status.state,'denied');const state=await db.prepare('SELECT status,payload FROM worldbank_equity_source_gate').first();assert.equal(state.status,'blocked');assert.equal(state.payload,null);
 const warm=await(await mf.dispatchFetch(url)).json();assert.equal(warm.status.state,'denied');assert.equal(warm.snapshot,null);assert.equal(calls(),2);console.log('PASS durable denial invalidates warm/shared cache and never retries');
});
console.log('PASS every prior gate unchanged, zero real network calls and no captured observations');
