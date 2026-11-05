/** Transport-independent public evidence contract and acquisition limits. */
import type {TradeTimeframe} from './selection';
import type {KrakenTradeSnapshot} from './trades';
export const REFRESH_MS=60_000, MAX_CACHE_AGE_MS=900_000;
export const MAX_PAIRS=2_000,MAX_SOURCE_PAIRS=10_000,UNIVERSE_REFRESH_MS=900_000;
export type KrakenPair={source_pair:string;pair:string;base:string;quote:'USD'};
export type KrakenUniverse={pairs:KrakenPair[];source_pair_count:number;fetched_at:string};
export type KrakenRow=KrakenPair&{last_price_usd:string;volume_base_24h:string;vwap_usd_24h:string;trades_24h:number;net_capital_flow:null;open_interest:null};
export type KrakenMissing={pair:string;reason:'missing_ticker'|'invalid_ticker'};
export type KrakenSnapshot={schema:'kraken-spot/2';venue:'Kraken';coverage:'online_usd_spot_pairs_one_venue';rows:KrakenRow[];missing:KrakenMissing[];universe_pair_count:number;catalog_pair_count:number;catalog_fetched_at:string;quality:'complete'|'partial';acquisition_started_at:string;fetched_at:string;source_observed_at:null;delay_status:'not_provided';window:'rolling_24h';monetary_encoding:'decimal_string'};
export type KrakenStatus={state:'available'|'stale'|'unavailable'|'denied';error_code:string|null;last_attempt_at:string|null;fetched_at:string|null;cache_age_ms:number|null;refresh_ms:number;max_cache_age_ms:number;next_retry_at:string|null};
export type KrakenReply={requested_pairs?:string[];requested_window?:TradeTimeframe;status:KrakenStatus;snapshot:KrakenSnapshot|null;trade_snapshot?:KrakenTradeSnapshot|null};
export type KrakenOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number};
export interface KrakenGate {inspect():Promise<'idle'|'busy'|'blocked'>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:KrakenOutcome):Promise<void>}

/** This error guarantees publication was rejected before any DB mutation. */
export class KrakenSnapshotValidationError extends Error{
 readonly code='snapshot_invalid';
 constructor(){super('snapshot_invalid');this.name='KrakenSnapshotValidationError';}
}
