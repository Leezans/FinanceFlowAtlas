/** Native workerd + actual D1/SQLite. Synthetic fixtures only; no external network route. */
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gzipSync, brotliCompressSync} from 'node:zlib';

const require = createRequire(import.meta.url), wr = createRequire(require.resolve('wrangler/package.json'));
const {Miniflare, createFetchMock} = wr('miniflare'), {build} = wr('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));
const fixtureBuild = await build({stdin: {contents: `
 export {taifexPayload} from './tests/taifex-options-fixture';
 export {makeFuturesFixture} from './tests/taifex-futures-fixture';
 export {TAIFEX_URL,parseTaifex} from './lib/options/taifex/adapter';
 export {FUTURES_URL,parseFutures} from './lib/futures/taifex/adapter';
 export {bundleSchema,MAX_ACQUISITION_MS} from './lib/taifex/model';
 `, resolveDir: root, sourcefile: 'offline-taifex-fixtures.ts'}, bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false});
const {taifexPayload, makeFuturesFixture, TAIFEX_URL, FUTURES_URL, parseTaifex, parseFutures, bundleSchema, MAX_ACQUISITION_MS} =
 await import('data:text/javascript;base64,' + Buffer.from(fixtureBuild.outputFiles[0].text).toString('base64'));
const {outputFiles} = await build({stdin: {contents: `
 import {waitUntil} from 'cloudflare:workers';
 import {GET as optionsSnapshot} from './app/api/v1/options/taifex/snapshot/route';
 import {GET as optionsStatus} from './app/api/v1/options/taifex/status/route';
 import {GET as futuresSnapshot} from './app/api/v1/futures/taifex/snapshot/route';
 import {GET as futuresStatus} from './app/api/v1/futures/taifex/status/route';
 import {createTaifexProvider} from './lib/taifex/handler';
 import {D1TaifexGate,TAIFEX_SQL} from './lib/taifex/source-gate';
 const routes={
  '/api/v1/options/taifex/snapshot':optionsSnapshot,'/api/v1/options/taifex/status':optionsStatus,
  '/api/v1/futures/taifex/snapshot':futuresSnapshot,'/api/v1/futures/taifex/status':futuresStatus,
 };
 let abort,earlyResult=null;
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function faultProvider(env,fault){
  const db={prepare(sql){return {bind(...values){return {async run(){
   if(fault==='finish-late'&&sql===TAIFEX_SQL.finish)await pause(2500);
   if(fault==='inspect-unavailable'&&sql===TAIFEX_SQL.inspect)throw new Error('synthetic D1 unavailable');
   const result=await env.DB.prepare(sql).bind(...values).run();
   if(fault==='acquire-late'&&sql===TAIFEX_SQL.acquire)await pause(750);
   return result;
  }}}}}};
  return createTaifexProvider({gate:new D1TaifexGate(db),waitUntil});
 }
 export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/offline/abort'){abort?.();return new Response('synthetic cancellation');}
  if(path==='/offline/result')return Response.json(earlyResult);
  const fault=request.headers.get('x-offline-fault');
  if(path==='/offline/early'){
   const controller=new AbortController();earlyResult=null;
   void new Promise(resolve=>{abort=resolve;}).then(()=>controller.abort());
   const page=url.searchParams.get('page')==='futures'?'futures':'options';
   const provider=fault?faultProvider(env,fault):null;
   const handler=provider?provider[page+'Handler']:routes['/api/v1/'+page+'/taifex/snapshot'];
   void handler(new Request(new URL('/api/v1/'+page+'/taifex/snapshot',url),{signal:controller.signal})).then(async r=>{earlyResult=await r.json();});
   for(let i=0;i<100;i++){
    const row=await env.DB.prepare("SELECT status FROM taifex_options_gate WHERE id='daily_institutions'").first();
    if(row.status==='busy')return new Response('response ended before owned work',{status:202});
    await pause(10);
   }
   return new Response('synthetic acquisition did not start',{status:500});
  }
  if(!routes[path])return new Response('offline route not found',{status:404});
  if(fault){const provider=faultProvider(env,fault);return provider[path.includes('/futures/')?'futuresHandler':'optionsHandler'](request);}
  return routes[path](request);
 }};`, resolveDir: root, sourcefile: 'offline-taifex-host.ts'}, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers'], write: false});

const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => /^\d{4}.*\.sql$/.test(name)).sort();
assert.equal(migrations.length, 27, 'only the isolated news gate and its two allowlist extensions are appended');
assert.equal(migrations[23], '0023_taifex_options_gate.sql');
assert.equal(migrations[24], '0024_news_source_gate.sql');
assert.equal(migrations[25], '0025_news_europe_calendars.sql');
assert.equal(migrations.at(-1), '0026_news_asia_technology.sql');
const migrationSQL = await Promise.all(migrations.map(name => readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')));
const HOUR = 3_600_000, DAY = 24 * HOUR;
const pages = ['options', 'futures'];
const url = (page, mode = 'snapshot') => `https://app.invalid/api/v1/${page}/taifex/${mode}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const dayAgo = days => new Date(Date.now() + 8 * HOUR - days * DAY).toISOString().slice(0, 10);
const withDate = (rows, date) => rows.map(row => ({...row, Date: date.replaceAll('-', '')}));
const schemaSQL = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";
async function apply(db, sql) {for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement.trim()).run();}
async function row(db) {return db.prepare("SELECT * FROM taifex_options_gate WHERE id='daily_institutions'").first();}
async function until(check, message, attempts = 150) {for (let i = 0; i < attempts; i++) {const result = await check(); if (result) return result; await pause(20);} assert.fail(message);}
async function json(worker, page, mode = 'snapshot', init) {const response = await worker.fetch(url(page, mode), init); return {response, body: await response.json()};}
async function seed(db, payload, {status = 'idle', lease = null, retry = Date.now() + HOUR, updated = 123} = {}) {
 await db.prepare("UPDATE taifex_options_gate SET status=?,lease_token=?,payload=?,updated_ms=?,not_before_ms=? WHERE id='daily_institutions'")
  .bind(status, lease, payload, updated, retry).run();
}
async function statusesUnchanged(t, worker = t.warm) {
 const before = await row(t.db), calls = t.calls();
 for (const page of pages) {const {response} = await json(worker, page, 'status'); assert.equal(response.headers.get('cache-control'), 'no-store');}
 assert.deepEqual(await row(t.db), before, 'both status routes are read-only');
 assert.equal(t.calls(), calls, 'status routes never acquire a source budget');
}
function assertPair(starts, offset = 0) {
 assert.deepEqual(starts.slice(offset, offset + 2).map(start => start.page), pages, 'source order must be options then futures');
 assert.ok(starts[offset + 1].at - starts[offset].at >= 1100, `GET starts only ${starts[offset + 1].at - starts[offset].at} ms apart`);
}
let completed = 0;
async function scenario(name, settings, fn) {
 if (typeof settings === 'function') {fn = settings; settings = {};}
 if (process.env.TAIFEX_RUNTIME_FILTER && !name.includes(process.env.TAIFEX_RUNTIME_FILTER)) return;
 const reportDates = {options: dayAgo(1), futures: dayAgo(2), ...settings.dates};
 const payloads = {options: withDate(taifexPayload(), reportDates.options), futures: withDate(makeFuturesFixture(), reportDates.futures)};
 const modes = {options: settings.encoding ?? 'plain', futures: settings.encoding ?? 'plain', ...settings.modes};
 const delays = {...settings.delays}, starts = [];
 const iso = new Date(Date.now() - 1000).toISOString();
 const legacy = parseTaifex(payloads.options, iso, iso);
 const bundle = bundleSchema.parse({schema: 'taifex-institutions/2', source: 'TAIFEX', acquisition_started_at: iso, fetched_at: iso,
  options: legacy, futures: parseFutures(payloads.futures, iso, iso)});
 const sourceResponse = page => {
  starts.push({page, at: Date.now()});
  const mode = modes[page];
  if (mode === '403' || mode === '429') return {statusCode: Number(mode), data: 'synthetic denied'};
  if (mode === 'temporary') return {statusCode: 503, data: '{}', responseOptions: {headers: {'content-type': 'application/json', 'retry-after': '7200'}}};
  if (mode === 'html' || mode === 'json-html') return {statusCode: 200, data: '<html>synthetic challenge</html>', responseOptions: {headers: {'content-type': mode === 'html' ? 'text/html' : 'application/octet-stream'}}};
  const encoding = mode.split('-')[0];
  const text = (mode.endsWith('-expanded') ? ' '.repeat(256_001) : '') + JSON.stringify(mode === 'oversize-utf8' ? [{...payloads[page][0], ContractCode: '界'.repeat(90_000)}] : mode === 'malformed' ? payloads[page].slice(1) : payloads[page]);
  const raw = Buffer.from(text);
  if (mode === 'oversize-utf8') {assert.ok(text.length < 256_000); assert.ok(raw.length > 256_000);}
  const encoded = encoding === 'gzip' ? gzipSync(raw) : encoding === 'br' ? brotliCompressSync(raw) : raw;
  if (mode.endsWith('-expanded')) {assert.ok(raw.length > 256_000); assert.ok(encoded.length < 256_000);}
  return {statusCode: 200, data: encoded, responseOptions: {headers: {'content-type': ['json', 'gzip', 'br'].includes(mode) || mode.endsWith('-expanded') ? 'application/json' : 'application/octet-stream',
   'content-length': String(encoded.length), ...(['gzip', 'br'].includes(encoding) ? {'content-encoding': encoding} : {})}}};
 };
 // fetchMock correctly forwards compressed JSON. Its Node-to-workerd forwarding
 // corrupts compressed octet-stream bodies, which use the fixed-URL outbound
 // service instead. Neither transport has any real-network fallback.
 const mock = createFetchMock(); mock.disableNetConnect();
 const compressedJSON = ['gzip', 'br'].includes(settings.encoding);
 if (compressedJSON) for (const [page, target] of [['options', TAIFEX_URL], ['futures', FUTURES_URL]]) {
  const source = new URL(target);
  mock.get(source.origin).intercept({method: 'GET', path: source.pathname, headers: {accept: 'application/json'}}).reply(() => sourceResponse(page)).persist();
 }
 const outboundService = async request => {
  const page = request.url === TAIFEX_URL ? 'options' : request.url === FUTURES_URL ? 'futures' : null;
  assert.ok(page, `unapproved source URL: ${request.url}`);
  assert.equal(request.method, 'GET'); assert.equal(request.headers.get('accept'), 'application/json');
  assert.equal(request.headers.get('authorization'), null); assert.equal(request.headers.get('cookie'), null);
  const response = sourceResponse(page);
  if (delays[page]) await pause(delays[page]);
  return new Response(response.data, {status: response.statusCode, headers: response.responseOptions?.headers});
 };
 const worker = name => ({name, modules: true, script: outputFiles[0].text, compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat', 'enable_request_signal'], d1Databases: {DB: 'offline-taifex'},
  ...(compressedJSON ? {fetchMock: mock} : {outboundService})});
 const mf = new Miniflare({workers: ['warm', 'cold', 'refresh', 'observer'].map(worker)});
 try {
  const db = await mf.getD1Database('DB', 'warm');
  for (const sql of migrationSQL) await apply(db, sql);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(table => table.name);
  assert.equal(tables.length, 22, 'all application tables including isolated news gate');
  assert.deepEqual(await row(db), {id: 'daily_institutions', status: 'idle', lease_token: null, payload: null, updated_ms: 0, not_before_ms: 0});
  const untouchedTables = tables.filter(name => name !== 'taifex_options_gate');
  // Preserve independent stopped gates, leases, cooldowns and cache sentinels.
  for (const table of untouchedTables.filter(name => name.endsWith('_gate') && name !== 'ashare_source_gate')) {
   await db.prepare(`UPDATE ${table} SET status='blocked',lease_token=NULL`).run();
  }
  await db.prepare("UPDATE ashare_source_gate SET status='blocked',lease_token=NULL,reason_code='http_403'").run();
  await db.prepare("UPDATE deribit_options_gate SET status='busy',lease_token='synthetic-deribit-owner',payload=?,updated_ms=123,not_before_ms=456").bind('{"synthetic":"existing Deribit cache must remain byte-for-byte intact"}').run();
  await db.prepare("INSERT INTO tic_snapshot_cache (id,payload,version,last_attempt_ms,last_success_ms,error,lease_until_ms,lease_token) VALUES ('synthetic-preserve','{}','synthetic',1,2,'synthetic',3,'existing-owner')").run();
  await db.prepare("INSERT INTO ashare_snapshot_cache VALUES ('level1',1,'{}',1,86400001)").run();
  await db.prepare("INSERT INTO ashare_staged_acquisitions VALUES ('level1',1,'{}',1,2,180001)").run();
  await db.prepare("INSERT INTO kraken_snapshot_cache VALUES ('00000000-0000-4000-8000-000000000001',1,'{}',1,900001)").run();
  await db.prepare("INSERT INTO kraken_snapshot_refs VALUES ('latest','00000000-0000-4000-8000-000000000001')").run();
  const schemaBefore = (await db.prepare(schemaSQL).all()).results;
  const rowsBefore = await Promise.all(untouchedTables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
  const [warm, cold, refresh, observer] = await Promise.all(['warm', 'cold', 'refresh', 'observer'].map(name => mf.getWorker(name)));
  const t = {mf, db, warm, cold, refresh, observer, reportDates, legacy, bundle, starts, calls: () => starts.length,
   setMode: (page, mode) => {modes[page] = mode;}, setDate: (page, date) => {payloads[page] = withDate(payloads[page], date);}};
  await fn(t);
  for (let i = 0; i < untouchedTables.length; i++) {
   assert.deepEqual((await db.prepare(`SELECT * FROM ${untouchedTables[i]} ORDER BY 1`).all()).results, rowsBefore[i].results, `${untouchedTables[i]} rows remain exact`);
  }
  assert.equal((await db.prepare('SELECT count(*) AS count FROM taifex_options_gate').first()).count, 1, 'only the original singleton exists');
  assert.deepEqual((await db.prepare(schemaSQL).all()).results, schemaBefore, 'all 22 tables, indexes and triggers remain exact');
  completed++; console.log(`PASS ${name}`);
 } finally {await mf.dispose(); await mock.close();}
}

for (const encoding of ['plain', 'json', 'gzip', 'br', 'gzip-octet', 'br-octet']) {
 await scenario(`${encoding}: two-report acquisition, minimum spacing, exact shared cache`, {encoding}, async t => {
  await statusesUnchanged(t);
  const {response, body} = await json(t.warm, 'options');
  assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(response.headers.get('cache-control'), 'no-store');
  const option = body.snapshot;
  assert.equal(option.rows.length, 30); assert.equal(option.report_date, t.reportDates.options);
  assert.deepEqual([option.rows[0].buy_amount, option.rows[0].sell_amount, option.rows[0].reported_net_amount], [12000, 9000, 4000]);
  const future = (await json(t.warm, 'futures')).body.snapshot;
  assert.equal(future.rows.length, makeFuturesFixture().length); assert.equal(future.report_date, t.reportDates.futures);
  assert.equal(future.metric, 'contract_notional_turnover');
  assert.deepEqual([future.rows[0].buy_amount, future.rows[0].sell_amount, future.rows[0].reported_net_amount], [3000, 2000, 1000]);
  for (const snapshot of [option, future]) {
   assert.equal(snapshot.source_released_at, null); assert.equal(snapshot.frequency, 'daily'); assert.equal(snapshot.currency, 'TWD');
   assert.equal(snapshot.source_unit, 'thousand_TWD'); assert.equal(snapshot.net_capital_flow, null);
  }
  const accepted = await row(t.db), saved = bundleSchema.parse(JSON.parse(accepted.payload));
  assert.equal(accepted.status, 'idle'); assert.equal(accepted.lease_token, null); assert.ok(accepted.not_before_ms >= accepted.updated_ms + HOUR);
  assert.deepEqual(saved.options, option); assert.deepEqual(saved.futures, future);
  for (const worker of [t.cold, t.warm, t.observer]) {
   assert.deepEqual((await json(worker, 'options')).body.snapshot, option);
   assert.deepEqual((await json(worker, 'futures')).body.snapshot, future);
   await statusesUnchanged(t, worker);
  }
  assert.equal(t.calls(), 2); assertPair(t.starts);
  // The fixture alone advances the schedule. Production has no reset/takeover.
  await t.db.prepare('UPDATE taifex_options_gate SET not_before_ms=0').run();
  assert.equal((await json(t.refresh, 'futures')).response.status, 200);
  assert.equal(t.calls(), 4); assertPair(t.starts, 2);
 });
}

await scenario('simultaneous different-page requests share one pending collection', async t => {
 const results = await Promise.all(Array.from({length: 10}, (_, index) => json(t.warm, pages[index % 2])));
 for (const {response, body} of results) assert.equal(response.status, 200, JSON.stringify(body));
 assert.equal(t.calls(), 2); assertPair(t.starts);
 for (const page of pages) assert.equal((await json(t.cold, page)).response.status, 200);
 assert.equal(t.calls(), 2);
});

await scenario('cold different-page request cannot take over a busy lease', {delays: {options: 150}}, async t => {
 const collecting = json(t.warm, 'options');
 await until(() => t.calls() === 1, 'first source did not start');
 const before = await row(t.db), other = await json(t.cold, 'futures');
 assert.equal(other.response.status, 503); assert.equal(other.body.status.error_code, 'source_busy'); assert.equal(other.body.snapshot, null);
 await statusesUnchanged(t, t.cold); assert.deepEqual(await row(t.db), before);
 assert.equal((await collecting).response.status, 200); assert.equal(t.calls(), 2); assertPair(t.starts);
 assert.equal((await json(t.observer, 'futures')).response.status, 200); assert.equal(t.calls(), 2);
});

for (const state of ['blocked', 'busy', 'cooldown']) for (const format of ['legacy', 'bundle']) {
 await scenario(`pre-existing ${state} ${format}: exact row preservation and no source budget`, async t => {
  const payload = JSON.stringify(format === 'legacy' ? t.legacy : t.bundle, null, 2);
  await seed(t.db, payload, {status: state === 'cooldown' ? 'idle' : state, lease: state === 'busy' ? 'synthetic-existing-owner' : null,
   retry: state === 'cooldown' ? Date.now() + HOUR : 0});
  const before = await row(t.db);
  for (const worker of [t.warm, t.cold]) for (const page of pages) {
   const {response, body} = await json(worker, page);
   if (state === 'cooldown' && (format === 'bundle' || page === 'options')) {
    assert.equal(response.status, 200); assert.deepEqual(body.snapshot, format === 'legacy' ? t.legacy : t.bundle[page]);
   } else {
    assert.equal(response.status, 503); assert.equal(body.snapshot, null);
    assert.equal(body.status.state, state === 'blocked' ? 'denied' : 'unavailable');
    if (state === 'busy') assert.equal(body.status.error_code, 'source_busy');
   }
   await statusesUnchanged(t, worker);
  }
  assert.equal(t.calls(), 0); assert.deepEqual(await row(t.db), before);
 });
}

await scenario('empty cooldown is read-only for both pages', async t => {
 await seed(t.db, null); const before = await row(t.db);
 for (const worker of [t.warm, t.cold]) for (const page of pages) {
  const {response, body} = await json(worker, page); assert.equal(response.status, 503); assert.equal(body.snapshot, null);
  assert.equal(body.status.error_code, 'source_cooldown');
 }
 await statusesUnchanged(t); assert.equal(t.calls(), 0); assert.deepEqual(await row(t.db), before);
});

await scenario('legacy upgrade uses the original singleton and one shared pair', async t => {
 await seed(t.db, JSON.stringify(t.legacy, null, 2), {retry: 0});
 const {response, body} = await json(t.warm, 'futures'); assert.equal(response.status, 200);
 const accepted = await row(t.db), bundle = bundleSchema.parse(JSON.parse(accepted.payload));
 assert.deepEqual(body.snapshot, bundle.futures); assert.equal(bundle.options.report_date, t.legacy.report_date);
 for (const page of pages) assert.deepEqual((await json(t.cold, page)).body.snapshot, bundle[page]);
 assert.equal(t.calls(), 2); assertPair(t.starts); await statusesUnchanged(t);
});

await scenario('pre-existing busy lease suppresses both already-warm report copies', async t => {
 await json(t.warm, 'options'); await json(t.cold, 'futures');
 await t.db.prepare("UPDATE taifex_options_gate SET status='busy',lease_token='synthetic-existing-owner',updated_ms=0,not_before_ms=0").run();
 const before = await row(t.db);
 for (const worker of [t.warm, t.cold, t.observer]) for (const page of pages) {
  const {response, body} = await json(worker, page); assert.equal(response.status, 503); assert.equal(body.snapshot, null);
  assert.equal(body.status.error_code, 'source_busy');
 }
 await statusesUnchanged(t); assert.equal(t.calls(), 2); assert.deepEqual(await row(t.db), before);
});

for (const malformed of ['partial-v2', 'broken-options', 'broken-futures', 'extra-v2-field', 'unknown-version']) {
 await scenario(`malformed ${malformed}: fail closed without write or acquisition`, async t => {
  const payload = structuredClone(t.bundle);
  if (malformed === 'partial-v2') delete payload.futures;
  if (malformed === 'broken-options') payload.options.rows.pop();
  if (malformed === 'broken-futures') payload.futures.rows.pop();
  if (malformed === 'extra-v2-field') payload.partial = true;
  if (malformed === 'unknown-version') payload.schema = 'taifex-institutions/3';
  await seed(t.db, JSON.stringify(payload), {retry: 0}); const before = await row(t.db);
  for (const worker of [t.warm, t.cold]) for (const page of pages) {
   const {response, body} = await json(worker, page); assert.equal(response.status, 503); assert.equal(body.snapshot, null);
   assert.equal(body.status.error_code, 'source_gate_unavailable');
  }
  await statusesUnchanged(t); assert.equal(t.calls(), 0); assert.deepEqual(await row(t.db), before);
 });
}

await scenario('malformed persisted v2 suppresses both already-warm report copies', async t => {
 await json(t.warm, 'options'); await json(t.cold, 'futures');
 const corrupt = JSON.parse((await row(t.db)).payload); delete corrupt.futures;
 await seed(t.db, JSON.stringify(corrupt), {retry: 0}); const before = await row(t.db);
 for (const worker of [t.warm, t.cold]) for (const page of pages) {
  const {response, body} = await json(worker, page); assert.equal(response.status, 503); assert.equal(body.snapshot, null);
  assert.equal(body.status.error_code, 'source_gate_unavailable');
 }
 await statusesUnchanged(t); assert.equal(t.calls(), 2); assert.deepEqual(await row(t.db), before);
});

for (const endpoint of pages) for (const mode of ['403', '429', 'html', 'json-html']) {
 await scenario(`${endpoint} ${mode}: denial atomically purges both reports and warm copies`, async t => {
  assert.equal((await json(t.warm, 'options')).response.status, 200);
  assert.equal((await json(t.observer, 'futures')).response.status, 200);
  await t.db.prepare('UPDATE taifex_options_gate SET not_before_ms=0').run(); t.setMode(endpoint, mode);
  await t.db.prepare("CREATE TRIGGER offline_atomic_denial BEFORE UPDATE ON taifex_options_gate WHEN NEW.status='blocked' AND (NEW.payload IS NOT NULL OR NEW.lease_token IS NOT NULL) BEGIN SELECT RAISE(ABORT,'denial must atomically purge'); END").run();
  try {
   const {response, body} = await json(t.cold, 'futures'); assert.equal(response.status, 503); assert.equal(body.status.state, 'denied');
   const stopped = await row(t.db); assert.equal(stopped.status, 'blocked'); assert.equal(stopped.payload, null); assert.equal(stopped.lease_token, null);
   for (const worker of [t.warm, t.observer, t.refresh]) for (const page of pages) {
    const result = await json(worker, page); assert.equal(result.body.snapshot, null); assert.equal(result.body.status.state, 'denied');
   }
   await statusesUnchanged(t); assert.deepEqual(await row(t.db), stopped);
   assert.equal(t.calls(), endpoint === 'options' ? 3 : 4);
   if (endpoint === 'futures') assertPair(t.starts, 2);
  } finally {await t.db.prepare('DROP TRIGGER offline_atomic_denial').run();}
 });
}

for (const endpoint of pages) for (const prior of ['empty', 'legacy', 'bundle']) {
 await scenario(`${endpoint} temporary failure preserves exact ${prior} evidence and durable Retry-After`, {modes: {[endpoint]: 'temporary'}}, async t => {
  const payload = prior === 'empty' ? null : JSON.stringify(prior === 'legacy' ? t.legacy : t.bundle, null, 2);
  await seed(t.db, payload, {retry: 0});
  // Any successful first report is still unpublished while the second fails.
  const {body} = await json(t.warm, 'futures');
  assert.equal(body.status.error_code, 'upstream_http');
  assert.deepEqual(body.snapshot, prior === 'bundle' ? t.bundle.futures : null);
  const after = await row(t.db); assert.equal(after.payload, payload); assert.equal(after.status, 'idle'); assert.equal(after.lease_token, null);
  assert.ok(after.not_before_ms >= after.updated_ms + 2 * HOUR);
  for (const page of pages) {
   const result = await json(t.cold, page);
   assert.deepEqual(result.body.snapshot, prior === 'bundle' ? t.bundle[page] : prior === 'legacy' && page === 'options' ? t.legacy : null);
  }
  await statusesUnchanged(t, t.cold); assert.deepEqual(await row(t.db), after);
  assert.equal(t.calls(), endpoint === 'options' ? 1 : 2); if (endpoint === 'futures') assertPair(t.starts);
 });
}

for (const endpoint of pages) {
 await scenario(`${endpoint} malformed source never partially publishes`, {modes: {[endpoint]: 'malformed'}}, async t => {
  const saved = JSON.stringify(t.bundle, null, 2); await seed(t.db, saved, {retry: 0});
  const {body} = await json(t.warm, 'futures'); assert.ok(body.status.error_code); assert.deepEqual(body.snapshot, t.bundle.futures);
  const after = await row(t.db); assert.equal(after.payload, saved); assert.equal(after.status, 'idle'); assert.equal(after.lease_token, null);
  assert.equal(t.calls(), endpoint === 'options' ? 1 : 2); await statusesUnchanged(t);
 });
 await scenario(`${endpoint} independently regressed report rejects entire replacement`, async t => {
  const saved = JSON.stringify(t.bundle, null, 2); await seed(t.db, saved, {retry: 0});
  t.setDate(endpoint, dayAgo(endpoint === 'options' ? 2 : 3));
  t.setDate(endpoint === 'options' ? 'futures' : 'options', dayAgo(0));
  const {body} = await json(t.warm, 'futures');
  assert.equal(body.status.error_code, 'report_date_regressed'); assert.deepEqual(body.snapshot, t.bundle.futures);
  const after = await row(t.db); assert.equal(after.payload, saved); assert.equal(after.status, 'idle'); assert.equal(after.lease_token, null);
  assert.equal(t.calls(), endpoint === 'options' ? 1 : 2); if (t.calls() === 2) assertPair(t.starts);
  for (const page of pages) assert.deepEqual((await json(t.cold, page)).body.snapshot, t.bundle[page]);
  await statusesUnchanged(t);
 });
}

for (const endpoint of pages) await scenario(`${endpoint} UTF-8 source byte limit cleans up without stranded busy state`, {modes: {[endpoint]: 'oversize-utf8'}}, async t => {
 const saved = JSON.stringify(t.bundle, null, 2); await seed(t.db, saved, {retry: 0});
 const {body} = await json(t.warm, 'futures'); assert.equal(body.status.error_code, 'byte_budget'); assert.deepEqual(body.snapshot, t.bundle.futures);
 const after = await row(t.db); assert.equal(after.payload, saved); assert.equal(after.status, 'idle'); assert.equal(after.lease_token, null);
 assert.ok(after.not_before_ms >= after.updated_ms + HOUR);
 assert.equal(t.calls(), endpoint === 'options' ? 1 : 2); if (endpoint === 'futures') assertPair(t.starts);
 for (const page of pages) assert.deepEqual((await json(t.cold, page)).body.snapshot, t.bundle[page]);
 await statusesUnchanged(t);
});

for (const encoding of ['gzip', 'br']) await scenario(`futures ${encoding} decoded byte limit preserves full payload and releases lease`, {encoding, modes: {futures: `${encoding}-expanded`}}, async t => {
 const saved = JSON.stringify(t.bundle, null, 2); await seed(t.db, saved, {retry: 0});
 const {body} = await json(t.warm, 'futures'); assert.equal(body.status.error_code, 'byte_budget'); assert.deepEqual(body.snapshot, t.bundle.futures);
 const after = await row(t.db); assert.equal(after.payload, saved); assert.equal(after.status, 'idle'); assert.equal(after.lease_token, null);
 assert.ok(after.not_before_ms >= after.updated_ms + HOUR); assert.equal(t.calls(), 2); assertPair(t.starts);
 for (const page of pages) assert.deepEqual((await json(t.cold, page)).body.snapshot, t.bundle[page]);
 await statusesUnchanged(t); assert.equal(t.calls(), 2); assert.deepEqual(await row(t.db), after);
});

for (const expiredPage of pages) for (const expiry of ['report-date', 'cache-age']) {
 await scenario(`${expiredPage} ${expiry} expires independently without new budget`, async t => {
  const candidate = structuredClone(t.bundle), old = new Date(Date.now() - DAY - 6000).toISOString(), recent = new Date(Date.now() - DAY + 6000).toISOString();
  if (expiry === 'report-date') candidate[expiredPage].report_date = dayAgo(15);
  else {
   // Keep the complete bundle inside its bounded acquisition window,
   // with its report fetches on opposite sides of the 24-hour cache boundary.
   candidate.acquisition_started_at = old; candidate.fetched_at = recent;
   for (const page of pages) {
    candidate[page].acquisition_started_at = page === expiredPage ? old : recent;
    candidate[page].fetched_at = page === expiredPage ? old : recent;
    candidate[page].report_date = dayAgo(3);
   }
  }
  bundleSchema.parse(candidate); await seed(t.db, JSON.stringify(candidate)); const before = await row(t.db);
  for (const worker of [t.warm, t.cold]) for (const page of pages) {
   const {response, body} = await json(worker, page);
   assert.equal(response.status, page === expiredPage ? 503 : 200);
   assert.deepEqual(body.snapshot, page === expiredPage ? null : candidate[page]);
  }
  await statusesUnchanged(t); assert.equal(t.calls(), 0); assert.deepEqual(await row(t.db), before);
 });
}

await scenario('unknown D1 inspection suppresses both reports without source or write', async t => {
 await json(t.warm, 'options'); const before = await row(t.db);
 for (const page of pages) {
  const {response, body} = await json(t.cold, page, 'snapshot', {headers: {'x-offline-fault': 'inspect-unavailable'}});
  assert.equal(response.status, 503); assert.equal(body.snapshot, null); assert.equal(body.status.error_code, 'source_gate_unavailable');
 }
 assert.equal(t.calls(), 2); assert.deepEqual(await row(t.db), before);
});

await scenario('response-ended cancellation between GETs releases the owned singleton', async t => {
 const early = await t.warm.fetch('https://app.invalid/offline/early?page=futures'); assert.equal(early.status, 202); await early.text();
 await until(() => t.calls() === 1, 'first source did not start');
 await t.warm.fetch('https://app.invalid/offline/abort');
 const cleaned = await until(async () => {const r = await row(t.db); return r.status === 'idle' && r;}, 'cancelled native request did not release its owned D1 lease');
 assert.equal(cleaned.lease_token, null); assert.equal(cleaned.payload, null); assert.ok(cleaned.not_before_ms >= cleaned.updated_ms + HOUR);
 for (const page of pages) assert.equal((await json(t.cold, page)).body.snapshot, null);
 await pause(1200); assert.equal(t.calls(), 1, 'aborting during source spacing must prevent the second GET');
 await statusesUnchanged(t);
});

await scenario('late D1 admission remains retained after response completion and abort', async t => {
 const early = await t.warm.fetch('https://app.invalid/offline/early?page=futures', {headers: {'x-offline-fault': 'acquire-late'}});
 assert.equal(early.status, 202); await early.text(); assert.equal((await row(t.db)).status, 'busy'); assert.equal(t.calls(), 0);
 await t.warm.fetch('https://app.invalid/offline/abort');
 const cleaned = await until(async () => {const r = await row(t.db); return r.status === 'idle' && r;}, 'late D1 admission did not clean its owned lease');
 assert.equal(cleaned.lease_token, null); assert.equal(cleaned.payload, null); assert.ok(cleaned.not_before_ms >= cleaned.updated_ms + HOUR);
 for (const page of pages) await json(t.cold, page); assert.equal(t.calls(), 0); await statusesUnchanged(t);
});

await scenario('late D1 release settles after cleanup deadline without retry or takeover', {modes: {futures: 'temporary'}}, async t => {
 const saved = JSON.stringify(t.bundle, null, 2); await seed(t.db, saved, {retry: 0});
 const {response, body} = await json(t.warm, 'futures', 'snapshot', {headers: {'x-offline-fault': 'finish-late'}});
 assert.equal(response.status, 503); assert.equal(body.snapshot, null); assert.equal(body.status.error_code, 'source_gate_outcome_unconfirmed');
 assert.equal((await row(t.db)).status, 'busy');
 for (const page of pages) {const result = await json(t.cold, page); assert.equal(result.body.status.error_code, 'source_busy'); assert.equal(result.body.snapshot, null);}
 const cleaned = await until(async () => {const r = await row(t.db); return r.status === 'idle' && r;}, 'late D1 release was dropped after response deadline');
 assert.equal(cleaned.lease_token, null); assert.equal(cleaned.payload, saved); assert.ok(cleaned.not_before_ms >= cleaned.updated_ms + 2 * HOUR);
 assert.equal(t.calls(), 2); assertPair(t.starts); await statusesUnchanged(t, t.observer);
});

await scenario('two slow 7.9-second source responses succeed inside the shared deadline', {delays: {options: 7900, futures: 7900}}, async t => {
 const started = Date.now(), {response, body} = await json(t.warm, 'futures');
 assert.equal(response.status, 200, JSON.stringify(body)); assert.ok(body.snapshot);
 const elapsed = Date.now() - started; assert.ok(elapsed >= 15_800 && elapsed < MAX_ACQUISITION_MS, `slow pair completed after ${elapsed} ms`);
 const accepted = await row(t.db), bundle = bundleSchema.parse(JSON.parse(accepted.payload));
 assert.equal(accepted.status, 'idle'); assert.equal(accepted.lease_token, null); assert.deepEqual(body.snapshot, bundle.futures);
 for (const page of pages) assert.deepEqual((await json(t.cold, page)).body.snapshot, bundle[page]);
 assert.equal(t.calls(), 2); assertPair(t.starts); await statusesUnchanged(t);
});

await scenario(`one shared ${MAX_ACQUISITION_MS / 1000}-second deadline covers both source GETs`, {delays: {options: MAX_ACQUISITION_MS * 0.6, futures: MAX_ACQUISITION_MS * 0.6}}, async t => {
 const started = Date.now(), {response, body} = await json(t.warm, 'futures');
 assert.equal(response.status, 503); assert.equal(body.snapshot, null); assert.equal(body.status.error_code, 'timeout');
 const elapsed = Date.now() - started; assert.ok(elapsed >= MAX_ACQUISITION_MS - 1000 && elapsed < MAX_ACQUISITION_MS + 3000, `shared deadline returned after ${elapsed} ms`);
 const cleaned = await row(t.db); assert.equal(cleaned.status, 'idle'); assert.equal(cleaned.lease_token, null); assert.equal(cleaned.payload, null);
 assert.ok(cleaned.not_before_ms >= cleaned.updated_ms + HOUR); assert.equal(t.calls(), 2); assertPair(t.starts);
 for (const page of pages) await json(t.cold, page); assert.equal(t.calls(), 2); await statusesUnchanged(t);
});

assert.ok(completed > 0, 'runtime filter selected no scenarios');
console.log(`PASS ${completed} native shared-TAIFEX scenarios; all 26 migrations, 22-table schema and unrelated rows preserved; every source request synthetic`);
