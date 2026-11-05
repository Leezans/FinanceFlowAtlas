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
export type TradeSelection = {pairs: readonly string[]; key: string; explicit: boolean};
export function readTradeSelection(url: URL, enabled: boolean): TradeSelection {
  const params = [...url.searchParams.entries()];
  if (params.length === 0) return {pairs: DEFAULT_TRADE_PAIRS, key: tradeSelectionKey(DEFAULT_TRADE_PAIRS), explicit: false};
  if (!enabled || params.length !== 1 || params[0][0] !== 'pairs' || params[0][1].length > 110) throw new Error('invalid_trade_selection');
  const pairs = canonicalTradeSelection(params[0][1].split(','));
  return {pairs, key: tradeSelectionKey(pairs), explicit: true};
}
