/** Fixed SELECTs only. These identifiers and JSON paths never come from a request.
 * Do not import source handlers, stores or gates here: some initialize rows or
 * perform read-through acquisition. No payload, lease or raw error is selected. The retained failure code is
 * a bounded machine code projected to a fixed category by the handler.
 */
export const DB_NOW = "(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
export type DiagnosticQuery = {source: string; view: string; sql: string};
const json = (payload: string, path: string) => `json_extract(${payload},'${path}')`;
function recorded(payload: string, schema: string, path: string) {
  return `CASE WHEN json_valid(${payload}) THEN CASE WHEN ${json(payload, '$.schema')}='${schema}' THEN ${json(payload, path)} END END`;
}
function common(source: string, table: string, key: string, schema: string): DiagnosticQuery {
  return {source, view: 'default', sql: `SELECT status AS state, ${DB_NOW} AS now_ms, updated_ms, not_before_ms AS retry_ms,
    NULL AS checked_ms, (payload IS NOT NULL) AS cache_present,
    ${recorded('payload', schema, '$.fetched_at')} AS acquired_at,
    ${recorded('payload', schema, '$.acquisition_started_at')} AS started_at
    FROM ${table} WHERE id='${key}' LIMIT 1`};
}
const polyTime = (view: string, field: string) => `CASE WHEN json_valid(payload) THEN CASE
  WHEN ${json('payload', '$.schema')} IN (${view === 'interest' ? "'polymarket-discovery/2'" : "'polymarket-discovery/1','polymarket-discovery/2'"})
    AND ${json('payload', `$.${view}.schema`)} IN (${view === 'newest' ? "'polymarket-gamma/1','polymarket-gamma/2'" : view === 'hot' ? "'polymarket-gamma/hot/1'" : "'polymarket-open-interest/1','polymarket-open-interest/2'"})
    THEN ${json('payload', `$.${view}.${field}`)}
  WHEN ${json('payload', '$.schema')} IN (${view === 'newest' ? "'polymarket-gamma/1','polymarket-gamma/2'" : view === 'hot' ? "'polymarket-gamma/hot/1'" : "'polymarket-open-interest/1','polymarket-open-interest/2'"})
    THEN ${json('payload', `$.${field}`)} END END`;
const cboeTime = (field: string) => `CASE WHEN json_valid(payload) THEN CASE
  WHEN ${json('payload', '$.schema')}='cboe-cache/1' AND ${json('payload', '$.snapshot.schema')}='cboe-delayed/1' THEN ${json('payload', `$.snapshot.${field}`)}
  WHEN ${json('payload', '$.schema')}='cboe-delayed/1' THEN ${json('payload', `$.${field}`)} END END`;

export const DIAGNOSTIC_QUERIES: readonly DiagnosticQuery[] = [
  {source: 'eastmoney', view: 'level1_only', sql: `SELECT g.status AS state, ${DB_NOW} AS now_ms, g.updated_ms,
    g.not_before_ms AS retry_ms, g.finished_ms AS checked_ms, (s.payload IS NOT NULL) AS cache_present,
    s.committed_ms, s.expires_ms, g.failure_code, g.last_failure_ms, g.failure_count,
    CASE WHEN s.format_version=1 AND json_valid(s.payload) THEN json_extract(s.payload,'$.fetched_at') END AS acquired_at,
    CASE WHEN s.format_version=1 AND json_valid(s.payload) THEN json_extract(s.payload,'$.collection_started_at') END AS started_at
    FROM ashare_source_gate g LEFT JOIN ashare_snapshot_cache s ON s.scope_key='level1'
    WHERE g.id='single_upstream' LIMIT 1`},
  {source: 'kraken', view: 'latest_reference_only', sql: `SELECT g.status AS state, ${DB_NOW} AS now_ms,
    g.updated_ms, g.not_before_ms AS retry_ms, NULL AS checked_ms, (s.payload IS NOT NULL) AS cache_present,
    CASE WHEN s.format_version=1 THEN s.fetched_ms END AS acquired_ms, s.expires_ms
    FROM kraken_source_gate g LEFT JOIN kraken_snapshot_refs r ON r.cache_key='latest'
    LEFT JOIN kraken_snapshot_cache s ON s.snapshot_id=r.snapshot_id WHERE g.id='spot_usd' LIMIT 1`},
  {source: 'ecb', view: 'daily_reference', sql: `SELECT status AS state, ${DB_NOW} AS now_ms, updated_ms,
    not_before_ms AS retry_ms, checked_ms, expires_ms, (payload IS NOT NULL) AS cache_present,
    ${recorded('payload', 'ecb-fx-reference/1', '$.retrieved_at')} AS acquired_at
    FROM ecb_fx_source_gate WHERE id='daily_reference' LIMIT 1`},
  common('aseanstats', 'asean_source_gate', 'annual_sector_fdi', 'asean-fdi/1'),
  common('brazil-cvm', 'cvm_source_gate', 'monthly_fund_equity', 'cvm-fund-equity/1'),
  common('worldbank-wfe', 'worldbank_equity_source_gate', 'annual_equity', 'worldbank-equity/1'),
  common('cftc', 'cftc_source_gate', 'legacy_futures', 'cftc-legacy-futures/1'),
  common('tpex-shares', 'tpex_source_gate', 'institutional_shares', 'tpex-institutional/1'),
  common('japan-mof', 'japan_mof_source_gate', 'weekly_liabilities', 'japan-mof-weekly/1'),
  {source: 'tpex-money', view: 'institutional_summary', sql: `SELECT s.status AS state, ${DB_NOW} AS now_ms,
    s.updated_ms, s.not_before_ms AS retry_ms, NULL AS checked_ms, (s.payload IS NOT NULL) AS cache_present,
    p.status AS provider_state, p.not_before_ms AS provider_retry_ms,
    ${recorded('s.payload', 'tpex-institutional-money/1', '$.fetched_at')} AS acquired_at,
    ${recorded('s.payload', 'tpex-institutional-money/1', '$.acquisition_started_at')} AS started_at
    FROM tpex_summary_gate s LEFT JOIN tpex_source_gate p ON p.id='institutional_shares'
    WHERE s.id='institutional_money' LIMIT 1`},
  {source: 'cboe-europe', view: 'retained_quote_snapshot', sql: `SELECT status AS state, ${DB_NOW} AS now_ms,
    updated_ms, not_before_ms AS retry_ms, NULL AS checked_ms, (payload IS NOT NULL) AS cache_present,
    ${cboeTime('fetchedAt')} AS acquired_at, ${cboeTime('acquisitionStartedAt')} AS started_at
    FROM cboe_delayed_source_gate WHERE id='bxe_equities' LIMIT 1`},
  ...(['newest', 'hot', 'interest'] as const).map(view => ({source: 'polymarket', view, sql: `SELECT status AS state,
    ${DB_NOW} AS now_ms, updated_ms,
    ${view === 'interest' ? 'MAX(not_before_ms,interest_not_before_ms)' : 'not_before_ms'} AS retry_ms,
    ${view === 'interest' ? 'interest_checked_ms' : 'checked_ms'} AS checked_ms,
    (${polyTime(view, 'fetched_at')} IS NOT NULL) AS cache_present,
    ${polyTime(view, 'fetched_at')} AS acquired_at, ${polyTime(view, 'acquisition_started_at')} AS started_at
    FROM polymarket_source_gate WHERE id='active_markets' LIMIT 1`})),
  ...(['latest', 'history'] as const).map(view => ({source: 'treasury-tic', view, sql: `SELECT g.version AS state,
    ${DB_NOW} AS now_ms, NULL AS updated_ms, g.last_attempt_ms AS checked_ms, g.lease_until_ms AS retry_ms,
    (s.payload IS NOT NULL) AS cache_present, s.last_success_ms AS committed_ms,
    CASE WHEN json_valid(s.payload) THEN CASE WHEN json_extract(s.payload,'$.concept')='reported_net_transactions'
      THEN json_extract(s.payload,'$.retrieved_at') END END AS acquired_at
    FROM tic_snapshot_cache g LEFT JOIN tic_snapshot_cache s ON s.id='${view === 'latest' ? 'tic-equity-latest-v2' : 'tic-equity-history-latest-12-v2'}'
    WHERE g.id='tic-treasury-source-gate-v1' LIMIT 1`})),
];

// This optional table is evidence of observed work, never proof of cron installation.
export const SCHEDULER_QUERY = `SELECT status AS state, ${DB_NOW} AS now_ms,
  last_seen_ms, last_tick_ms, last_started_ms, last_finished_ms
  FROM ashare_scheduler_job WHERE id='ashare' LIMIT 1`;
