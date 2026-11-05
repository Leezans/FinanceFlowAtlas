/** Untrusted browser/cache boundary, separate from acquisition and presentation. */
import {z} from 'zod';
import {TRADE_LIMIT, TRADE_PAIRS, TRADE_WINDOW_MS, TRADE_PAGE_LIMIT} from './trades';
import {MAX_SELECTED_TRADE_PAIRS, TRADE_PAIR_PATTERN, canonicalTradeSelection} from './selection';
export const tradeSelectionSchema = z.array(z.string().regex(TRADE_PAIR_PATTERN)).min(1).max(MAX_SELECTED_TRADE_PAIRS).refine(pairs => {
  try {return JSON.stringify(pairs) === JSON.stringify(canonicalTradeSelection(pairs));} catch {return false;}
});
const date = z.string().datetime({offset: true});
const amount = z.string().regex(/^(?:0|[1-9]\d{0,33})(?:\.\d{1,24})?$/);
const signed = z.string().regex(/^-?(?:0|[1-9]\d{0,33})(?:\.\d{1,24})?$/).refine(value => !/^-0(?:\.0+)?$/.test(value));
const toInteger = (value: string): bigint => {
  const negative = value.startsWith('-'), [whole, tail = ''] = value.replace(/^-/, '').split('.');
  return (negative ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * BigInt(10) ** BigInt(24) + BigInt(tail.padEnd(24, '0')));
};
const row = z.object({
  source_pair: z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}$/), pair: z.string().regex(TRADE_PAIR_PATTERN), base: z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}$/), quote: z.literal('USD'),
  coverage: z.enum(['uncapped_response', 'capped_response']), returned_count: z.number().int().min(0).max(TRADE_LIMIT * TRADE_PAGE_LIMIT), trade_count: z.number().int().min(0).max(TRADE_LIMIT * TRADE_PAGE_LIMIT), excluded_after_window_count: z.number().int().min(0).max(TRADE_LIMIT * TRADE_PAGE_LIMIT),
  page_count: z.number().int().min(1).max(TRADE_PAGE_LIMIT).optional(), last_page_count: z.number().int().min(0).max(TRADE_LIMIT).optional(),
  first_trade_at: date.nullable(), last_trade_at: date.nullable(), fetched_at: date, cursor: z.string().regex(/^\d{1,24}$/),
  buy_notional_usd: amount.nullable(), sell_notional_usd: amount.nullable(), imbalance_usd: signed.nullable(), imbalance_pct: z.number().finite().min(-100).max(100).nullable(),
}).strict().refine(row => {
  if ((row.page_count === undefined) !== (row.last_page_count === undefined)) return false;
  const pages = row.page_count ?? 1, lastPage = row.last_page_count ?? row.returned_count;
  if (lastPage > TRADE_LIMIT || row.returned_count !== (pages - 1) * TRADE_LIMIT + lastPage) return false;
  if (row.pair !== `${row.base}/USD` || row.trade_count + row.excluded_after_window_count !== row.returned_count || (row.coverage === 'capped_response') !== (lastPage === TRADE_LIMIT)) return false;
  if ((row.trade_count === 0) !== (row.first_trade_at === null && row.last_trade_at === null) || row.trade_count > 0 && (row.first_trade_at === null || row.last_trade_at === null)) return false;
  if (row.coverage === 'capped_response') return row.buy_notional_usd === null && row.sell_notional_usd === null && row.imbalance_usd === null && row.imbalance_pct === null;
  if (row.buy_notional_usd === null || row.sell_notional_usd === null || row.imbalance_usd === null) return false;
  const buy = toInteger(row.buy_notional_usd), sell = toInteger(row.sell_notional_usd), imbalance = toInteger(row.imbalance_usd), total = buy + sell;
  if (buy - sell !== imbalance || (row.trade_count === 0) !== (total === BigInt(0))) return false;
  return total === BigInt(0) ? row.imbalance_pct === null : row.imbalance_pct === Number(imbalance * BigInt(1_000_000) / total) / 10_000;
});
export const tradeSnapshotSchema = z.object({
  schema: z.enum(['kraken-trades/1', 'kraken-trades/2']), selected_pairs: tradeSelectionSchema.optional(), venue: z.literal('Kraken'), coverage: z.literal('selected_usd_pairs_one_venue'), window_started_at: date, window_ended_at: date, fetched_at: date,
  window_ms: z.union([z.literal(60_000), z.literal(TRADE_WINDOW_MS)]), page_limit: z.literal(TRADE_PAGE_LIMIT).optional(), trade_limit: z.literal(TRADE_LIMIT), rows: z.array(row).max(MAX_SELECTED_TRADE_PAIRS), missing_pairs: z.array(z.string().regex(TRADE_PAIR_PATTERN)).max(MAX_SELECTED_TRADE_PAIRS), net_capital_flow: z.null(),
}).strict().refine(snapshot => {
  const start = Date.parse(snapshot.window_started_at), end = Date.parse(snapshot.window_ended_at), fetched = Date.parse(snapshot.fetched_at);
  if (end - start !== snapshot.window_ms || fetched < end || fetched - end > 12_000) return false;
  if ((snapshot.schema === 'kraken-trades/2') !== !!snapshot.selected_pairs) return false;
  const selected: readonly string[] = snapshot.selected_pairs ?? TRADE_PAIRS;
  const names = [...snapshot.rows.map(row => row.pair), ...snapshot.missing_pairs];
  if (names.length !== selected.length || new Set(names).size !== selected.length || names.some(name => !selected.includes(name)) || new Set(snapshot.rows.map(row => row.source_pair)).size !== snapshot.rows.length) return false;
  return snapshot.rows.every(row => {
    if ((row.page_count ?? 1) > (snapshot.page_limit ?? 1)) return false;
    const rowFetched = Date.parse(row.fetched_at);
    if (rowFetched < end || rowFetched > fetched) return false;
    if (row.first_trade_at === null) return true;
    const first = Date.parse(row.first_trade_at), last = Date.parse(row.last_trade_at!);
    return first >= start && first <= last && last < end;
  });
});
