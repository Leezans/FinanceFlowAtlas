/** Native workerd and D1. All external networking disabled; synthetic market data only. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wr('miniflare'),{build}=wr('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
// Test-only bundle instrumentation. Production files and the real host wiring stay unchanged.
// Invalid schema/coverage require an adapter-output fault; oversized candidates below use
// ordinary synthetic source responses through every production parser and validator.
const candidateReturn="if(!parsed.success)return fail('invalid_combined_snapshot');return parsed.data;";
const nativeRun='const result=await this.db.prepare(sql).bind(...values).run();';
const instrument=(source,needle,replacement)=>{
 assert.equal(source.split(needle).length,2,'offline instrumentation anchor must match exactly once');
 return source.replace(needle,replacement);
};
const faultPlugin={name:'offline-deribit-commit-faults',setup(bundle){
 bundle.onLoad({filter:/[/\\]lib[/\\]options[/\\]adapter\.ts$/},async({path})=>({loader:'ts',contents:instrument(await readFile(path,'utf8'),candidateReturn,`
  if(!parsed.success)return fail('invalid_combined_snapshot');
  const candidate=parsed.data,fault=globalThis.__deribitOfflineFault;
  if(fault==='schema')candidate.source='synthetic-invalid-source';
  if(fault==='coverage'){
   candidate.currencies=['BTC'];candidate.coverage='deribit_btc_options';
   candidate.metadata_fetched_at={BTC:candidate.metadata_fetched_at.BTC};
   candidate.rows=candidate.rows.filter(row=>row.underlying_currency==='BTC');
  }
  globalThis.__deribitOfflineCandidate={valid:snapshotSchema.safeParse(candidate).success,coverage:candidate.coverage,bytes:JSON.stringify(candidate).length,rows:candidate.rows.length};
  return candidate;
 `)}));
 bundle.onLoad({filter:/[/\\]lib[/\\]options[/\\]source-gate\.ts$/},async({path})=>({loader:'ts',contents:instrument(await readFile(path,'utf8'),nativeRun,`
  const finish=sql===DERIBIT_SQL.finish;
  if(finish){
   const stats=globalThis.__deribitOfflineStats;stats.finish++;
   if(values[3]===null)stats.cleanup++;else stats.success++;
   if(globalThis.__deribitOfflineFault==='ack-before')throw new Error('synthetic transport rejection before D1 execution');
  }
  const result=await this.db.prepare(sql).bind(...values).run();
  if(finish&&globalThis.__deribitOfflineFault==='ack-after')throw new Error('synthetic lost acknowledgment after native D1 commit');
 `)}));
}};
const {outputFiles}=await build({plugins:[faultPlugin],stdin:{contents:`
 import {optionsHandler} from './lib/options/host';
 let abort;
 globalThis.__deribitOfflineStats={finish:0,success:0,cleanup:0};
 export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/offline/fault/')){globalThis.__deribitOfflineFault=path.slice('/offline/fault/'.length);return new Response('synthetic fault selected');}
  if(path==='/offline/probe')return Response.json({stats:globalThis.__deribitOfflineStats,candidate:globalThis.__deribitOfflineCandidate});
  if(path==='/offline/abort'){abort?.();return new Response('synthetic abort');}
  if(path==='/offline/early'){
   const controller=new AbortController();void new Promise(resolve=>{abort=resolve;}).then(()=>controller.abort());
   void optionsHandler(new Request(new URL('/api/v1/options/deribit/snapshot',request.url),{signal:controller.signal})).then(r=>r.body?.cancel());
   for(let i=0;i<100;i++){const row=await env.DB.prepare('SELECT status FROM deribit_options_gate').first();if(row.status==='busy')return new Response('early',{status:202});await new Promise(r=>setTimeout(r,10));}
   return new Response('admission failed',{status:500});
  }
  return optionsHandler(request);
 }};`,resolveDir:root,sourcefile:'deribit-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migration=await readFile(new URL('../drizzle/0022_deribit_options_gate.sql',import.meta.url),'utf8');
const migrations=(await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)&&n!=='0022_deribit_options_gate.sql').sort();
const names=['BTC-27NOV36-80000-C','BTC-27NOV36-80000-P'];
// Accepted by the existing source identity contract, not captured/real Deribit symbols.
const oversizedNames=Array.from({length:2000},(_,i)=>`BTC-27NOV36-${'0'.repeat(450)}${80000+i}-C`);
const envelope=result=>({jsonrpc:'2.0',testnet:false,result});
function summaries(currency='BTC',oversized=false){return envelope((oversized?oversizedNames:names).map((name,i)=>({instrument_name:name.replace(/^BTC-/,currency+'-'),base_currency:currency,quote_currency:currency,creation_timestamp:Date.now(),mark_price:.02,mark_iv:50,price_change:i?-2:2,bid_price:.019,ask_price:.021,last:.02,volume:i?1:3,volume_usd:i?100:300,open_interest:10})));}
function metadata(currency='BTC',oversized=false){return envelope((oversized?oversizedNames:names).map((name,i)=>({instrument_name:name.replace(/^BTC-/,currency+'-'),base_currency:currency,quote_currency:currency,settlement_currency:currency,counter_currency:'USD',kind:'option',is_active:true,expiration_timestamp:Date.parse('2036-11-27T08:00:00Z'),strike:oversized?80000+i:80000,contract_size:1,option_type:oversized?'call':i?'put':'call'})));}
const url='https://app.invalid/api/v1/options/deribit/snapshot';
async function scenario(initial,fn){
 let mode=initial,summaryCalls=0,metadataCalls=0;const metadataTimes=[],responseSizes=[];const mock=createFetchMock();mock.disableNetConnect();
 const source=mock.get('https://www.deribit.com');
 for(const currency of ['BTC','ETH']){
 const summary=source.intercept({method:'GET',path:`/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`}).reply(()=>{
  summaryCalls++;
  if(mode==='denied'||mode==='eth-denied'&&currency==='ETH')return {statusCode:403,data:''};
  if(mode==='limited')return {statusCode:200,data:JSON.stringify({jsonrpc:'2.0',error:{code:10028,message:'synthetic limit'}}),responseOptions:{headers:{'content-type':'application/json'}}};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'3600'}}};
  const body=summaries(currency,mode==='oversized'),raw=Buffer.from(JSON.stringify(body));responseSizes.push({kind:'summary',currency,bytes:raw.length,rows:body.result.length});const encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 if(mode==='disconnect')summary.delay(5000);
 source.intercept({method:'GET',path:`/api/v2/public/get_instruments?currency=${currency}&kind=option&expired=false`}).reply(()=>{metadataCalls++;metadataTimes.push(Date.now());const body=metadata(currency,mode==='oversized'),data=JSON.stringify(body);responseSizes.push({kind:'metadata',currency,bytes:Buffer.byteLength(data),rows:body.result.length});return {statusCode:200,data,responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 }
 const worker=name=>({name,modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:{DB:'offline-deribit'},fetchMock:mock});
 const mf=new Miniflare({workers:[worker('warm'),worker('cold'),worker('refresh'),worker('legacy')]});
 try{
  const db=await mf.getD1Database('DB','warm');
  for(const name of migrations){const sql=await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();}
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(x=>x.name);
  // Preserve pre-existing stopped providers exactly; the new gate cannot reset them.
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',lease_token=NULL,reason_code='http_403'").run();
  for(const table of ['sina_source_gate','kraken_source_gate','ecb_fx_source_gate','cftc_source_gate','tpex_source_gate','asean_source_gate','cvm_source_gate','worldbank_equity_source_gate','polymarket_source_gate','tpex_summary_gate','cboe_delayed_source_gate','japan_mof_source_gate','taifex_options_gate'])await db.prepare(`UPDATE ${table} SET status='blocked',lease_token=NULL`).run();
  assert.equal(migrations.length+1,24);assert.equal(tables.length,20);
  const before=await Promise.all(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  for(const statement of migration.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
  assert.equal((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.length,21);
  await fn(mf,db,()=>({summaryCalls,metadataCalls}),value=>{mode=value;},metadataTimes,responseSizes);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await db.prepare(`SELECT * FROM ${tables[i]}`).all()).results,before[i].results,`${tables[i]} remains unchanged`);
 }finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls,_setMode,metadataTimes)=>{
 assert.equal((await mf.dispatchFetch(url.replace('snapshot','status'))).status,200);assert.equal(calls().summaryCalls,0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].volume_usd,300);assert.equal(body.snapshot.net_capital_flow,null);assert.equal(body.snapshot.rows.length,4);assert.deepEqual(body.snapshot.currencies,['BTC','ETH']);assert.ok(metadataTimes[1]-metadataTimes[0]>=1000);
 const cold=await (await mf.getWorker('cold')).fetch(url);assert.deepEqual((await cold.json()).snapshot,body.snapshot);assert.deepEqual(calls(),{summaryCalls:2,metadataCalls:2});
 await db.prepare("UPDATE deribit_options_gate SET status='busy',lease_token='synthetic-owned-busy'").run();const busy=await mf.dispatchFetch(url);assert.equal(busy.status,503);assert.equal((await busy.json()).snapshot,null);assert.deepEqual(calls(),{summaryCalls:2,metadataCalls:2});await db.prepare("UPDATE deribit_options_gate SET status='idle',lease_token=NULL").run();
 await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();await (await mf.getWorker('refresh')).fetch(url);assert.deepEqual(calls(),{summaryCalls:4,metadataCalls:2});
 const row=await db.prepare('SELECT * FROM deribit_options_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+59_000);
 console.log(`PASS ${encoding}: source units, cold cache, global cooldown, metadata reuse, all prior provider rows untouched`);
});
for(const mode of ['denied','limited'])await scenario(mode,async(mf,db,calls)=>{const r=await mf.dispatchFetch(url);assert.equal((await r.json()).status.state,'denied');await (await mf.getWorker('cold')).fetch(url);assert.deepEqual(calls(),{summaryCalls:1,metadataCalls:0});assert.equal((await db.prepare('SELECT status FROM deribit_options_gate').first()).status,'blocked');console.log(`PASS persistent ${mode}, including across cold workers`);});
await scenario('temporary',async(mf,db,calls)=>{assert.equal((await mf.dispatchFetch(url)).status,503);const row=await db.prepare('SELECT not_before_ms FROM deribit_options_gate').first();assert.ok(row.not_before_ms>Date.now()+3_590_000);await (await mf.getWorker('cold')).fetch(url);assert.equal(calls().summaryCalls,1);console.log('PASS 1-hour Retry-After and no busy-gate takeover');});
await scenario('plain',async(mf,db,calls,setMode)=>{await mf.dispatchFetch(url);await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();setMode('denied');await (await mf.getWorker('cold')).fetch(url);const warm=await (await mf.dispatchFetch(url)).json();assert.equal(warm.snapshot,null);assert.equal(warm.status.state,'denied');assert.equal((await db.prepare('SELECT payload FROM deribit_options_gate').first()).payload,null);assert.equal(calls().summaryCalls,3);console.log('PASS denial atomically purges shared and warm-worker evidence');});
await scenario('disconnect',async(mf,db,calls)=>{const early=await mf.dispatchFetch('https://app.invalid/offline/early');assert.equal(early.status,202);await early.text();for(let i=0;i<100&&calls().summaryCalls===0;i++)await new Promise(r=>setTimeout(r,20));await mf.dispatchFetch('https://app.invalid/offline/abort');let row;for(let i=0;i<250;i++){row=await db.prepare('SELECT * FROM deribit_options_gate').first();if(row.status==='idle')break;await new Promise(r=>setTimeout(r,20));}assert.equal(row.status,'idle');assert.equal(row.lease_token,null);assert.equal(row.payload,null);assert.equal(calls().metadataCalls,0);console.log('PASS response-finished cancellation retains exact owned D1 cleanup');});
await scenario('eth-denied',async(mf,db,calls)=>{const r=await(await mf.dispatchFetch(url)).json();assert.equal(r.status.state,'denied');assert.equal(r.snapshot,null);await(await mf.getWorker('cold')).fetch(url);assert.deepEqual(calls(),{summaryCalls:2,metadataCalls:0});assert.equal((await db.prepare('SELECT status FROM deribit_options_gate').first()).status,'blocked');console.log('PASS ETH rejection blocks BTC and every cold worker with no partial cache');});
await scenario('plain',async(mf,db,calls)=>{const modern=await(await mf.dispatchFetch(url)).json();const s=modern.snapshot;const legacy={schema:'deribit-btc-options/1',source:'Deribit',currency:'BTC',coverage:'deribit_btc_options',acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at,source_as_of:s.source_as_of,metadata_fetched_at:s.metadata_fetched_at.BTC,net_capital_flow:null,delay_policy:s.delay_policy,rows:s.rows.filter(r=>r.underlying_currency==='BTC').map(row=>{const copy={...row};delete copy.underlying_currency;return copy;})};await db.prepare('UPDATE deribit_options_gate SET payload=?').bind(JSON.stringify(legacy)).run();const prior=await(await(await mf.getWorker('legacy')).fetch(url)).json();assert.deepEqual(prior.snapshot.currencies,['BTC']);assert.equal(prior.snapshot.coverage,'deribit_btc_options');assert.deepEqual(calls(),{summaryCalls:2,metadataCalls:2});await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();const upgraded=await(await(await mf.getWorker('refresh')).fetch(url)).json();assert.deepEqual(upgraded.snapshot.currencies,['BTC','ETH']);assert.deepEqual(calls(),{summaryCalls:4,metadataCalls:3});console.log('PASS v72 BTC cache remains truthful and upgrades without a new gate or reset');});
const probe=async worker=>(await worker.fetch('https://app.invalid/offline/probe')).json();
async function fault(worker,mode){const response=await worker.fetch(`https://app.invalid/offline/fault/${mode}`);assert.equal(response.status,200);await response.text();}
function asLegacy(s){return {schema:'deribit-btc-options/1',source:'Deribit',currency:'BTC',coverage:'deribit_btc_options',acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at,source_as_of:s.source_as_of,metadata_fetched_at:s.metadata_fetched_at.BTC,net_capital_flow:null,delay_policy:s.delay_policy,rows:s.rows.filter(r=>r.underlying_currency==='BTC').map(row=>{const copy={...row};delete copy.underlying_currency;return copy;})};}
const rejectionCases=[['oversized','modern'],['oversized','legacy'],['oversized','empty'],['schema','modern'],['coverage','modern']];
for(const [mode,prior] of rejectionCases)await scenario('plain',async(mf,db,calls,setMode,_metadataTimes,responseSizes)=>{
 let previous=null,oldPayload=null;
 if(prior!=='empty'){
  const seed=await(await mf.dispatchFetch(url)).json();assert.ok(seed.snapshot);
  oldPayload=JSON.stringify(prior==='legacy'?asLegacy(seed.snapshot):seed.snapshot,null,1);
  await db.prepare('UPDATE deribit_options_gate SET payload=?').bind(oldPayload).run();
  previous=(await(await(await mf.getWorker('legacy')).fetch(url)).json()).snapshot;
  assert.ok(previous);assert.deepEqual(previous.currencies,prior==='legacy'?['BTC']:['BTC','ETH']);
 }
 await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();
 const refresh=await mf.getWorker('refresh');
 if(mode==='oversized')setMode(mode);else await fault(refresh,mode);
 const result=await refresh.fetch(url),body=await result.json();
 const details=await probe(refresh),row=await db.prepare('SELECT * FROM deribit_options_gate').first();
 assert.equal(details.candidate.valid,mode!=='schema');
 assert.equal(details.candidate.coverage,mode==='coverage'?'deribit_btc_options':'deribit_btc_eth_options');
 if(mode==='oversized'){
  assert.equal(details.candidate.rows,4000);assert.ok(details.candidate.bytes>3_000_000);
  const observed=responseSizes.slice(-4);assert.equal(observed.length,4);
  assert.deepEqual(observed.map(x=>`${x.kind}:${x.currency}`),['summary:BTC','summary:ETH','metadata:BTC','metadata:ETH']);
  assert.ok(observed.every(x=>x.rows===2000&&x.bytes<1_500_000));
  console.log(`Observed oversized ${prior}: source bytes ${observed.map(x=>x.bytes).join('/')}, combined ${details.candidate.bytes}, gate ${row.status}, finish ${details.stats.finish}`);
 }
 assert.equal(row.status,'idle',`${mode}/${prior}: deterministic rejection must release its owned lease`);
 assert.equal(row.lease_token,null);assert.equal(row.payload,oldPayload,'prior serialized cache remains byte-for-byte unchanged');
 assert.ok(row.not_before_ms>=row.updated_ms+60_000);assert.ok(row.not_before_ms>Date.now()+59_000);
 assert.deepEqual(details.stats,{finish:1,success:0,cleanup:1},'one owned cleanup and no publication SQL');
 assert.equal(result.status,previous?200:503);assert.deepEqual(body.snapshot,previous);
 assert.equal(body.status.state,previous?'stale':'unavailable');
 assert.equal(body.status.error_code,{oversized:'byte_budget',schema:'invalid_snapshot',coverage:'incomplete_option_coverage'}[mode]);
 const totals=calls();
 const repeated=await(await refresh.fetch(url)).json();assert.deepEqual(repeated.snapshot,previous);
 const cold=await(await(await mf.getWorker('cold')).fetch(url)).json();assert.deepEqual(cold.snapshot,previous);
 assert.deepEqual(calls(),totals,'cooldown suppresses warm and cold source retries');
 assert.deepEqual((await probe(refresh)).stats,details.stats,'no duplicate cleanup');
 assert.equal((await db.prepare('SELECT payload FROM deribit_options_gate').first()).payload,oldPayload);
 console.log(`PASS native ${mode}/${prior}: exact old cache, idle gate, owned cleanup, cooldown, no publication`);
});
for(const mode of ['ack-before','ack-after'])await scenario('plain',async(mf,db,calls)=>{
 const initial=await(await mf.dispatchFetch(url)).json();assert.ok(initial.snapshot);
 const oldPayload=(await db.prepare('SELECT payload FROM deribit_options_gate').first()).payload;
 await db.prepare('UPDATE deribit_options_gate SET not_before_ms=0').run();
 const refresh=await mf.getWorker('refresh');await fault(refresh,mode);
 const result=await refresh.fetch(url),body=await result.json();
 assert.equal(result.status,503);assert.equal(body.status.state,'denied');assert.equal(body.status.error_code,'source_gate_outcome_unconfirmed');assert.equal(body.snapshot,null);
 assert.deepEqual((await probe(refresh)).stats,{finish:1,success:1,cleanup:0},'uncertain finish is never retried or cleaned up');
 const row=await db.prepare('SELECT * FROM deribit_options_gate').first();
 if(mode==='ack-before'){
  assert.equal(row.status,'busy');assert.equal(typeof row.lease_token,'string');assert.equal(row.payload,oldPayload);
  // Even an ancient busy marker is not a takeover permission.
  await db.prepare('UPDATE deribit_options_gate SET updated_ms=0,not_before_ms=0').run();
 }else{
  assert.equal(row.status,'idle');assert.equal(row.lease_token,null);assert.notEqual(row.payload,oldPayload);
  assert.ok(row.not_before_ms>Date.now()+59_000);assert.deepEqual(JSON.parse(row.payload).currencies,['BTC','ETH']);
 }
 const totals=calls();
 const same=await(await refresh.fetch(url)).json();assert.equal(same.snapshot,null);
 for(const name of ['warm','cold','legacy']){
  const response=await(await mf.getWorker(name)).fetch(url),observed=await response.json();
  if(mode==='ack-before'){assert.equal(response.status,503);assert.equal(observed.snapshot,null);}
  else{assert.equal(response.status,200);assert.deepEqual(observed.snapshot,JSON.parse(row.payload));}
 }
 assert.deepEqual(calls(),totals);assert.deepEqual((await probe(refresh)).stats,{finish:1,success:1,cleanup:0});
 const after=await db.prepare('SELECT * FROM deribit_options_gate').first();
 assert.equal(after.status,row.status);assert.equal(after.lease_token,row.lease_token);assert.equal(after.payload,row.payload);
 console.log(`PASS native ${mode}: actual D1 boundary, fail-closed response, no blind retry, cleanup or busy takeover`);
});
console.log('PASS all 24 migrations and 20 unrelated tables preserved (21 total); external network disabled; no captured provider observations bundled');
