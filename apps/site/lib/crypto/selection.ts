/** Small display-name selections, never source IDs, URLs or independent leases. */
export const DEFAULT_TRADE_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const;
export const MAX_SELECTED_TRADE_PAIRS = 3;
export const TRADE_PAIR_PATTERN = /^[A-Z0-9][A-Z0-9.]{0,31}\/USD$/;
export function canonicalTradeSelection(pairs: readonly string[]): string[] {
  if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > MAX_SELECTED_TRADE_PAIRS ||
      pairs.some(pair => typeof pair !== 'string' || !TRADE_PAIR_PATTERN.test(pair)) || new Set(pairs).size !== pairs.length) {
    throw new Error('invalid_trade_selection');
  }
  return [...pairs].sort();
}
export const tradeSelectionKey = (pairs: readonly string[]): string => canonicalTradeSelection(pairs).join(',');
export const DEFAULT_TRADE_TIMEFRAME = '5m';
export type TradeTimeframe = '1m' | '5m';
export const tradeWindowMilliseconds = (timeframe: TradeTimeframe): 60_000 | 300_000 => timeframe === '1m' ? 60_000 : 300_000;
export const tradeEvidenceKey = (pairs: readonly string[], timeframe: TradeTimeframe): string => `${timeframe}:${tradeSelectionKey(pairs)}`;
export type TradeSelection = {pairs: readonly string[]; key: string; explicit: boolean; timeframe: TradeTimeframe; windowExplicit: boolean};
export function readTradeSelection(url: URL, enabled: boolean): TradeSelection {
  const params = [...url.searchParams.entries()];
  if (params.some(([key]) => !['pairs', 'window'].includes(key)) || new Set(params.map(([key]) => key)).size !== params.length || !enabled && params.length > 0) throw new Error('invalid_trade_selection');
  const raw = url.searchParams.get('pairs'), window = url.searchParams.get('window');
  if (raw !== null && raw.length > 110 || window !== null && !['1m', '5m'].includes(window)) throw new Error('invalid_trade_selection');
  const pairs = raw === null ? DEFAULT_TRADE_PAIRS : canonicalTradeSelection(raw.split(','));
  const timeframe = (window ?? DEFAULT_TRADE_TIMEFRAME) as TradeTimeframe;
  return {pairs, key: tradeEvidenceKey(pairs, timeframe), explicit: raw !== null, timeframe, windowExplicit: window !== null};
}
