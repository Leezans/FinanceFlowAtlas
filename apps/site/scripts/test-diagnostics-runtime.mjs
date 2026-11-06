/** Real local workerd/D1; synthetic rows only. No cloud, credentials or provider access. */
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url), wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const {Miniflare} = wranglerRequire('miniflare'), {build} = wranglerRequire('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = async contents => (await build({stdin: {contents, resolveDir: root, sourcefile: 'diagnostics-offline.ts'},
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers', 'node:*'], write: false})).outputFiles[0].text;
const script = await bundle(`
  import {GET as diagnostics} from './app/api/v1/diagnostics/route';
  import {GET as ashare} from './app/api/v1/ashare/status/route';
  import {GET as kraken} from './app/api/v1/crypto/kraken/status/route';
  import {GET as tic} from './app/api/v1/flows/tic/status/route';
  export default {fetch(request) {const path=new URL(request.url).pathname;
    return path==='/api/v1/ashare/status'?ashare(request):path==='/api/v1/crypto/kraken/status'?kraken(request):path==='/api/v1/flows/tic/status'?tic(request):diagnostics(request);}};
`);
let outbound = 0;
const worker = name => ({name, modules: true, script, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: {DB: 'diagnostics-offline-only'}, outboundService: request => {
    outbound++;
    // Only the explicit final TIC contrast test is allowed a synthetic response.
    assert.equal(request.url, 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt');
    return new Response('synthetic-denial-no-network', {status: 403});
  }});
const mf = new Miniflare({workers: [worker('warm'), worker('cold')]});
const url = 'https://offline.invalid/api/v1/diagnostics';
try {
  const db = await mf.getD1Database('DB', 'warm');
  const tables = async () => (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map(row => row.name);
  const dump = async () => {
    const result = {};
    for (const table of await tables()) result[table] = (await db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all()).results;
    return JSON.stringify(result);
  };
  const empty = await dump();
  const absent = await mf.dispatchFetch(url); assert.equal(absent.status, 503);
  assert.equal((await absent.json()).external_scheduler.installation, 'unknown');
  assert.equal(await dump(), empty); assert.equal(outbound, 0);
  console.log('PASS missing schema stays missing; no initialization, source requests or installation claim');

  // Apply the repository's real migrations only to this isolated synthetic DB.
  const directory = new URL('../drizzle/', import.meta.url);
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const contents = await readFile(new URL(file, directory), 'utf8');
    for (const sql of contents.split('--> statement-breakpoint').filter(value => value.trim())) await db.prepare(sql).run();
  }
  let before = await dump();
  const first = await mf.dispatchFetch(url), firstBody = await first.json();
  assert.equal(first.status, 200); assert.equal(firstBody.sources.length, 19);
  assert.equal(firstBody.sources.find(value => value.source === 'treasury-tic').metadata, 'not_initialized');
  assert.equal(firstBody.external_scheduler.metadata, 'unavailable');
  assert.equal(await dump(), before); assert.equal(outbound, 0);
  console.log('PASS real migration schema and 19 fixed source/view SELECTs; absent TIC gate is not created');

  // Dates and values below are deliberately synthetic; no market observations.
  const at = Date.now() - 60_000, stamp = new Date(at).toISOString(), older = new Date(at - 60_000).toISOString();
  const later = new Date(at + 30_000).toISOString();
  for(const schema of ['deribit-btc-options/1','deribit-options/2','deribit-options/unknown']){
    await db.prepare("UPDATE deribit_options_gate SET payload=? WHERE id='btc_options'").bind(JSON.stringify({schema,fetched_at:stamp,acquisition_started_at:older,rows:[{secret:'SECRET_FINANCIAL_ROW'}]})).run();
    const baseline=await dump(),body=await(await mf.dispatchFetch(url)).json(),record=body.sources.find(row=>row.source==='deribit-options');
    assert.equal(record.cache.recorded_acquisition_at,schema.endsWith('/unknown')?null:stamp);
    assert.equal(record.cache.recorded_collection_start_at,schema.endsWith('/unknown')?null:older);
    assert.equal(await dump(),baseline);assert.equal(outbound,0);assert.ok(!JSON.stringify(body).includes('SECRET_FINANCIAL_ROW'));
  }
  await db.prepare("UPDATE deribit_options_gate SET payload=NULL WHERE id='btc_options'").run();
  console.log('PASS legacy BTC and combined BTC/ETH recorded cache clocks, unknown schemas withheld, zero writes/source calls');

  // Two report projections share one provider gate; legacy cache proves options only.
  const optionsMeta={schema:'taifex-options-institutions/1',fetched_at:stamp,acquisition_started_at:older,rows:[{secret:'SECRET_TAIFEX_ROW'}]};
  const futuresMeta={schema:'taifex-futures-institutions/1',fetched_at:later,acquisition_started_at:stamp,rows:[{secret:'SECRET_FUTURES_ROW'}]};
  for(const [payload,optionsTime,futuresTime,present] of [
    [optionsMeta,stamp,null,[true,false]],
    [{schema:'taifex-institutions/2',options:optionsMeta,futures:futuresMeta,fetched_at:later},stamp,later,[true,true]],
    [{schema:'taifex-institutions/2',options:optionsMeta},null,null,[null,null]],
    [{schema:'taifex-institutions/unknown',options:optionsMeta,futures:futuresMeta},null,null,[null,null]],
  ]){
    for(const state of ['idle','busy','blocked']){
      await db.prepare("UPDATE taifex_options_gate SET status=?,lease_token=?,payload=? WHERE id='daily_institutions'").bind(state,state==='busy'?'synthetic-owned':null,JSON.stringify(payload)).run();
      const baseline=await dump(),body=await(await mf.dispatchFetch(url)).json();
      for(const [i,id,expectedTime] of [[0,'taifex-options',optionsTime],[1,'taifex-futures',futuresTime]]){
        const record=body.sources.find(row=>row.source===id);
        assert.equal(record.cache.recorded_acquisition_at,state==='idle'?expectedTime:null);
        assert.equal(record.cache.record_present,state==='idle'?present[i]:null);
      }
      assert.equal(await dump(),baseline);assert.equal(outbound,0);assert.ok(!JSON.stringify(body).includes('SECRET_'));
    }
  }
  await db.prepare("UPDATE taifex_options_gate SET status='idle',lease_token=NULL,payload=NULL WHERE id='daily_institutions'").run();
  console.log('PASS TAIFEX legacy/bundle distinct report clocks, missing futures, busy/denied suppression and no writes/source calls');

  await db.prepare("UPDATE cboe_delayed_source_gate SET payload=? WHERE id='bxe_equities'").bind(JSON.stringify({schema: 'cboe-cache/1', snapshot: {schema: 'cboe-delayed/1', fetchedAt: stamp, acquisitionStartedAt: older, secret: 'SECRET_FINANCIAL_ROW'}, latestEmptyCheck: {schema: 'cboe-delayed/1', fetchedAt: later, acquisitionStartedAt: stamp}})).run();
  await db.prepare("UPDATE polymarket_source_gate SET payload=? WHERE id='active_markets'").bind(JSON.stringify({schema: 'polymarket-discovery/2', newest: {schema: 'polymarket-gamma/2', fetched_at: stamp, acquisition_started_at: older}, hot: {schema: 'polymarket-gamma/hot/1', fetched_at: older, acquisition_started_at: older}, interest: {schema: 'polymarket-open-interest/1', fetched_at: later, acquisition_started_at: stamp}})).run();
  await db.prepare("UPDATE ecb_fx_source_gate SET payload=?,checked_ms=? WHERE id='daily_reference'").bind(JSON.stringify({schema: 'ecb-fx-reference/1', retrieved_at: older, secret: 'SECRET_FINANCIAL_ROW'}), at).run();
  await db.prepare("INSERT INTO tic_snapshot_cache(id,version,last_attempt_ms,error) VALUES ('tic-treasury-source-gate-v1','denied',?,'SECRET_RAW_ERROR')").bind(at).run();
  await db.prepare("INSERT INTO tic_snapshot_cache(id,payload,last_success_ms) VALUES ('tic-equity-latest-v2',?,?)").bind(JSON.stringify({concept: 'reported_net_transactions', retrieved_at: stamp}), at).run();
  await db.prepare("UPDATE tpex_source_gate SET status='blocked',lease_token=NULL WHERE id='institutional_shares'").run();
  await db.prepare("UPDATE tpex_summary_gate SET payload=? WHERE id='institutional_money'").bind(JSON.stringify({schema: 'tpex-institutional-money/1', fetched_at: stamp})).run();
  before = await dump();
  const cold = await mf.getWorker('cold');
  for (const fetcher of [request => mf.dispatchFetch(request), request => cold.fetch(request)]) {
    const response = await fetcher(url), body = await response.json(), text = JSON.stringify(body);
    const source = (id, view) => body.sources.find(value => value.source === id && (!view || value.view === view));
    assert.equal(source('cboe-europe').cache.recorded_acquisition_at, stamp, 'empty check must not renew retained quote acquisition');
    assert.equal(source('polymarket', 'newest').cache.recorded_acquisition_at, stamp);
    assert.equal(source('polymarket', 'hot').cache.recorded_acquisition_at, older);
    assert.equal(source('polymarket', 'interest').cache.recorded_acquisition_at, later);
    assert.equal(source('ecb').cache.recorded_acquisition_at, older);
    assert.equal(source('ecb').last_check_recorded_at, stamp);
    assert.equal(source('treasury-tic').coordination, 'stopped');
    assert.equal(source('treasury-tic').cache.recorded_acquisition_at, null);
    assert.equal(source('tpex-money').coordination, 'stopped');
    assert.equal(source('tpex-money').cache.recorded_acquisition_at, null);
    for (const secret of ['SECRET_', 'lease_token', 'tic-treasury-source-gate-v1', 'source_gate', 'snapshot_cache']) assert.ok(!text.includes(secret), secret);
  }
  assert.equal(await dump(), before); assert.equal(outbound, 0);
  console.log('PASS two isolates preserve all rows and distinguish cache clocks, Polymarket windows and provider denials');

  // Fixed-view metadata paths for healthy records, without claiming valid financial payloads.
  await db.prepare("UPDATE tic_snapshot_cache SET version='ready',error=NULL WHERE id='tic-treasury-source-gate-v1'").run();
  await db.prepare("INSERT INTO tic_snapshot_cache(id,payload,last_success_ms) VALUES ('tic-equity-history-latest-12-v2',?,?)").bind(JSON.stringify({concept: 'reported_net_transactions', retrieved_at: older}), at + 10_000).run();
  await db.prepare("INSERT INTO ashare_snapshot_cache(scope_key,format_version,payload,committed_ms,expires_ms) VALUES ('level1',1,?,?,?)").bind(JSON.stringify({fetched_at: stamp, collection_started_at: older}), at + 1000, at + 1000 + 86_400_000).run();
  await db.prepare("INSERT INTO kraken_snapshot_cache(snapshot_id,format_version,payload,fetched_ms,expires_ms) VALUES ('00000000-0000-4000-8000-000000000001',1,'{}',?,?)").bind(at, at + 900_000).run();
  await db.prepare("INSERT INTO kraken_snapshot_refs(cache_key,snapshot_id) VALUES ('latest','00000000-0000-4000-8000-000000000001')").run();
  await db.prepare("UPDATE japan_mof_source_gate SET payload=? WHERE id='weekly_liabilities'").bind(JSON.stringify({schema: 'japan-mof-weekly/1', fetched_at: stamp, acquisition_started_at: older})).run();
  await db.prepare("UPDATE tpex_source_gate SET status='idle' WHERE id='institutional_shares'").run();
  before = await dump();
  const healthy = await (await mf.dispatchFetch(url)).json();
  const entry = (id, view) => healthy.sources.find(value => value.source === id && (!view || value.view === view));
  for (const id of ['eastmoney', 'kraken', 'japan-mof', 'tpex-money']) assert.equal(entry(id).cache.recorded_acquisition_at, stamp, id);
  assert.equal(entry('eastmoney').cache.recorded_collection_start_at, older);
  assert.equal(entry('treasury-tic', 'latest').cache.recorded_acquisition_at, stamp);
  assert.equal(entry('treasury-tic', 'history').cache.recorded_acquisition_at, older);
  assert.equal(entry('treasury-tic', 'history').cache.recorded_commit_at, new Date(at + 10_000).toISOString());
  assert.equal(await dump(), before); assert.equal(outbound, 0);
  console.log('PASS healthy fixed A-share, Kraken, Japan, Taiwan and distinct TIC current/history metadata paths');

  await db.prepare("UPDATE cboe_delayed_source_gate SET payload=? WHERE id='bxe_equities'").bind(JSON.stringify({schema: 'cboe-delayed/1', fetchedAt: stamp, acquisitionStartedAt: older})).run();
  const variants = [
    [{schema: 'polymarket-discovery/1', newest: {schema: 'polymarket-gamma/2', fetched_at: stamp}, hot: {schema: 'polymarket-gamma/hot/1', fetched_at: older}, interest: {schema: 'polymarket-open-interest/1', fetched_at: later}}, [stamp, older, null]],
    [{schema: 'polymarket-gamma/1', fetched_at: stamp}, [stamp, null, null]],
    [{schema: 'polymarket-gamma/hot/1', fetched_at: stamp}, [null, stamp, null]],
    [{schema: 'polymarket-open-interest/1', fetched_at: stamp}, [null, null, stamp]],
    [{schema: 'polymarket-open-interest/2', fetched_at: stamp}, [null, null, stamp]],
    [{schema: 'polymarket-discovery/2', newest: null, hot: null, interest: {schema: 'polymarket-open-interest/2', fetched_at: later}}, [null, null, later]],
  ];
  for (const [payload, expected] of variants) {
    await db.prepare("UPDATE polymarket_source_gate SET payload=? WHERE id='active_markets'").bind(JSON.stringify(payload)).run();
    before = await dump(); const body = await (await mf.dispatchFetch(url)).json();
    assert.equal(body.sources.find(value => value.source === 'cboe-europe').cache.recorded_acquisition_at, stamp);
    assert.deepEqual(body.sources.filter(value => value.source === 'polymarket').map(value => value.cache.recorded_acquisition_at), expected);
    assert.equal(await dump(), before); assert.equal(outbound, 0);
  }
  console.log('PASS Cboe legacy and Polymarket wrapper/single-view compatibility; no cross-view timestamp invention');

  await db.prepare("UPDATE cboe_delayed_source_gate SET payload='not-json' WHERE id='bxe_equities'").run();
  await db.prepare("UPDATE polymarket_source_gate SET payload=? WHERE id='active_markets'").bind(JSON.stringify({schema: 'unknown', fetched_at: stamp})).run();
  // Test-only optional metadata shape. The Site need not contain or install the
  // separate scheduler component for this diagnostic suite to remain runnable.
  await db.prepare(`CREATE TABLE ashare_scheduler_job (
    id TEXT PRIMARY KEY NOT NULL CHECK(id='ashare'),
    status TEXT NOT NULL CHECK(status IN ('idle','busy','stopped')), lease_token TEXT,
    scopes_json TEXT NOT NULL, cursor INTEGER NOT NULL, created_ms INTEGER NOT NULL,
    last_seen_ms INTEGER, last_tick_ms INTEGER, last_started_ms INTEGER,
    last_finished_ms INTEGER, last_code TEXT,
    CHECK((status='busy' AND lease_token IS NOT NULL) OR (status!='busy' AND lease_token IS NULL))
  )`).run();
  await db.prepare("INSERT INTO ashare_scheduler_job(id,status,lease_token,scopes_json,cursor,created_ms,last_seen_ms) VALUES ('ashare','busy','SECRET_SCHEDULER_TOKEN','[\"level1\"]',0,?,?)").bind(at, at).run();
  before = await dump();
  const corrupted = await (await mf.dispatchFetch(url)).json();
  assert.equal(corrupted.sources.find(value => value.source === 'cboe-europe').cache.recorded_acquisition_at, null);
  assert.equal(corrupted.sources.find(value => value.source === 'polymarket').cache.recorded_acquisition_at, null);
  assert.equal(corrupted.external_scheduler.installation, 'unknown');
  assert.equal(corrupted.external_scheduler.observed_job_state, 'busy_or_unconfirmed');
  assert.ok(!JSON.stringify(corrupted).includes('SECRET_SCHEDULER_TOKEN'));
  assert.equal(await dump(), before); assert.equal(outbound, 0);
  console.log('PASS corrupt/unknown JSON and optional scheduler records never imply valid data or installed cron');

  // Actual existing route characterization: A-share and Kraken status are reads.
  for (const path of ['/api/v1/ashare/status', '/api/v1/crypto/kraken/status']) {
    before = await dump(); await mf.dispatchFetch('https://offline.invalid' + path);
    assert.equal(await dump(), before); assert.equal(outbound, 0);
  }
  console.log('PASS existing A-share/Kraken status routes: real native D1 reads, zero provider calls and unchanged database');

  // Contrast only: a fresh synthetic TIC gate demonstrates status is read-through.
  // Do not perform this on a live database or reset a production refusal.
  await db.prepare("DELETE FROM tic_snapshot_cache").run();
  before = await dump(); await mf.dispatchFetch('https://offline.invalid/api/v1/flows/tic/status');
  assert.equal(outbound, 1); assert.notEqual(await dump(), before);
  assert.equal((await db.prepare("SELECT version FROM tic_snapshot_cache WHERE id='tic-treasury-source-gate-v1'").first()).version, 'denied');
  console.log('PASS contrast: existing TIC status initializes/writes and reaches only the intercepted synthetic source');
  console.log('PASS diagnostics native validation; no real source, account, deployment, migration or gate changes');
} finally {await mf.dispose();}
