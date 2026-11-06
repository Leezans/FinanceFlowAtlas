/** Synthetic browser QA only. Never deploy this output. Uses unchanged built JS/CSS.
 * node scripts/prepare-diagnostics-browser-fixture.mjs [built-dist] [output-dir]
 */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, process.argv[2] ?? 'dist');
const previewRoot = resolve(root, process.argv[3] ?? '.offline-built-browser-diagnostics');
const output = join(previewRoot, 'public');
assert.notEqual(previewRoot, root); assert.notEqual(previewRoot, dist);
execFileSync(process.execPath, [join(root, 'scripts/prepare-built-browser-fixture.mjs'), dist, output], {stdio: 'inherit'});
// IDs come from the real read-only handler using its fixed schema, with no DB.
const require = (await import('node:module')).createRequire(import.meta.url);
const wranglerRequire = (await import('node:module')).createRequire(require.resolve('wrangler/package.json'));
const {build} = wranglerRequire('esbuild'), {Miniflare} = wranglerRequire('miniflare');
const bundled = await build({stdin: {contents: "import {createDiagnosticsHandler} from './lib/diagnostics/handler'; export default {fetch: createDiagnosticsHandler()};", resolveDir: root, sourcefile: 'offline-diagnostic-fixture.ts'}, bundle: true, format: 'esm', platform: 'neutral', write: false});
let outbound = 0;
const mf = new Miniflare({modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-05-15', outboundService: () => {outbound++; return new Response(null, {status: 500});}});
let empty;
try {const response = await mf.dispatchFetch('https://offline.invalid/api/v1/diagnostics'); assert.equal(response.status, 503); empty = await response.json(); assert.equal(outbound, 0);} finally {await mf.dispose();}
const populated = structuredClone(empty);
populated.metadata_complete = false;
populated.sources.forEach((row, index) => {
  row.database_observed_at = '2026-11-06T10:00:00.000Z'; row.metadata = 'read'; row.coordination = 'idle';
  row.cache.record_present = true; row.cache.recorded_acquisition_at = '2026-11-06T09:00:00.000Z';
  row.cache.recorded_collection_start_at = '2026-11-06T08:59:00.000Z';
  if (index === 0) row.cache.recorded_expiry_at = '2026-11-06T09:30:00.000Z';
  if (index === 1) {row.coordination = 'stopped'; row.cache.record_present = null; row.cache.recorded_acquisition_at = null; row.cache.recorded_collection_start_at = null;}
  if (index === 2) {row.coordination = 'cooldown'; row.next_attempt_not_before = '2026-11-06T11:00:00.000Z'; row.cache.recorded_expiry_at = '2026-11-06T12:00:00.000Z';}
  if (index === 3) {row.metadata = 'not_initialized'; row.coordination = 'unknown'; row.cache.record_present = null; row.cache.recorded_acquisition_at = null; row.cache.recorded_collection_start_at = null;}
  if (index === 4) {row.metadata = 'unavailable'; row.coordination = 'unknown'; row.cache.record_present = null; row.cache.recorded_acquisition_at = null; row.cache.recorded_collection_start_at = null;}
});
const bootstrap = `<script data-diagnostics-offline-fixture>
(()=>{
 const original=window.fetch.bind(window), populated=${JSON.stringify(populated)}, empty=${JSON.stringify(empty)};
 const scenario=new URL(location.href).searchParams.get('fixture')||'mixed';
 window.__DIAGNOSTICS_QA__={synthetic:true,scenario,requests:0};
 window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  if(url.origin!==location.origin||url.pathname!=='/api/v1/diagnostics')return original(input,init);
  window.__DIAGNOSTICS_QA__.requests++;
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(scenario==='auth')return new Response('SYNTHETIC_AUTH_PAGE',{status:401});
  if(scenario==='invalid')return new Response('<html>SYNTHETIC_LOGIN_HTML</html>',{headers:{'content-type':'text/html'}});
  return new Response(JSON.stringify(scenario==='empty'?empty:populated),{status:scenario==='empty'?503:200,headers:{'content-type':'application/json','x-offline-qa':'synthetic'}});
 };
})();
</script><style data-synthetic-qa-label>body::before{content:'SYNTHETIC OFFLINE QA · NOT REAL DATA';display:block;padding:10px;background:#ffe9a8;color:#2d250d;font:14px system-ui}</style>`;
const page = join(output, 'diagnostics/index.html'), html = await readFile(page, 'utf8');
assert.ok(html.includes('data-offline-qa-bootstrap'));
// Install after the global outbound block, still before the first application script.
const marker = '</script>';
const end = html.indexOf(marker, html.indexOf('data-offline-qa-bootstrap')) + marker.length;
assert.ok(end > marker.length); await writeFile(page, html.slice(0, end) + bootstrap + html.slice(end));
await mkdir(join(previewRoot, '.openai'), {recursive: true});
await writeFile(join(previewRoot, '.openai/hosting.json'), JSON.stringify({static: {directory: 'public'}}));
await writeFile(join(previewRoot, 'package.json'), JSON.stringify({name: 'synthetic-diagnostics-browser-qa', private: true}));
await writeFile(join(output, 'diagnostics-mobile.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic 320px diagnostics QA</title></head><body style="margin:16px;background:#dde5eb"><p>SYNTHETIC OFFLINE QA · 320px CSS viewport · NOT REAL DATA</p><iframe title="320px diagnostic preview" src="/diagnostics/" style="width:320px;height:1000px;border:1px solid #222;display:block"></iframe></body></html>');
await writeFile(join(output, '__offline/diagnostics-scenarios.json'), JSON.stringify({synthetic: true, providerRequestsAllowed: false, routes: ['/diagnostics/', '/diagnostics/?fixture=empty', '/diagnostics/?fixture=auth', '/diagnostics/?fixture=invalid', '/diagnostics-mobile.html']}));
console.log(`Synthetic diagnostic browser fixture ready: ${previewRoot}`);
