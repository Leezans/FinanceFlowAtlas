/** Untrusted browser/cache boundary, separate from acquisition and presentation. */
import {z} from 'zod';
import {TRADE_LIMIT, TRADE_PAIRS, TRADE_WINDOW_MS} from './trades';
const date = z.string().datetime({offset: true});
const amount = z.string().regex(/^(?:0|[1-9]\d{0,32})(?:\.\d{1,24})?$/);
const signed = z.string().regex(/^-?(?:0|[1-9]\d{0,32})(?:\.\d{1,24})?$/).refine(value => !/^-0(?:\.0+)?$/.test(value));
const toInteger = (value: string): bigint => {
  const negative = value.startsWith('-'), [whole, tail = ''] = value.replace(/^-/, '').split('.');
  return (negative ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * BigInt(10) ** BigInt(24) + BigInt(tail.padEnd(24, '0')));
};
const row = z.object({
  source_pair: z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}$/), pair: z.enum(TRADE_PAIRS), base: z.enum(['BTC', 'ETH', 'SOL']), quote: z.literal('USD'),
  coverage: z.enum(['uncapped_response', 'capped_response']), returned_count: z.number().int().min(0).max(TRADE_LIMIT), trade_count: z.number().int().min(0).max(TRADE_LIMIT), excluded_after_window_count: z.number().int().min(0).max(TRADE_LIMIT),
  first_trade_at: date.nullable(), last_trade_at: date.nullable(), fetched_at: date, cursor: z.string().regex(/^\d{1,24}$/),
  buy_notional_usd: amount.nullable(), sell_notional_usd: amount.nullable(), imbalance_usd: signed.nullable(), imbalance_pct: z.number().finite().min(-100).max(100).nullable(),
}).strict().refine(row => {
  if (row.pair !== `${row.base}/USD` || row.trade_count + row.excluded_after_window_count !== row.returned_count || (row.coverage === 'capped_response') !== (row.returned_count === TRADE_LIMIT)) return false;
  if ((row.trade_count === 0) !== (row.first_trade_at === null && row.last_trade_at === null) || row.trade_count > 0 && (row.first_trade_at === null || row.last_trade_at === null)) return false;
  if (row.coverage === 'capped_response') return row.buy_notional_usd === null && row.sell_notional_usd === null && row.imbalance_usd === null && row.imbalance_pct === null;
  if (row.buy_notional_usd === null || row.sell_notional_usd === null || row.imbalance_usd === null) return false;
  const buy = toInteger(row.buy_notional_usd), sell = toInteger(row.sell_notional_usd), imbalance = toInteger(row.imbalance_usd), total = buy + sell;
  if (buy - sell !== imbalance || (row.trade_count === 0) !== (total === BigInt(0))) return false;
  return total === BigInt(0) ? row.imbalance_pct === null : row.imbalance_pct === Number(imbalance * BigInt(1_000_000) / total) / 10_000;
});
export const tradeSnapshotSchema = z.object({
  schema: z.literal('kraken-trades/1'), venue: z.literal('Kraken'), coverage: z.literal('selected_usd_pairs_one_venue'), window_started_at: date, window_ended_at: date, fetched_at: date,
  window_ms: z.literal(TRADE_WINDOW_MS), trade_limit: z.literal(TRADE_LIMIT), rows: z.array(row).max(TRADE_PAIRS.length), missing_pairs: z.array(z.enum(TRADE_PAIRS)).max(TRADE_PAIRS.length), net_capital_flow: z.null(),
}).strict().refine(snapshot => {
  const start = Date.parse(snapshot.window_started_at), end = Date.parse(snapshot.window_ended_at), fetched = Date.parse(snapshot.fetched_at);
  if (end - start !== TRADE_WINDOW_MS || fetched < end || fetched - end > 12_000) return false;
  const names = [...snapshot.rows.map(row => row.pair), ...snapshot.missing_pairs];
  if (names.length !== TRADE_PAIRS.length || new Set(names).size !== TRADE_PAIRS.length || new Set(snapshot.rows.map(row => row.source_pair)).size !== snapshot.rows.length) return false;
  return snapshot.rows.every(row => {
    const rowFetched = Date.parse(row.fetched_at);
    if (rowFetched < end || rowFetched > fetched) return false;
    if (row.first_trade_at === null) return true;
    const first = Date.parse(row.first_trade_at), last = Date.parse(row.last_trade_at!);
    return first >= start && first <= last && last < end;
  });
});
