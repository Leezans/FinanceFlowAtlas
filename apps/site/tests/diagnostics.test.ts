import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDiagnosticsHandler, DIAGNOSTIC_TIMEOUT_MS, type ReadOnlyD1, type DiagnosticsBody} from '../lib/diagnostics/handler';
import {DIAGNOSTIC_QUERIES, SCHEDULER_QUERY} from '../lib/diagnostics/queries';
const readBody = async (response: Response) => await response.json() as DiagnosticsBody;
const now = Date.parse('2026-11-06T06:00:00.000Z');
const acquired = '2026-11-06T05:59:00.000Z';
const request = (suffix = '', method = 'GET') => new Request(`https://owner.invalid/api/v1/diagnostics${suffix}`, {method});
const base = () => ({state: 'idle', now_ms: now, updated_ms: now - 2_000, checked_ms: now - 1_000, retry_ms: 0,
  cache_present: 1, acquired_at: acquired, started_at: '2026-11-06T05:58:00.000Z', committed_ms: now - 500,
  expires_ms: now + 60_000, provider_state: 'idle', provider_retry_ms: 0});
function setup(row: Record<string, unknown> = base()) {
  const all = vi.fn(async () => ({success: true, results: [row]}));
  const prepare = vi.fn((sql: string) => {
    expect([SCHEDULER_QUERY, ...DIAGNOSTIC_QUERIES.map(value => value.sql)]).toContain(sql);
    expect(sql).toMatch(/^SELECT /);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|REPLACE|ATTACH)\b/i);
    return {all};
  });
  const fetcher = vi.fn(() => {throw new Error('network forbidden');});
  vi.stubGlobal('fetch', fetcher);
  return {prepare, all, fetcher, handler: createDiagnosticsHandler({prepare})};
}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
describe('strictly read-only source diagnostics', () => {
  it('recognizes both recorded Deribit cache schema versions without selecting financial rows',()=>{const q=DIAGNOSTIC_QUERIES.find(q=>q.source==='deribit-options')!;expect(q.sql).toContain("IN ('deribit-btc-options/1','deribit-options/2')");expect(q.sql).toContain("'$.fetched_at'");expect(q.sql).toContain("'$.acquisition_started_at'");expect(q.sql).not.toContain("'$.rows'");});
  it('uses only fixed bounded SELECTs, zero network, and private responses', async () => {
    const t = setup(), response = await t.handler(request()), body = await readBody(response);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(body).toMatchObject({mode: 'read_only_metadata', built_in_collection: 'request_driven', metadata_complete: true,
      external_scheduler: {installation: 'unknown'}, inactive_sources: [{source: 'sina', implementation: 'disabled'}, {source: 'imf', implementation: 'not_integrated_in_hosted_app'}]});
    expect(t.prepare).toHaveBeenCalledTimes(DIAGNOSTIC_QUERIES.length + 1);
    expect(t.fetcher).not.toHaveBeenCalled();
    expect(body.sources).toHaveLength(17);
    expect(body.sources[0].cache).toMatchObject({validation: 'not_performed', recorded_acquisition_at: acquired,
      recorded_collection_start_at: '2026-11-06T05:58:00.000Z', recorded_commit_at: '2026-11-06T05:59:59.500Z'});
  });
  it('selects retained failure metadata only for A-share', () => {
    expect(DIAGNOSTIC_QUERIES[0].sql).toContain('g.failure_code, g.last_failure_ms, g.failure_count');
    expect(DIAGNOSTIC_QUERIES.slice(1).every(query => !/failure_code|last_failure_ms|failure_count/.test(query.sql))).toBe(true);
  });
  it.each(['idle', 'blocked', 'busy', 'uncertain'])('retains bounded failure evidence independently of coordination %s', async state => {
    const t = setup({...base(), state, failure_code: 'deadline', last_failure_ms: now - 1000, failure_count: 5});
    const body = await readBody(await t.handler(request()));
    expect(body.sources[0].retained_failure).toEqual({category: 'deadline', recorded_at: '2026-11-06T05:59:59.000Z', durable_streak_count: 5, count_semantics: 'durable_streak_capped_at_5'});
    expect(body.sources.slice(1).every(row => row.retained_failure.category === 'unknown' && row.retained_failure.recorded_at === null && row.retained_failure.durable_streak_count === null && row.retained_failure.count_semantics === 'not_available')).toBe(true);
    expect(t.fetcher).not.toHaveBeenCalled();
  });
  it.each([['deadline', 'deadline'], ['aborted', 'aborted'], ['transport_or_encoding_failure', 'transport'], ['invalid_json', 'validation'], ['snapshot_store_unavailable', 'storage'], ['source_denied', 'access_stopped'], ['source_outcome_unconfirmed', 'outcome_unconfirmed'], ['runtime_lifetime_unverified', 'runtime'], ['collection_failed', 'collection_failed'], ['https://SECRET_USER:SECRET_TOKEN@host.invalid/SECRET_BODY', 'unknown']])('projects failure code %s to a fixed category', async (failure_code, category) => {
    const t = setup({...base(), failure_code, last_failure_ms: now - 1000, failure_count: 1});
    const body = await readBody(await t.handler(request()));
    expect(body.sources[0].retained_failure.category).toBe(category);
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });
  it.each([undefined, null, 'SECRET_URL', {}, true, -1, 1.5, 6, Infinity, NaN])('keeps invalid streak count %# unknown', async failure_count => {
    const t = setup({...base(), failure_count, failure_code: 'deadline', last_failure_ms: now - 1000});
    expect((await readBody(await t.handler(request()))).sources[0].retained_failure).toMatchObject({category: 'unknown', recorded_at: null, durable_streak_count: null});
  });
  it.each([0, 'SECRET_EXCEPTION_BODY', '2026-11-06T05:59:59.000Z', -1, now + 1, Infinity, Number.MAX_SAFE_INTEGER, {}])('suppresses invalid retained failure timestamp %#', async last_failure_ms => {
    const t = setup({...base(), last_failure_ms, failure_count: 1, failure_code: 'deadline'});
    expect((await readBody(await t.handler(request()))).sources[0].retained_failure.recorded_at).toBeNull();
  });
  it('keeps a cleared streak distinct from a retained failure and does not infer recovery', async () => {
    const t = setup({...base(), failure_count: 0, failure_code: 'deadline', last_failure_ms: now - 1000});
    expect((await readBody(await t.handler(request()))).sources[0].retained_failure).toMatchObject({category: 'unknown', recorded_at: null, durable_streak_count: 0});
  });
  it.each(['?source=eastmoney', '?sql=DELETE%20FROM%20x', '?token=secret'])('rejects arbitrary query %s without touching storage', async suffix => {
    const t = setup(); expect((await t.handler(request(suffix))).status).toBe(400); expect(t.prepare).not.toHaveBeenCalled();
  });
  it.each(['POST', 'DELETE', 'PUT', 'HEAD'])('rejects method %s without touching storage', async method => {
    const t = setup(); expect((await t.handler(request('', method))).status).toBe(405); expect(t.prepare).not.toHaveBeenCalled();
  });
  it('rejects other paths without touching storage', async () => {
    const t = setup(); expect((await t.handler(new Request('https://owner.invalid/api/v1/not-diagnostics'))).status).toBe(404); expect(t.prepare).not.toHaveBeenCalled();
  });
  it.each(['blocked', 'denied', 'busy', 'checking', 'uncertain', 'invented'])('never exposes cached metadata through state %s', async state => {
    const t = setup({...base(), state}); const body = await readBody(await t.handler(request()));
    expect(body.sources.every((source: {cache: {record_present: boolean | null; recorded_acquisition_at: string | null}}) => source.cache.recorded_acquisition_at === null && source.cache.record_present === null)).toBe(true);
    expect(t.fetcher).not.toHaveBeenCalled();
  });
  it.each(['blocked', 'busy', undefined, 'other'])('preserves TPEx provider %s and does not expose summary cache', async provider_state => {
    const t = setup({...base(), provider_state}), body = await readBody(await t.handler(request()));
    const summary = body.sources.find((source: {source: string}) => source.source === 'tpex-money');
    expect(summary!.coordination).not.toBe('idle'); expect(summary!.cache.recorded_acquisition_at).toBeNull();
  });
  it('preserves a known summary denial even when provider metadata is unknown', async () => {
    const t = setup({...base(), state: 'blocked', provider_state: null}), body = await readBody(await t.handler(request()));
    expect(body.sources.find((source: {source: string}) => source.source === 'tpex-money')!.coordination).toBe('stopped');
  });
  it('does not expose summary cache during provider cooldown', async () => {
    const t = setup({...base(), provider_retry_ms: now + 60_000}), body = await readBody(await t.handler(request()));
    expect(body.sources.find((source: {source: string}) => source.source === 'tpex-money')).toMatchObject({coordination: 'cooldown', next_attempt_not_before: '2026-11-06T06:01:00.000Z', cache: {record_present: null}});
  });
  it.each([null, 0, true, {}, 'secret-account-token', '2026-02-30T01:00:00.000Z', '2026-11-06T07:00:00.000Z', '2026-11-06'])('suppresses invalid/future recorded acquisition time %#', async acquired_at => {
    const t = setup({...base(), acquired_at}), body = await readBody(await t.handler(request())); expect(body.sources[0].cache.recorded_acquisition_at).toBeNull();
  });
  it.each([
    ['2026-11-06T05:59:00+00:00', acquired],
    ['2026-11-06T13:59:00+08:00', acquired],
    ['2026-11-06T05:59:00.123456Z', '2026-11-06T05:59:00.123Z'],
  ])('normalizes a valid source timestamp %s without exposing its original text', async (acquired_at, expected) => {
    const t = setup({...base(), acquired_at}), body = await readBody(await t.handler(request()));
    expect(body.sources[0].cache.recorded_acquisition_at).toBe(expected);
  });
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER, '123', null])('rejects invalid database clock %#', async now_ms => {
    const t = setup({...base(), now_ms}), response = await t.handler(request());
    expect(response.status).toBe(503); expect((await readBody(response)).metadata_complete).toBe(false);
  });
  it('does not expose injected fields, raw errors, tokens, payloads or table names', async () => {
    const t = setup({...base(), lease_token: 'secret-value', payload: '{"financial_rows":100}', error: 'token=password', id: 'secret-row-key'});
    const text = await (await t.handler(request())).text();
    for (const forbidden of ['secret-value', 'financial_rows', 'password', 'secret-row-key', 'lease_token', 'source_gate', 'snapshot_cache']) expect(text).not.toContain(forbidden);
    t.all.mockRejectedValue(new Error('credentials=private-error'));
    expect(await (await t.handler(request())).text()).not.toContain('private-error');
  });
  it('keeps missing rows missing and does not infer scheduler installation', async () => {
    const t = setup(); t.all.mockResolvedValue({success: true, results: []});
    const response = await t.handler(request()), body = await readBody(response);
    expect(response.status).toBe(503); expect(body.sources[0]).toMatchObject({metadata: 'not_initialized', coordination: 'unknown'});
    expect(body.external_scheduler).toMatchObject({installation: 'unknown', metadata: 'not_initialized'});
  });
  it('handles missing database binding without initializing anything', async () => {
    const response = await createDiagnosticsHandler()(request()); expect(response.status).toBe(503);
    expect((await readBody(response)).external_scheduler.installation).toBe('unknown');
  });
  it('bounds unresolved SELECTs and never retries late reads', async () => {
    vi.useFakeTimers(); let resolve!: (result: {success: boolean; results: Record<string, unknown>[]}) => void;
    const all = vi.fn(() => new Promise<{success: boolean; results: Record<string, unknown>[]}>(done => {resolve = done;}));
    const db: ReadOnlyD1 = {prepare: vi.fn(() => ({all}))};
    const pending = createDiagnosticsHandler(db)(request()); await vi.advanceTimersByTimeAsync(DIAGNOSTIC_TIMEOUT_MS * 2 + 1);
    expect((await pending).status).toBe(503); expect(all).toHaveBeenCalledTimes(DIAGNOSTIC_QUERIES.length + 1);
    resolve({success: true, results: [base()]}); await Promise.resolve(); expect(all).toHaveBeenCalledTimes(DIAGNOSTIC_QUERIES.length + 1);
  });
  it('never interprets a scheduler row or timestamp as an installed schedule', async () => {
    const t = setup({...base(), last_seen_ms: now - 1000, last_tick_ms: now - 60_000, last_started_ms: now - 55_000, last_finished_ms: now - 5000});
    const body = await readBody(await t.handler(request())); expect(body.external_scheduler).toMatchObject({installation: 'unknown', observed_job_state: 'idle', last_event_seen_at: '2026-11-06T05:59:59.000Z'});
  });
});
