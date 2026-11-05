/** Offline native-workerd checks. Synthetic XML only; real network disabled. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const root=fileURLToPath(new URL('..',import.meta.url));
const {outputFiles}=await build({stdin:{contents:"import {serveFx} from './lib/fx/route'; export default {fetch:serveFx};",resolveDir:root,sourcefile:'offline-fx-host.ts'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],target:'es2022',write:false});
const xml=Buffer.from(`<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube><Cube time="2020-01-02"><Cube currency="USD" rate="2.0000"/><Cube currency="CNY" rate="10.0000"/></Cube></Cube></gesmes:Envelope>`);
for(const mode of ['plain','gzip','br','denied','invalid']){
 const mock=createFetchMock();mock.disableNetConnect();let calls=0;
 mock.get('https://www.ecb.europa.eu').intercept({method:'GET',path:'/stats/eurofxref/eurofxref-daily.xml'}).reply(()=>{
  calls++;const data=mode==='gzip'?gzipSync(xml):mode==='br'?brotliCompressSync(xml):mode==='invalid'?Buffer.from('<bad/>'):xml;
  return {statusCode:mode==='denied'?403:200,data,responseOptions:{headers:{'content-type':'text/xml',...(['gzip','br'].includes(mode)?{'content-encoding':mode}:{})}}};
 }).persist();
 const mf=new Miniflare({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',fetchMock:mock});
 try{
  const first=await mf.dispatchFetch('https://offline.invalid/api/v1/fx/reference'),body=await first.json();
  assert.equal(first.headers.get('cache-control'),'private, no-store');
  if(['plain','gzip','br'].includes(mode)){
   assert.equal(first.status,200,JSON.stringify(body));assert.equal(body.snapshot.reference_date,'2020-01-02');assert.equal(body.snapshot.rates.length,2);assert.equal(body.snapshot.rates[1].per_eur,'2.0000');
  }else{assert.equal(first.status,503);assert.equal(body.snapshot,null);assert.equal(body.error_code,mode==='denied'?'source_stopped':'invalid_source')}
  await mf.dispatchFetch('https://offline.invalid/api/v1/fx/reference');assert.equal(calls,1);
  console.log(`PASS native workerd FX ${mode}: XML parser, response headers, bounded read and cache/stop behavior`);
 }finally{await mf.dispose();await mock.close()}
}
