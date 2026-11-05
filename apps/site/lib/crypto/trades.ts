/** Bounded, single-venue executed-trade evidence. Never a net capital-flow model. */
import type {KrakenPair, KrakenUniverse} from './kraken';
import {KrakenError, krakenResult} from './protocol';
import {DEFAULT_TRADE_PAIRS, MAX_SELECTED_TRADE_PAIRS, TRADE_PAIR_PATTERN, canonicalTradeSelection, tradeWindowMilliseconds, type TradeTimeframe} from './selection';

export const KRAKEN_TRADES_DOCS = 'https://docs.kraken.com/api-reference/market-data/get-recent-trades';
export const KRAKEN_TAKER_DOCS = 'https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/trade';
export const TRADE_PAIRS = DEFAULT_TRADE_PAIRS;
export const TRADE_WINDOW_MS = 300_000;
export const TRADE_LIMIT = 1_000;
export const TRADE_PAGE_LIMIT = 2;
export const MAX_TRADE_REQUESTS = TRADE_PAGE_LIMIT * MAX_SELECTED_TRADE_PAIRS;
export type TradePair = string;
export type KrakenTradeRow = KrakenPair & {
  coverage: 'uncapped_response' | 'capped_response';
  returned_count: number;
  page_count?: number;
  last_page_count?: number;
  trade_count: number;
  excluded_after_window_count: number;
  first_trade_at: string | null;
  last_trade_at: string | null;
  fetched_at: string;
  cursor: string;
  buy_notional_usd: string | null;
  sell_notional_usd: string | null;
  imbalance_usd: string | null;
  imbalance_pct: number | null;
};
export type KrakenTradeSnapshot = {
  schema: 'kraken-trades/1' | 'kraken-trades/2';
  selected_pairs?: string[];
  venue: 'Kraken';
  coverage: 'selected_usd_pairs_one_venue';
  window_started_at: string;
  window_ended_at: string;
  fetched_at: string;
  window_ms: 60_000 | 300_000;
  page_limit?: typeof TRADE_PAGE_LIMIT;
  trade_limit: typeof TRADE_LIMIT;
  rows: KrakenTradeRow[];
  missing_pairs: TradePair[];
  net_capital_flow: null;
};
function fail(code: string): never { throw new KrakenError(code); }
const DECIMAL = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/;
const SCALE = BigInt(10) ** BigInt(12), NOTIONAL_SCALE = SCALE * SCALE;
function scaled(value: unknown): bigint {
  if (typeof value !== 'string' || !DECIMAL.test(value)) fail('invalid_trade_decimal');
  const [whole, fraction = ''] = (value as string).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
  if (result <= BigInt(0)) fail('invalid_trade_decimal');
  return result;
}
export function formatTradeNotional(value: bigint): string {
  const negative = value < BigInt(0), absolute = negative ? -value : value;
  const fraction = (absolute % NOTIONAL_SCALE).toString().padStart(24, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / NOTIONAL_SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function selectedTradePairs(universe: KrakenUniverse, selected: readonly string[] = TRADE_PAIRS): KrakenPair[] {
  return canonicalTradeSelection(selected).flatMap(name => universe.pairs.filter(pair => pair.pair === name));
}
export function tradeRequestUrl(pair: KrakenPair, windowStart: number, cursor?: string): string {
  if (!TRADE_PAIR_PATTERN.test(pair.pair) || pair.pair !== `${pair.base}/USD` || pair.quote !== 'USD' || !/^[A-Z0-9][A-Z0-9.]{0,31}$/.test(pair.source_pair) || !Number.isSafeInteger(windowStart) || windowStart <= 0) fail('invalid_trade_request');
  if (cursor !== undefined && (!/^\d{1,24}$/.test(cursor) || BigInt(cursor) <= BigInt(windowStart) * BigInt(1_000_000))) fail('invalid_trade_cursor');
  const url = new URL('https://api.kraken.com/0/public/Trades');
  url.searchParams.set('pair', pair.source_pair);
  url.searchParams.set('since', cursor ?? (BigInt(windowStart) * BigInt(1_000_000)).toString());
  url.searchParams.set('count', String(TRADE_LIMIT));
  return url.toString();
}
/**
 * One bounded response, not a cursor-following archive. A full page may truncate
 * the requested window, so it never supplies a window total or a heatmap color.
 * Separate snapshots overlap and must never be accumulated into a daily total.
 */
function parseTradePage(payload: unknown, pair: KrakenPair, windowStart: number, windowEnd: number, fetched: number) {
  if (!Number.isSafeInteger(windowStart) || !Number.isSafeInteger(windowEnd) || !Number.isSafeInteger(fetched) || ![60_000, TRADE_WINDOW_MS].includes(windowEnd - windowStart) || windowStart <= 0 || fetched < windowEnd || fetched - windowEnd > 12_000) fail('invalid_trade_clock');
  const result = krakenResult(payload, 2), keys = Object.keys(result);
  if (keys.length !== 2 || !Object.hasOwn(result, pair.source_pair) || !Object.hasOwn(result, 'last')) fail('invalid_trade_pair');
  const cursor = result.last;
  if (typeof cursor !== 'string' || !/^\d{1,24}$/.test(cursor)) fail('invalid_trade_cursor');
  const raw = result[pair.source_pair];
  if (!Array.isArray(raw) || raw.length > TRADE_LIMIT) fail('trade_count_budget');
  const seen = new Set<number>();
  let firstReturned: number | null = null;
  let buy = BigInt(0), sell = BigInt(0), count = 0, excluded = 0, first: number | null = null, last: number | null = null, prior = -Infinity;
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 7) fail('invalid_trade_tuple');
    const [price, volume, time, side, orderType, misc, tradeId] = item;
    const notional = scaled(price) * scaled(volume);
    if (typeof time !== 'number' || !Number.isFinite(time) || typeof tradeId !== 'number' || !Number.isSafeInteger(tradeId) || tradeId <= 0 || !['b', 's'].includes(side) || !['m', 'l'].includes(orderType) || typeof misc !== 'string' || misc.length > 64) fail('invalid_trade_fields');
    const milliseconds = time * 1000;
    // Millisecond comparisons preserve the API number's available precision.
    if (milliseconds < windowStart || milliseconds > fetched + 1_000 || milliseconds < prior) fail('invalid_trade_time');
    if (seen.has(tradeId)) fail('duplicate_trade_id');
    seen.add(tradeId); firstReturned ??= milliseconds; prior = milliseconds;
    if (milliseconds >= windowEnd) { excluded++; continue; }
    count++; first ??= milliseconds; last = milliseconds;
    if (side === 'b') buy += notional; else sell += notional;
  }
  return {pair, buy, sell, count, excluded, first, last, fetched, cursor, returned: raw.length, ids: seen, firstReturned, lastReturned: raw.length ? prior : null};
}
type TradePage = ReturnType<typeof parseTradePage>;
function summarizePages(pages: readonly TradePage[]): KrakenTradeRow {
  const final = pages[pages.length - 1], capped = final.returned === TRADE_LIMIT;
  const buy = pages.reduce((total, page) => total + page.buy, BigInt(0)), sell = pages.reduce((total, page) => total + page.sell, BigInt(0));
  const first = pages.find(page => page.first !== null)?.first ?? null, last = [...pages].reverse().find(page => page.last !== null)?.last ?? null;
  return {...final.pair, coverage: capped ? 'capped_response' : 'uncapped_response', returned_count: pages.reduce((total, page) => total + page.returned, 0),
    page_count: pages.length, last_page_count: final.returned, trade_count: pages.reduce((total, page) => total + page.count, 0), excluded_after_window_count: pages.reduce((total, page) => total + page.excluded, 0),
    first_trade_at: first === null ? null : new Date(first).toISOString(), last_trade_at: last === null ? null : new Date(last).toISOString(), fetched_at: new Date(final.fetched).toISOString(), cursor: final.cursor,
    buy_notional_usd: capped ? null : formatTradeNotional(buy), sell_notional_usd: capped ? null : formatTradeNotional(sell), imbalance_usd: capped ? null : formatTradeNotional(buy - sell),
    imbalance_pct: capped || buy + sell === BigInt(0) ? null : Number((buy - sell) * BigInt(1_000_000) / (buy + sell)) / 10_000};
}
/** One page alone never proves full-window or full-market completeness. */
export function parseKrakenTrades(payload: unknown, pair: KrakenPair, windowStart: number, windowEnd: number, fetched: number): KrakenTradeRow {
  return summarizePages([parseTradePage(payload, pair, windowStart, windowEnd, fetched)]);
}
/** Bounded continuation only; no duplicate suppression, inferred gaps or hidden retry. */
export class KrakenTradeCollection {
  private readonly pages: TradePage[] = [];
  private readonly ids = new Set<number>();
  constructor(readonly pair: KrakenPair, readonly windowStart: number, readonly windowEnd: number) {}
  get needsPage(): boolean {return this.pages.length < TRADE_PAGE_LIMIT && (!this.pages.length || this.pages[this.pages.length - 1].returned === TRADE_LIMIT);}
  get requestUrl(): string {
    if (!this.needsPage) fail('trade_page_budget');
    return tradeRequestUrl(this.pair, this.windowStart, this.pages.at(-1)?.cursor);
  }
  append(payload: unknown, fetched: number): void {
    if (!this.needsPage) fail('trade_page_budget');
    const page = parseTradePage(payload, this.pair, this.windowStart, this.windowEnd, fetched), prior = this.pages.at(-1);
    // Bound a timestamp continuation to this acquisition, without treating it
    // as the latest execution time (those are separate provider fields).
    const cursor = BigInt(page.cursor), startCursor = BigInt(this.windowStart) * BigInt(1_000_000), maximumCursor = BigInt(fetched + 1_000) * BigInt(1_000_000);
    if (cursor < startCursor || cursor > maximumCursor) fail('invalid_trade_cursor');
    if (!prior && page.returned > 0 && cursor === startCursor) fail('trade_cursor_not_advancing');
    if (prior) {
      // Cursors remain exact strings. A nonempty page must make strict forward
      // progress; an empty terminal page may repeat, but never rewind, the cursor.
      if (BigInt(page.cursor) < BigInt(prior.cursor) || page.returned > 0 && BigInt(page.cursor) === BigInt(prior.cursor)) fail('trade_cursor_not_advancing');
      if (page.fetched < prior.fetched || page.firstReturned !== null && prior.lastReturned !== null && page.firstReturned < prior.lastReturned) fail('invalid_trade_page_order');
    }
    for (const id of page.ids) {if (this.ids.has(id)) fail('duplicate_trade_id');}
    for (const id of page.ids) this.ids.add(id);
    this.pages.push(page);
  }
  get row(): KrakenTradeRow {if (!this.pages.length) fail('empty_trade_collection'); return summarizePages(this.pages);}
}
export function tradeSnapshot(rows: KrakenTradeRow[], windowEnd: number, fetched: number, selected?: readonly string[], timeframe: TradeTimeframe = '5m'): KrakenTradeSnapshot {
  const pairs = canonicalTradeSelection(selected ?? TRADE_PAIRS), windowMs = tradeWindowMilliseconds(timeframe);
  return {schema: selected ? 'kraken-trades/2' : 'kraken-trades/1', ...(selected ? {selected_pairs: pairs} : {}), venue: 'Kraken', coverage: 'selected_usd_pairs_one_venue', window_started_at: new Date(windowEnd - windowMs).toISOString(), window_ended_at: new Date(windowEnd).toISOString(), fetched_at: new Date(fetched).toISOString(), window_ms: windowMs, trade_limit: TRADE_LIMIT, page_limit: TRADE_PAGE_LIMIT,
    rows, missing_pairs: pairs.filter(pair => !rows.some(row => row.pair === pair)), net_capital_flow: null};
}
