import {afterEach, describe, expect, it, vi} from 'vitest';
import {createKrakenHandler, KRAKEN_PAIRS_URL, KRAKEN_URL, REFRESH_MS, type KrakenGate, type KrakenReply} from '../lib/crypto/kraken';
import {KrakenTradeCollection, TRADE_LIMIT, tradeSnapshot} from '../lib/crypto/trades';
import {readTradeSelection} from '../lib/crypto/selection';
import {tradeSnapshotSchema} from '../lib/crypto/trade-validation';
import {validateKrakenReply} from '../components/crypto/client';
import {pairMetadata} from './kraken-fixture';
const end = Date.parse('2026-11-05T15:00:00Z'), start = end - 60_000;
const pair = {source_pair: 'XXBTZUSD', pair: 'BTC/USD', base: 'BTC', quote: 'USD' as const};
const cursor = (ms: number) => (BigInt(ms) * BigInt(1_000_000) + BigInt(123)).toString();
const rows = (count: number, offset = 0, begin = start) => Array.from({length: count}, (_, i) => ['1.25', '0.2', (begin + offset + i) / 1000, i % 2 ? 's' : 'b', 'l', '', offset + i + 1]);
const payload = (data: unknown[], last = cursor(start + 999), source = pair.source_pair) => ({error: [], result: {[source]: data, last}});
const collection = () => new KrakenTradeCollection(pair, start, end);
const request = (query = '') => new Request('https://test.invalid/api/v1/crypto/kraken/snapshot' + query);
afterEach(() => vi.useRealTimers());

describe('independent bounded page evidence', () => {
  it('keeps cursor strings exact and stops after a short second page', () => {
    const c = collection(), exact = cursor(start + 999);
    c.append(payload(rows(1000), exact), end);
    expect(new URL(c.requestUrl).searchParams.get('since')).toBe(exact);
    c.append(payload(rows(3, 1000), cursor(start + 1002)), end + 1000);
    expect(c.needsPage).toBe(false);
    expect(() => c.requestUrl).toThrow('trade_page_budget');
    expect(c.row).toMatchObject({page_count: 2, last_page_count: 3, returned_count: 1003, trade_count: 1003, coverage: 'uncapped_response', buy_notional_usd: '125.5', sell_notional_usd: '125.25', imbalance_usd: '0.25'});
    expect(tradeSnapshotSchema.safeParse(tradeSnapshot([c.row], end, end + 1000, ['BTC/USD'], '1m')).success).toBe(true);
  });
  it('retains null totals and color inputs for two full pages, with no third request', () => {
    const c = collection(); c.append(payload(rows(1000)), end); c.append(payload(rows(1000, 1000), cursor(start + 1999)), end + 1000);
    expect(c.row).toMatchObject({page_count: 2, last_page_count: 1000, returned_count: 2000, coverage: 'capped_response', buy_notional_usd: null, sell_notional_usd: null, imbalance_usd: null, imbalance_pct: null});
    expect(() => c.append(payload([]), end + 2000)).toThrow('trade_page_budget');
  });
  it('accepts exact monetary bounds across two pages without overflowing the browser boundary', () => {
    const c = collection();
    for (const page of [0, 1]) {
      const data = rows(page === 0 ? 1000 : 999, page * 1000);
      for (const item of data) {item[0] = '999999999999999.999999999999'; item[1] = '999999999999999.999999999999'; item[3] = 'b';}
      c.append(payload(data, cursor(start + page * 1000 + data.length)), end + page * 1000);
    }
    expect(c.row.buy_notional_usd!.split('.')[0]).toHaveLength(34);
    expect(tradeSnapshotSchema.safeParse(tradeSnapshot([c.row], end, end + 1000, ['BTC/USD'], '1m')).success).toBe(true);
  });
  it('allows an empty terminal page with unchanged cursor without manufacturing coverage', () => {
    const c = collection(); c.append(payload(rows(1000)), end); c.append(payload([]), end + 1000);
    expect(c.row).toMatchObject({page_count: 2, last_page_count: 0, returned_count: 1000, coverage: 'uncapped_response', buy_notional_usd: '125', sell_notional_usd: '125'});
    expect(tradeSnapshot([c.row], end, end + 1000, ['BTC/USD'], '1m').coverage).toBe('selected_usd_pairs_one_venue');
  });
  it.each(['same', 'rewind'])('rejects a nonempty second page with %s cursor', mode => {
    const c = collection(); c.append(payload(rows(1000)), end);
    expect(() => c.append(payload(rows(1, 1000), cursor(start + (mode === 'same' ? 999 : 998))), end + 1000)).toThrow();
  });
  it('rejects duplicate IDs across pages and reversed event order without silently deduplicating', () => {
    const c = collection(); c.append(payload(rows(1000)), end);
    const duplicate = rows(1, 1000); duplicate[0][6] = 1;
    expect(() => c.append(payload(duplicate, cursor(start + 1999)), end + 1000)).toThrow();
    const reversed = rows(1, 2000); reversed[0][2] = (start + 998) / 1000;
    expect(() => c.append(payload(reversed, cursor(start + 1999)), end + 1000)).toThrow();
  });
  it('excludes post-window trades on a continuation and retains the original immutable interval', () => {
    const c = collection(); c.append(payload(rows(1000)), end);
    c.append(payload(rows(2, 60_000), cursor(end + 1)), end + 1000);
    expect(c.row).toMatchObject({trade_count: 1000, excluded_after_window_count: 2, returned_count: 1002, buy_notional_usd: '125'});
    const result = tradeSnapshot([c.row], end, end + 1000, ['BTC/USD'], '1m');
    expect(result.window_started_at).toBe(new Date(start).toISOString()); expect(result.window_ended_at).toBe(new Date(end).toISOString());
  });
  it.each(['0', '999999999999999999999999', cursor(start - 1), cursor(end + 1001)])('rejects out-of-bounds collection cursor %s', invalid => {
    expect(() => collection().append(payload(rows(1), invalid), end)).toThrow();
  });
  it('does not infer cursor equality with the last event or market completeness', () => {
    const c = collection();
    c.append(payload(rows(1000), cursor(start + 5000)), end);
    expect(new URL(c.requestUrl).searchParams.get('since')).toBe(cursor(start + 5000));
    c.append(payload([], cursor(start + 5000)), end + 1000);
    expect(c.row.coverage).toBe('uncapped_response');
    expect(tradeSnapshot([c.row], end, end + 1000, ['BTC/USD'], '1m').coverage).toBe('selected_usd_pairs_one_venue');
  });
  it('accepts old one-page payloads without optional metadata and rejects inconsistent metadata', () => {
    const c = collection(); c.append(payload(rows(1), cursor(start)), end);
    const value = tradeSnapshot([c.row], end, end, ['BTC/USD'], '1m');
    delete value.page_limit; delete value.rows[0].page_count; delete value.rows[0].last_page_count;
    expect(tradeSnapshotSchema.safeParse(value).success).toBe(true);
    value.rows[0].page_count = 2; expect(tradeSnapshotSchema.safeParse(value).success).toBe(false);
    value.rows[0].last_page_count = 1; expect(tradeSnapshotSchema.safeParse(value).success).toBe(false);
  });
});
function setup(full = false) {
  vi.useFakeTimers(); vi.setSystemTime(end);
  const gate: KrakenGate = {inspect: vi.fn(async () => 'idle' as const), acquire: vi.fn(async () => ({token: 'owner'})), release: vi.fn(async () => {})};
  const sources = ['XXBTZUSD', 'XETHZUSD', 'SOLUSD'];
  const calls: {url: string; at: number}[] = [];
  const counts = new Map<string, number>();
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push({url, at: Date.now()});
    if (url === KRAKEN_PAIRS_URL) return Response.json({error: [], result: {XXBTZUSD: pairMetadata('XXBT', 'XBT'), XETHZUSD: pairMetadata('XETH', 'ETH'), SOLUSD: pairMetadata('SOL')}});
    if (url === KRAKEN_URL) return Response.json({error: [], result: Object.fromEntries(sources.map(source => [source, {c: ['1', '1'], v: ['1', '1'], p: ['1', '1'], t: [1, 1]}]))});
    const query = new URL(url).searchParams, source = query.get('pair')!, since = Number(BigInt(query.get('since')!) / BigInt(1_000_000)), page = counts.get(source) ?? 0;
    counts.set(source, page + 1);
    const data = rows(full ? TRADE_LIMIT : 1, 0, since + 1);
    for (const row of data) row[6] = Number(row[6]) + page * 1000;
    return Response.json(payload(data, cursor(since + data.length), source));
  });
  return {gate, calls, fetcher, handler: createKrakenHandler({gate, fetcher, includeTradeImbalance: true, isolatedForTests: true})};
}
async function finish(work: Promise<Response>, delay = 8000): Promise<KrakenReply> {await vi.advanceTimersByTimeAsync(delay); return (await work).json();}
describe('independent timeframe acquisition isolation', () => {
  it('concurrent 1m/5m readers share only quotes, one gate, and one cooldown', async () => {
    const t = setup(), one = t.handler(request('?window=1m'));
    await vi.advanceTimersByTimeAsync(50);
    const five = t.handler(request()), same = t.handler(request('?window=1m'));
    const a = await finish(one), b = await (await five).json() as KrakenReply, c = await (await same).json() as KrakenReply;
    expect(a.trade_snapshot?.window_ms).toBe(60_000); expect(a.requested_window).toBe('1m'); expect(c.trade_snapshot).toEqual(a.trade_snapshot);
    expect(b.trade_snapshot).toBeNull(); expect(b.snapshot).toEqual(a.snapshot); expect(b).not.toHaveProperty('requested_window');
    expect(validateKrakenReply(a)).toEqual(a); expect(validateKrakenReply(b)).toEqual(b);
    expect(t.gate.acquire).toHaveBeenCalledTimes(1);
    await finish(t.handler(request('?window=5m')), 0); expect(t.calls).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    const refreshed = await finish(t.handler(request('?window=5m')));
    expect(refreshed.trade_snapshot?.window_ms).toBe(300_000); expect(refreshed.requested_window).toBe('5m');
    const legacy = await finish(t.handler(request()), 0); expect(legacy).not.toHaveProperty('requested_window'); expect(legacy.trade_snapshot).toEqual(refreshed.trade_snapshot);
    const mismatch = await finish(t.handler(request('?window=1m')), 0); expect(mismatch.trade_snapshot).toBeNull(); expect(t.gate.acquire).toHaveBeenCalledTimes(2);
  });
  it('paces all six trade pages within one lease, deadline, and frozen acquisition window', async () => {
    const t = setup(true), result = await finish(t.handler(request('?window=1m')));
    expect(t.calls).toHaveLength(8); expect(t.gate.acquire).toHaveBeenCalledTimes(1); expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner', {kind: 'success'});
    for (let i = 1; i < t.calls.length; i++) expect(t.calls[i].at - t.calls[i - 1].at).toBeGreaterThanOrEqual(1100);
    expect(t.calls.at(-1)!.at - end).toBeLessThan(12_000);
    expect(result.trade_snapshot?.window_ended_at).toBe(new Date(end).toISOString());
    expect(result.trade_snapshot?.rows.every(row => row.page_count === 2 && row.imbalance_pct === null)).toBe(true);
    expect(validateKrakenReply(result)).toEqual(result);
    await finish(t.handler(request('?window=5m')), 0); expect(t.calls).toHaveLength(8);
  });
  it.each(['?window=15m', '?window=1m&window=5m', '?pairs=BTC/USD,ETH/USD,SOL/USD,ADA/USD&window=1m'])('rejects %s before gate inspection', async query => {
    const t = setup(); expect((await t.handler(request(query))).status).toBe(400); expect(t.gate.inspect).not.toHaveBeenCalled(); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('keeps legacy URLs equivalent to explicit 5m evidence while window explicitness stays distinct', () => {
    const legacy = readTradeSelection(new URL(request().url), true), explicit = readTradeSelection(new URL(request('?window=5m').url), true);
    expect(legacy.key).toBe(explicit.key); expect(legacy.windowExplicit).toBe(false); expect(explicit.windowExplicit).toBe(true);
  });
});

describe('continuation failures preserve the shared acquisition lifecycle', () => {
  function interceptFirstContinuation(t: ReturnType<typeof setup>, response: () => Response) {
    const original = t.fetcher.getMockImplementation()!;
    let trades = 0;
    t.fetcher.mockImplementation(async (input, init) => {
      if (String(input).includes('/Trades?') && ++trades === 4) return response();
      return original(input, init);
    });
  }
  it('stops remaining continuations on HTTP429, releases denied once, and clears prior caches', async () => {
    const t = setup(true), prior = await finish(t.handler(request('?window=1m')));
    expect(prior.trade_snapshot?.rows).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    t.fetcher.mockClear(); vi.mocked(t.gate.acquire).mockClear(); vi.mocked(t.gate.release).mockClear();
    interceptFirstContinuation(t, () => new Response(null, {status: 429}));
    const denied = await finish(t.handler(request('?window=1m')));
    expect(denied).toMatchObject({snapshot: null, trade_snapshot: null, status: {state: 'denied', error_code: 'source_access_denied'}});
    expect(t.fetcher).toHaveBeenCalledTimes(5); // Cached catalog: ticker, three initial pages, one continuation.
    const tradeCalls = t.fetcher.mock.calls.filter(([input]) => String(input).includes('/Trades?'));
    expect(tradeCalls.map(([input]) => new URL(String(input)).searchParams.get('pair'))).toEqual(['XXBTZUSD', 'XETHZUSD', 'SOLUSD', 'XXBTZUSD']);
    expect(t.gate.acquire).toHaveBeenCalledTimes(1);
    expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner', expect.objectContaining({kind: 'denied'}));
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    for (const query of ['?window=1m', '?window=5m', '']) {
      const read = await finish(t.handler(request(query)), 0);
      expect(read).toMatchObject({snapshot: null, trade_snapshot: null, status: {state: 'denied'}});
    }
    expect(t.fetcher).toHaveBeenCalledTimes(5); expect(t.gate.release).toHaveBeenCalledTimes(1);
  });
  it('times out a hanging continuation at the original 12-second deadline without publishing partial evidence', async () => {
    const t = setup(true);
    interceptFirstContinuation(t, () => new Response(new ReadableStream({start() {}}), {headers: {'content-type': 'application/json'}}));
    let settled = false;
    const work = t.handler(request('?window=1m')).then(response => {settled = true; return response;});
    await vi.advanceTimersByTimeAsync(11_999);
    expect(settled).toBe(false); expect(t.fetcher).toHaveBeenCalledTimes(6); expect(t.gate.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const result = await (await work).json() as KrakenReply;
    expect(Date.now() - end).toBe(12_000);
    expect(result).toMatchObject({snapshot: null, trade_snapshot: null, status: {state: 'unavailable', error_code: 'timeout'}});
    expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner', expect.objectContaining({kind: 'temporary_failure'}));
    await finish(t.handler(request('?window=5m')), 0);
    expect(t.fetcher).toHaveBeenCalledTimes(6); expect(t.gate.acquire).toHaveBeenCalledTimes(1);
  });
  it('retains original matching stale evidence after another timeframe continuation fails without relabeling it', async () => {
    const t = setup(true), prior = await finish(t.handler(request('?window=1m')));
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    t.fetcher.mockClear(); vi.mocked(t.gate.release).mockClear();
    interceptFirstContinuation(t, () => Response.json({}, {status: 503}));
    const failed = await finish(t.handler(request('?window=5m')));
    expect(failed).toMatchObject({requested_window: '5m', trade_snapshot: null, status: {state: 'stale', error_code: 'upstream_http'}});
    expect(failed.snapshot).toEqual(prior.snapshot); expect(validateKrakenReply(failed)).toEqual(failed);
    expect(t.fetcher).toHaveBeenCalledTimes(5);
    expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner', expect.objectContaining({kind: 'temporary_failure'}));
    const retained = await finish(t.handler(request('?window=1m')), 0);
    expect(retained.status.state).toBe('stale'); expect(retained.trade_snapshot).toEqual(prior.trade_snapshot);
    expect(retained.trade_snapshot?.window_ms).toBe(60_000); expect(retained.snapshot).toEqual(prior.snapshot);
    expect(validateKrakenReply(retained)).toEqual(retained);
    const legacy = await finish(t.handler(request()), 0);
    expect(legacy.trade_snapshot).toBeNull(); expect(legacy).not.toHaveProperty('requested_window');
    expect(t.fetcher).toHaveBeenCalledTimes(5);
  });
});
