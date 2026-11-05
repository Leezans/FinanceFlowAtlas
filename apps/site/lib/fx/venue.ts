/** A narrow fiat projection of the existing Kraken evidence, not another feed. */
import type {KrakenSnapshot} from '../crypto/kraken';
import type {KrakenTradeSnapshot} from '../crypto/trades';

export const FX_VENUE_PAIRS = ['AUD/USD', 'EUR/USD', 'GBP/USD'] as const;
export type FxVenuePair = typeof FX_VENUE_PAIRS[number];
const SOURCE_PAIRS: Readonly<Record<FxVenuePair, string>> = {
  'AUD/USD': 'AUDUSD', 'EUR/USD': 'ZEURZUSD', 'GBP/USD': 'ZGBPZUSD',
};
export type FxVenueRow = {
  pair: FxVenuePair;
  base: 'AUD' | 'EUR' | 'GBP';
  quote: 'USD';
  rate: string;
  vwap_24h: string;
  volume_base_24h: string;
  trades_24h: number;
  /** Explicitly calculated comparison, not a daily or window return. */
  price_vwap_deviation_pct: number | null;
  source_observed_at: null;
  trade_evidence: {
    window_started_at: string;
    window_ended_at: string;
    first_execution_at: string | null;
    last_execution_at: string | null;
    count: number;
    coverage: 'uncapped_response' | 'capped_response';
  } | null;
};
export type FxVenueSnapshot = {
  venue: 'Kraken';
  scope: 'three_usd_quoted_fiat_spot_pairs';
  fetched_at: string;
  acquisition_started_at: string;
  catalog_fetched_at: string;
  rows: FxVenueRow[];
  missing: {pair: FxVenuePair; reason: 'not_in_online_catalog' | 'missing_ticker' | 'invalid_ticker' | 'identity_mismatch'}[];
  source_observed_at: null;
  source_delay_ms: null;
  net_capital_flow: null;
};

/** Input must first pass the common Kraken response validator/expiry boundary. */
export function projectFxVenue(snapshot: KrakenSnapshot | null, trades: KrakenTradeSnapshot | null = null): FxVenueSnapshot | null {
  if (!snapshot) return null;
  const rows: FxVenueRow[] = [], missing: FxVenueSnapshot['missing'] = [];
  const matchingTrades = trades?.fetched_at === snapshot.fetched_at && trades.window_ended_at === snapshot.acquisition_started_at &&
    JSON.stringify(trades.selected_pairs) === JSON.stringify(FX_VENUE_PAIRS) ? trades : null;
  for (const pair of FX_VENUE_PAIRS) {
    const quoted = snapshot.rows.find(row => row.pair === pair);
    if (!quoted) {
      missing.push({pair, reason: snapshot.missing.find(row => row.pair === pair)?.reason ?? 'not_in_online_catalog'});
      continue;
    }
    if (quoted.source_pair !== SOURCE_PAIRS[pair] || quoted.pair !== `${quoted.base}/USD` || quoted.quote !== 'USD') {
      missing.push({pair, reason: 'identity_mismatch'}); continue;
    }
    const value = (Number(quoted.last_price_usd) / Number(quoted.vwap_usd_24h) - 1) * 100;
    const execution = matchingTrades?.rows.find(row => row.pair === pair && row.source_pair === quoted.source_pair);
    rows.push({pair, base: quoted.base as FxVenueRow['base'], quote: 'USD', rate: quoted.last_price_usd,
      vwap_24h: quoted.vwap_usd_24h, volume_base_24h: quoted.volume_base_24h, trades_24h: quoted.trades_24h,
      price_vwap_deviation_pct: Number.isFinite(value) ? value : null, source_observed_at: null,
      trade_evidence: execution && matchingTrades ? {window_started_at: matchingTrades.window_started_at, window_ended_at: matchingTrades.window_ended_at,
        first_execution_at: execution.first_trade_at, last_execution_at: execution.last_trade_at,
        count: execution.trade_count, coverage: execution.coverage} : null});
  }
  return {venue: 'Kraken', scope: 'three_usd_quoted_fiat_spot_pairs', fetched_at: snapshot.fetched_at,
    acquisition_started_at: snapshot.acquisition_started_at, catalog_fetched_at: snapshot.catalog_fetched_at,
    rows, missing, source_observed_at: null, source_delay_ms: null, net_capital_flow: null};
}
