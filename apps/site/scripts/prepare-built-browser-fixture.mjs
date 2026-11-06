/** Offline QA only: executes the unmodified production Worker in native workerd.
 * No component substitutions, provider calls, production auth, or production DB.
 * Usage: node scripts/prepare-built-browser-fixture.mjs [built-dist] [output-dir]
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,cp,stat,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const dist=resolve(root,process.argv[2]??'dist');
const output=resolve(root,process.argv[3]??'.offline-built-browser');
assert.notEqual(output,dist,'Fixture output must not overwrite production build');
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,createFetchMock}=wranglerRequire('miniflare');
const config=JSON.parse(await readFile(join(dist,'server/wrangler.json'),'utf8'));
const mock=createFetchMock();mock.disableNetConnect();
const server=join(dist,'server');
const modulePaths=(await readdir(server,{recursive:true})).filter(p=>/\.m?js$/.test(p));
modulePaths.sort((a,b)=>a===config.main?-1:b===config.main?1:a.localeCompare(b));
const mf=new Miniflare({modules:modulePaths.map(p=>({type:'ESModule',path:join(server,p)})),modulesRoot:server,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:{DB:'synthetic-browser-fixture-only'},fetchMock:mock});
const routes=['/','/ashare','/taiwan','/brazil','/markets','/europe','/equities','/asean','/crypto','/polymarket','/futures','/forex','/diagnostics'];
const headers={'oai-authenticated-user-id':'synthetic-offline-qa','oai-authenticated-user-email':'synthetic-qa@example.invalid'};
const bootstrap=String.raw`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'; worker-src 'none'">
<script data-offline-qa-bootstrap>
(()=>{
'use strict';
const originalFetch=window.fetch.bind(window);
const log=window.__OFFLINE_QA__={synthetic:true,scenario:'schema-error',requests:[],blocked:[],note:'Synthetic schema-invalid API responses. No live data. Original production SSR and client assets.'};
const block=(kind,url)=>{log.blocked.push({kind,url:String(url)});throw new TypeError('Offline QA blocks '+kind);};
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
 const signal=init?.signal??input?.signal;if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 log.requests.push(url.pathname+url.search);
 if(url.origin!==location.origin)return block('external fetch',url);
 if(url.pathname.startsWith('/api/'))return new Response(JSON.stringify({synthetic:true,scenario:'schema-error',error:'OFFLINE_QA_SCHEMA_INVALID',message:'Synthetic invalid response for safe browser error-state verification; no provider requested.'}),{status:200,headers:{'content-type':'application/json','x-offline-qa':'synthetic-schema-error'}});
 const h=new Headers(init?.headers??input?.headers);
 if(h.get('RSC')==='1'||url.searchParams.has('_rsc'))return originalFetch('/__offline/rsc'+(url.pathname==='/'?'/index':url.pathname)+'.txt').then(async r=>new Response(await r.text(),{status:r.status,headers:{'content-type':'text/x-component'}}));
 if(url.pathname.startsWith('/_next/')||url.pathname.startsWith('/assets/')||url.pathname.startsWith('/geography/')||url.pathname.startsWith('/__offline/'))return originalFetch(input,init);
 return block('unexpected same-origin fetch',url);
};
window.XMLHttpRequest=class{open(){block('XMLHttpRequest','disabled')}send(){block('XMLHttpRequest','disabled')}};
window.WebSocket=class{constructor(url){block('WebSocket',url)}};
window.EventSource=class{constructor(url){block('EventSource',url)}};
navigator.sendBeacon=(url)=>{log.blocked.push({kind:'beacon',url:String(url)});return false;};
document.addEventListener('click',event=>{const a=event.target.closest?.('a');if(a&&new URL(a.href,location.href).origin!==location.origin){event.preventDefault();log.blocked.push({kind:'external navigation',url:a.href});}},true);
window.open=(url)=>{log.blocked.push({kind:'window.open',url:String(url)});return null;};
})();
</script>`;
const manifest={synthetic:true,scenario:'schema-error',dist,createdAt:new Date().toISOString(),providerRequestsAllowed:false,rawHtmlPreserved:true,pages:[]};
try{
 await mkdir(output,{recursive:true});await cp(join(dist,'client'),output,{recursive:true});
 for(const route of routes){
  const response=await mf.dispatchFetch('http://offline.local'+route,{headers});
  const raw=await response.text();assert.equal(response.status,200,`${route}: SSR status ${response.status}`);assert.match(raw,/<html[\s>]/i);
  const dependencies=[...raw.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(p=>p.startsWith('/')&&/\.(?:js|css)(?:\?|$)/.test(p));
  for(const asset of dependencies)assert.ok((await stat(join(dist,'client',asset.split('?')[0])).catch(()=>null))?.isFile(),`${route} missing built asset ${asset}`);
  const preview=raw.replace(/<head([^>]*)>/i,`<head$1>${bootstrap}`);assert.notEqual(preview,raw,'Expected head insertion');assert.equal(preview.replace(bootstrap,''),raw,'Production HTML changed beyond bootstrap insertion');
  const path=route==='/'?'index':route.slice(1);const rawPath=join(output,'__offline/raw',path+'.html');const pagePath=join(output,route==='/'?'index.html':route.slice(1)+'/index.html');
  await mkdir(dirname(rawPath),{recursive:true});await mkdir(dirname(pagePath),{recursive:true});await writeFile(rawPath,raw);await writeFile(pagePath,preview);
  const rsc=await mf.dispatchFetch('http://offline.local'+route,{headers:{...headers,RSC:'1'}});const rscText=await rsc.text();assert.equal(rsc.status,200);assert.match(rsc.headers.get('content-type')??'',/text\/x-component/);
  const rscPath=join(output,'__offline/rsc',path+'.txt');await mkdir(dirname(rscPath),{recursive:true});await writeFile(rscPath,rscText);
  manifest.pages.push({route,status:response.status,rawSha256:createHash('sha256').update(raw).digest('hex'),dependencies:[...new Set(dependencies)],rawPath:rawPath.slice(output.length+1),previewPath:pagePath.slice(output.length+1),rscPath:rscPath.slice(output.length+1)});
  console.log(`Captured production SSR + RSC ${route}; verified ${dependencies.length} asset references`);
 }
 await writeFile(join(output,'__offline/manifest.json'),JSON.stringify(manifest,null,2));
 await writeFile(join(output,'__offline/README.txt'),'SYNTHETIC OFFLINE QA ONLY\nUnmodified production Worker rendered by native Miniflare/workerd. No external fetch permitted.\nPreview HTML differs only by an early CSP and request-stubbing bootstrap. Built client assets copied unchanged.\nAPI responses intentionally fail schemas to test honest error/empty states, not populated/live data.\nEvery API fetch is stubbed before any application JS. Local navigation and RSC captures use actual production routes.\nRaw HTML under __offline/raw. Manifest records SHA-256 and verified asset references.\nDo not deploy this fixture or use it as live data evidence. Browser hydration/console/mobile QA is separate.\n');
 console.log(`Offline fixture ready: ${output}`);
}finally{await mf.dispose();await mock.close();}
