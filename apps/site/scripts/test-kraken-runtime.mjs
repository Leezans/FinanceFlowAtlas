/** Native workerd, synthetic fixtures only. Every external network call is blocked. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`
 import {krakenHandler} from './lib/crypto/host';
 import {createKrakenHandler} from './lib/crypto/kraken';
 import {D1KrakenGate} from './lib/crypto/source-gate';
 export default {fetch(request,env){return request.headers.has('x-test-cold')?createKrakenHandler({gate:new D1KrakenGate(env.DB)})(request):krakenHandler(request);}};`,resolveDir:root,sourcefile:'kraken-offline-worker.ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],write:false});
const migration=await readFile(new URL('../drizzle/0003_brainy_donald_blake.sql',import.meta.url),'utf8');
const aMigration=await readFile(new URL('../drizzle/0001_wild_jigsaw.sql',import.meta.url),'utf8');
const url='https://test.invalid/api/v1/crypto/kraken/snapshot';
const fixture={error:[],result:{XXBTZUSD:{c:['12.34567890','0.1'],v:['999','3.125'],p:['999','12.1'],t:[999,8]},XETHZUSD:{c:['2.5','1'],v:['999','0'],p:['999','2.4'],t:[999,0]}}};
async function scenario(mode,fn){
 let calls=0;const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://api.kraken.com').intercept({method:'GET',path:'/0/public/Ticker?pair=XBTUSD,ETHUSD'}).reply(()=>{
  calls++;if(mode==='denied')return {statusCode:403,data:''};
  if(mode==='temporary')return {statusCode:503,data:'{}',responseOptions:{headers:{'content-type':'application/json','retry-after':'1800'}}};
  const raw=Buffer.from(JSON.stringify(fixture)),encoded=mode==='gzip'?gzipSync(raw):mode==='br'?brotliCompressSync(raw):raw;
  return {statusCode:200,data:encoded,responseOptions:{headers:{'content-type':'application/json','content-length':String(encoded.length),...(mode==='plain'?{}:{'content-encoding':mode})}}};
 }).persist();
 const mf=new Miniflare({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],fetchMock:mock});
 try{const db=await mf.getD1Database('DB');for(const sql of [aMigration,migration])for(const statement of sql.split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();await db.prepare("UPDATE ashare_source_gate SET status='blocked',reason_code='http_403' WHERE id='single_upstream'").run();await fn(mf,db,()=>calls);assert.equal((await db.prepare('SELECT status FROM ashare_source_gate').first()).status,'blocked');}
 finally{await mf.dispose();await mock.close();}
}
for(const encoding of ['plain','gzip','br'])await scenario(encoding,async(mf,db,calls)=>{
 const status=await mf.dispatchFetch(url.replace('snapshot','status'));assert.equal((await status.json()).state,'unavailable');assert.equal(calls(),0);
 const r=await mf.dispatchFetch(url),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.snapshot.rows[0].last_price_usd,'12.34567890');assert.equal(body.snapshot.rows[0].volume_base_24h,'3.125');assert.equal(body.snapshot.source_observed_at,null);assert.equal(calls(),1);
 const cached=await mf.dispatchFetch(url);assert.equal(cached.status,200);assert.equal(calls(),1);
 const cold=await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal(cold.status,503);assert.equal((await cold.json()).status.error_code,'source_cooldown');assert.equal(calls(),1);
 const row=await db.prepare('SELECT status,not_before_ms FROM kraken_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+50_000);
 console.log(`PASS checked-in Kraken host ${encoding}; exact decimals; shared cold-worker cooldown; A-share gate untouched`);
});
await scenario('temporary',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'unavailable');
 const row=await db.prepare('SELECT status,not_before_ms FROM kraken_source_gate').first();assert.equal(row.status,'idle');assert.ok(row.not_before_ms>Date.now()+1_790_000);
 await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal(calls(),1);console.log('PASS temporary Retry-After persists across workers');
});
await scenario('denied',async(mf,db,calls)=>{
 const r=await mf.dispatchFetch(url);assert.equal(r.status,503);assert.equal((await r.json()).status.state,'denied');
 const cold=await mf.dispatchFetch(url,{headers:{'x-test-cold':'1'}});assert.equal((await cold.json()).status.state,'denied');assert.equal(calls(),1);
 assert.equal((await db.prepare('SELECT status FROM kraken_source_gate').first()).status,'blocked');console.log('PASS denial persists across workers; no fallback requests');
});
console.log('PASS zero real network calls; no captured provider observations');
