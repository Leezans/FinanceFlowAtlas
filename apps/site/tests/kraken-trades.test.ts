import {afterEach, describe, expect, it, vi} from 'vitest';
import {createKrakenHandler, KRAKEN_PAIRS_URL, KRAKEN_URL, MAX_CACHE_AGE_MS, REFRESH_MS, type KrakenGate, type KrakenReply} from '../lib/crypto/kraken';
import {parseKrakenTrades, selectedTradePairs, tradeRequestUrl, tradeSnapshot, TRADE_LIMIT, TRADE_WINDOW_MS, type KrakenTradeRow} from '../lib/crypto/trades';
import {validateKrakenReply} from '../components/crypto/client';
import {catalog, pairMetadata, universe, parseTicker} from './kraken-fixture';
const end = Date.parse('2026-11-05T03:00:00.000Z'), start = end - TRADE_WINDOW_MS, iso = new Date(end).toISOString();
const pair = universe(iso).pairs[0];
const trade = (overrides: unknown[] = []) => ['0.1', '0.2', (start + 1000) / 1000, 'b', 'l', '', 101].map((value, index) => index in overrides ? overrides[index] : value);
const payload = (rows: unknown[] = [trade(), ['0.3', '0.1', (start + 2000) / 1000, 's', 'm', '', 102]], sourcePair = pair.source_pair) => ({error: [], result: {[sourcePair]: rows, last: '1234567890123456789'}});
const parse = (raw: unknown = payload()) => parseKrakenTrades(raw, pair, start, end, end + 1000);
const ticks = () => ({error: [], result: Object.fromEntries(['XXBTZUSD', 'XETHZUSD', 'SOLUSD'].map(key => [key, {c: ['10', '1'], v: ['99', '1'], p: ['99', '10'], t: [99, 2]}]))});
const request = () => new Request('https://test.invalid/api/v1/crypto/kraken/snapshot');
afterEach(() => vi.useRealTimers());
describe('bounded executed-trade semantics', () => {
  it('sums decimal products exactly, respects source buy/sell markers, and separates cursor from event times', () => {
    const row = parse();
    expect(row).toMatchObject({buy_notional_usd: '0.02', sell_notional_usd: '0.03', imbalance_usd: '-0.01', imbalance_pct: -20, trade_count: 2, returned_count: 2, coverage: 'uncapped_response'});
    expect(row.first_trade_at).toBe(new Date(start + 1000).toISOString());
    expect(row.last_trade_at).toBe(new Date(start + 2000).toISOString());
    expect(row.cursor).toBe('1234567890123456789');
  });
  it('keeps precision through 24 decimal places without floating point notional sums', () => {
    expect(parse(payload([trade(['0.000000000001', '0.000000000001'])])).imbalance_usd).toBe('0.000000000000000000000001');
    expect(parse(payload([trade(['999999999999999.999999999999', '999999999999999.999999999999'])])).buy_notional_usd).toBe('999999999999999999999999998000.000000000000000000000001');
  });
  it('uses the common half-open interval and excludes later executions instead of mixing windows', () => {
    const rows = [trade(['1', '1', start / 1000]), trade(['2', '2', end / 1000, 's', 'm', '', 102])];
    expect(parse(payload(rows))).toMatchObject({trade_count: 1, returned_count: 2, excluded_after_window_count: 1, buy_notional_usd: '1', sell_notional_usd: '0', imbalance_pct: 100});
  });
  it('handles sub-millisecond execution times and pages entirely after the shared end', () => {
    const inside=parse(payload([trade(['1','1',end/1000-0.0001])]));expect(inside.trade_count).toBe(1);expect(inside.last_trade_at).toBe(new Date(end-1).toISOString());
    const after=parse(payload([trade(['1','1',end/1000+0.0001])]));expect(after).toMatchObject({trade_count:0,excluded_after_window_count:1,buy_notional_usd:'0',imbalance_pct:null});
    const capped=parse(payload(Array.from({length:TRADE_LIMIT},(_,index)=>trade(['1','1',end/1000+index/10000,'b','l','',index+1]))));expect(capped).toMatchObject({coverage:'capped_response',trade_count:0,excluded_after_window_count:1000,imbalance_usd:null});
  });
  it('returns observed empty response as zero turnover but no normalized imbalance', () => {
    expect(parse(payload([]))).toMatchObject({trade_count: 0, buy_notional_usd: '0', sell_notional_usd: '0', imbalance_usd: '0', imbalance_pct: null, first_trade_at: null, last_trade_at: null});
  });
  it('never publishes a total or heatmap color for a full potentially truncated page', () => {
    const rows = Array.from({length: TRADE_LIMIT}, (_, index) => trade(['1', '1', (start + index) / 1000, 'b', 'm', '', index + 1]));
    expect(parse(payload(rows))).toMatchObject({coverage: 'capped_response', returned_count: 1000, trade_count: 1000, buy_notional_usd: null, sell_notional_usd: null, imbalance_usd: null, imbalance_pct: null});
    expect(() => parse(payload([...rows, rows[0]]))).toThrow('trade_count_budget');
  });
  it('only requests fixed catalog-confirmed pairs and keeps nanosecond since/cursor strings exact', () => {
    const url = new URL(tradeRequestUrl(pair, start));
    expect(url.origin + url.pathname).toBe('https://api.kraken.com/0/public/Trades');
    expect(url.searchParams.get('since')).toBe(`${start}000000`); expect(url.searchParams.get('count')).toBe('1000');
    expect(selectedTradePairs(universe(iso)).map(row => row.pair)).toEqual(['BTC/USD', 'ETH/USD']);
    expect(() => tradeRequestUrl({...pair, pair: 'OTHER/USD'}, start)).toThrow('invalid_trade_request');
    expect(tradeSnapshot([parse()], end, end + 1000).missing_pairs).toEqual(['ETH/USD', 'SOL/USD']);
  });
  it.each(['0', '-1', 'NaN', '1e3', '01', 1, null])('rejects invalid executed price %s rather than inventing zero', value => expect(() => parse(payload([trade([value])]))).toThrow('invalid_trade_decimal'));
  it.each([
    trade(['1', '0']), trade(['1', '1', '123']), trade(['1', '1', end / 1000, 'unknown']), trade(['1', '1', end / 1000, 'b', 'unknown']), trade(['1', '1', end / 1000, 'b', 'l', {}, 1]), trade(['1', '1', end / 1000, 'b', 'l', '', Number.MAX_SAFE_INTEGER + 1]), trade().slice(0, 6),
  ])('rejects malformed trade tuple %j', row => expect(() => parse(payload([row]))).toThrow());
  it('rejects duplicate identities, reversed/out-of-window times, wrong pair and invalid cursors', () => {
    expect(() => parse(payload([trade(), trade()]))).toThrow('duplicate_trade_id');
    expect(() => parse(payload([trade(), trade(['1', '1', start / 1000, 's', 'l', '', 102])]))).toThrow('invalid_trade_time');
    expect(() => parse(payload([trade(['1', '1', (start - 1) / 1000])]))).toThrow('invalid_trade_time');
    expect(() => parse(payload([trade(['1', '1', (end + 5000) / 1000])]))).toThrow('invalid_trade_time');
    expect(() => parse(payload([], 'OTHER'))).toThrow('invalid_trade_pair');
    expect(() => parse({...payload(), result: {...payload().result, last: 123}})).toThrow('invalid_trade_cursor');
  });
  it('preserves API denial classification and bounds acquisition clocks', () => {
    expect(() => parse({error: ['EAPI:Rate limit exceeded']})).toThrow('source_access_denied');
    expect(() => parseKrakenTrades(payload(), pair, start, end, end + 12_001)).toThrow('invalid_trade_clock');
    expect(() => parseKrakenTrades(payload(), pair, start, end + 1, end + 1000)).toThrow('invalid_trade_clock');
  });
});
function reply(): KrakenReply {
  const finished = new Date(end + 1000).toISOString();
  return {snapshot: parseTicker(ticks(), iso, finished), trade_snapshot: tradeSnapshot(universe(iso).pairs.map(selected=>parseKrakenTrades(payload(undefined,selected.source_pair),selected,start,end,end+1000)), end, end + 1000), status: {state: 'available', error_code: null, last_attempt_at: iso, fetched_at: finished, cache_age_ms: 0, refresh_ms: REFRESH_MS, max_cache_age_ms: MAX_CACHE_AGE_MS, next_retry_at: new Date(end + REFRESH_MS).toISOString()}};
}
describe('trade browser boundary', () => {
  it('validates coordinated quotes/trades and retains compatibility with earlier quote replies', () => {
    expect(validateKrakenReply(reply()).trade_snapshot?.rows[0].imbalance_usd).toBe('-0.01');
    const old = reply(); delete old.trade_snapshot; expect(validateKrakenReply(old).snapshot).not.toBeNull();
  });
  it.each([
    (r: KrakenTradeRow) => { r.imbalance_usd = '0'; }, (r: KrakenTradeRow) => { r.imbalance_pct = 20; }, (r: KrakenTradeRow) => { r.returned_count++; }, (r: KrakenTradeRow) => { r.coverage = 'capped_response'; }, (r: KrakenTradeRow) => { r.last_trade_at = iso; }, (r: KrakenTradeRow) => { r.first_trade_at = null; }, (r: KrakenTradeRow) => { r.base = 'ETH'; }, (r: KrakenTradeRow) => { r.fetched_at = new Date(end + 2000).toISOString(); },
  ])('rejects internally inconsistent or tampered row', mutate => { const value = reply(); mutate(value.trade_snapshot!.rows[0]); expect(() => validateKrakenReply(value)).toThrow(); });
  it('checks trade source identities and selected membership against the catalog-backed quote universe', () => {
    const identity=reply();identity.trade_snapshot!.rows[0].source_pair='WRONGUSD';expect(()=>validateKrakenReply(identity)).toThrow();
    const omitted=reply();omitted.trade_snapshot!.rows.pop();omitted.trade_snapshot!.missing_pairs.push('ETH/USD');expect(()=>validateKrakenReply(omitted)).toThrow();
    const extra=reply();extra.snapshot!.rows.pop();extra.snapshot!.universe_pair_count=1;expect(()=>validateKrakenReply(extra)).toThrow();
    // A catalog-confirmed pair may have unusable ticker data but valid trades.
    const missingQuote=reply();missingQuote.snapshot!.rows.pop();missingQuote.snapshot!.missing.push({pair:'ETH/USD',reason:'invalid_ticker'});missingQuote.snapshot!.quality='partial';expect(()=>validateKrakenReply(missingQuote)).not.toThrow();
  });
  it('rejects duplicate/missing coverage, different acquisition windows, and trade evidence on denied quotes', () => {
    const duplicate = reply(); duplicate.trade_snapshot!.missing_pairs = ['ETH/USD', 'ETH/USD']; expect(() => validateKrakenReply(duplicate)).toThrow();
    const wrongWindow = reply(); wrongWindow.trade_snapshot!.window_started_at = iso; expect(() => validateKrakenReply(wrongWindow)).toThrow();
    const wrongFetch = reply(); wrongFetch.trade_snapshot!.fetched_at = new Date(end + 2000).toISOString(); expect(() => validateKrakenReply(wrongFetch)).toThrow();
    const denied = reply(); denied.status.state = 'denied'; denied.snapshot = null; expect(() => validateKrakenReply(denied)).toThrow();
  });
});
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(end);
  const gate: KrakenGate = {inspect: vi.fn(async () => 'idle' as const), acquire: vi.fn(async () => ({token: 'one'})), release: vi.fn(async () => {})};
  const calls: {url: string; at: number}[] = [];
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push({url, at: Date.now()});
    if (url === KRAKEN_PAIRS_URL) return Response.json({error: [], result: {...catalog().result, SOLUSD: pairMetadata('SOL')}});
    if (url === KRAKEN_URL) return Response.json(ticks());
    const query = new URL(url).searchParams, begin = Number(BigInt(query.get('since')!) / BigInt(1_000_000));
    return Response.json(payload([trade(['0.1', '0.2', (begin + 1000) / 1000])], query.get('pair')!));
  });
  return {gate, calls, fetcher, handler: createKrakenHandler({gate, fetcher, includeTradeImbalance: true, isolatedForTests: true})};
}
async function collect(t: ReturnType<typeof setup>) { const work = t.handler(request()); await vi.advanceTimersByTimeAsync(4500); return (await work).json() as Promise<KrakenReply>; }
describe('one admitted lifecycle for quote and bounded trade collection', () => {
  it('paces every endpoint, performs at most three trade requests, and retains common timestamps', async () => {
    const t = setup(), result = await collect(t); expect(result.status.state).toBe('available'); expect(t.calls).toHaveLength(5);
    for (let index = 1; index < t.calls.length; index++) expect(t.calls[index].at - t.calls[index - 1].at).toBeGreaterThanOrEqual(1100);
    expect(result.trade_snapshot?.rows).toHaveLength(3); expect(result.trade_snapshot?.window_ended_at).toBe(iso); expect(result.trade_snapshot?.fetched_at).toBe(result.snapshot?.fetched_at); expect(validateKrakenReply(result).snapshot).not.toBeNull();
    expect(t.gate.acquire).toHaveBeenCalledTimes(1); expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('one', {kind: 'success'});
    await collect(t); expect(t.calls).toHaveLength(5); await vi.advanceTimersByTimeAsync(REFRESH_MS); await collect(t); expect(t.calls).toHaveLength(9);
  });
  it('classifies a ticker API denial before any Trades request', async () => {
    const t = setup(), original = t.fetcher.getMockImplementation()!;
    t.fetcher.mockImplementation(async (url, init) => String(url) === KRAKEN_URL ? Response.json({error: ['EAPI:Rate limit exceeded']}) : original(url, init));
    const result = await collect(t); expect(result).toMatchObject({snapshot: null, trade_snapshot: null, status: {state: 'denied', error_code: 'source_access_denied'}});
    expect(t.fetcher).toHaveBeenCalledTimes(2); expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('one', expect.objectContaining({kind: 'denied'}));
  });
  it.each([403, 429, 451])('stops all shared acquisition after trade HTTP %s, with no remaining pairs or retry', async status => {
    const t = setup(), original = t.fetcher.getMockImplementation()!;
    t.fetcher.mockImplementation(async (url, init) => String(url).includes('/Trades?') ? new Response(null, {status}) : original(url, init));
    const result = await collect(t); expect(result).toMatchObject({snapshot: null, trade_snapshot: null, status: {state: 'denied'}}); expect(t.fetcher).toHaveBeenCalledTimes(3);
    expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('one', expect.objectContaining({kind: 'denied'})); await vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS); await collect(t); expect(t.fetcher).toHaveBeenCalledTimes(3);
  });
  it('preserves both original stale snapshots after temporary trade failure, never mixing collections', async () => {
    const t = setup(), first = await collect(t), original = t.fetcher.getMockImplementation()!; await vi.advanceTimersByTimeAsync(REFRESH_MS);
    t.fetcher.mockImplementation(async (url, init) => String(url).includes('/Trades?') ? Response.json({}, {status: 503}) : original(url, init));
    const result = await collect(t); expect(result.status.state).toBe('stale'); expect(result.snapshot).toEqual(first.snapshot); expect(result.trade_snapshot).toEqual(first.trade_snapshot);
    expect(t.gate.release).toHaveBeenLastCalledWith('one', expect.objectContaining({kind: 'temporary_failure'}));
    await vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS + 1); const expired = await collect(t); expect(expired.snapshot).toBeNull(); expect(expired.trade_snapshot).toBeNull();
  });
  it('keeps the existing 12-second total deadline and releases once without additional trade requests', async () => {
    const t = setup(), original = t.fetcher.getMockImplementation()!;
    t.fetcher.mockImplementation(async (url, init) => String(url).includes('/Trades?') ? new Response(new ReadableStream({start() {}}), {headers: {'content-type': 'application/json'}}) : original(url, init));
    const work = t.handler(request()); await vi.advanceTimersByTimeAsync(12_001); const result = await (await work).json() as KrakenReply;
    expect(result.status.error_code).toBe('timeout'); expect(result.trade_snapshot).toBeNull(); expect(t.fetcher).toHaveBeenCalledTimes(3); expect(t.gate.release).toHaveBeenCalledTimes(1);
  });
  it('does not start trade acquisition after cancellation during spacing', async () => {
    const t = setup(), controller = new AbortController(), work = t.handler(new Request(request(), {signal: controller.signal}));
    await vi.advanceTimersByTimeAsync(1200); controller.abort(); await vi.advanceTimersByTimeAsync(1);
    const result = await (await work).json() as KrakenReply; expect(result.status.error_code).toBe('aborted'); expect(result.trade_snapshot).toBeNull(); expect(t.fetcher).toHaveBeenCalledTimes(2); expect(t.gate.release).toHaveBeenCalledTimes(1);
  });
});
