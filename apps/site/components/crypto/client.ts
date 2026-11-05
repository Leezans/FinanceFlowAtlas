import {MAX_CACHE_AGE_MS,REFRESH_MS,MAX_PAIRS,MAX_SOURCE_PAIRS,UNIVERSE_REFRESH_MS,type KrakenReply,type KrakenSnapshot} from '@/lib/crypto/kraken';
import {z} from 'zod';
import {tradeSnapshotSchema} from '@/lib/crypto/trade-validation';
const date=z.string().datetime({offset:true});
const decimal=z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/);
const positive=decimal.refine(value=>/[1-9]/.test(value));
const code=z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}$/);
const pair=z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}\/USD$/);
const rowSchema=z.object({source_pair:code,pair,base:code,quote:z.literal('USD'),last_price_usd:positive,volume_base_24h:decimal,vwap_usd_24h:positive,trades_24h:z.number().int().safe().nonnegative(),net_capital_flow:z.null(),open_interest:z.null()}).strict();
const snapshotSchema=z.object({schema:z.literal('kraken-spot/2'),venue:z.literal('Kraken'),coverage:z.literal('online_usd_spot_pairs_one_venue'),rows:z.array(rowSchema).min(1).max(MAX_PAIRS),missing:z.array(z.object({pair,reason:z.enum(['missing_ticker','invalid_ticker'])}).strict()).max(MAX_PAIRS),universe_pair_count:z.number().int().min(1).max(MAX_PAIRS),catalog_pair_count:z.number().int().min(1).max(MAX_SOURCE_PAIRS),catalog_fetched_at:date,quality:z.enum(['complete','partial']),acquisition_started_at:date,fetched_at:date,source_observed_at:z.null(),delay_status:z.literal('not_provided'),window:z.literal('rolling_24h'),monetary_encoding:z.literal('decimal_string')}).strict().refine(snapshot=>
 Date.parse(snapshot.fetched_at)>=Date.parse(snapshot.acquisition_started_at)&&Date.parse(snapshot.catalog_fetched_at)<=Date.parse(snapshot.fetched_at)&&Date.parse(snapshot.fetched_at)-Date.parse(snapshot.catalog_fetched_at)<=UNIVERSE_REFRESH_MS+12_000&&
 snapshot.rows.length+snapshot.missing.length===snapshot.universe_pair_count&&snapshot.catalog_pair_count>=snapshot.universe_pair_count&&
 new Set([...snapshot.rows,...snapshot.missing].map(row=>row.pair)).size===snapshot.universe_pair_count&&new Set(snapshot.rows.map(row=>row.source_pair)).size===snapshot.rows.length&&
 snapshot.rows.every(row=>row.pair===`${row.base}/USD`)&&(snapshot.quality==='partial')===(snapshot.missing.length>0));
const replySchema=z.object({trade_snapshot:tradeSnapshotSchema.nullable().optional(),snapshot:snapshotSchema.nullable(),status:z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:date.nullable(),fetched_at:date.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:date.nullable()}).strict()}).strict().refine(reply=>
 (reply.status.state==='available'||reply.status.state==='stale')===!!reply.snapshot&&(!reply.snapshot||reply.snapshot.fetched_at===reply.status.fetched_at)&&(!reply.trade_snapshot||!!reply.snapshot&&reply.trade_snapshot.fetched_at===reply.snapshot.fetched_at&&reply.trade_snapshot.window_ended_at===reply.snapshot.acquisition_started_at)).refine(reply=>{
 const quotes=reply.snapshot,trades=reply.trade_snapshot;if(!trades)return true;if(!quotes)return false;
 const catalogPairs=new Set([...quotes.rows,...quotes.missing].map(row=>row.pair));
 return trades.rows.every(row=>{
  const quoted=quotes.rows.find(quote=>quote.pair===row.pair);
  return catalogPairs.has(row.pair)&&(!quoted||quoted.source_pair===row.source_pair);
 })&&trades.missing_pairs.every(pair=>!catalogPairs.has(pair));
});
export function validateKrakenReply(value:unknown):KrakenReply{return replySchema.parse(value);}

export function visibleSnapshot(reply:KrakenReply|null,now:number):KrakenSnapshot|null{
 const snapshot=reply?.snapshot;if(!snapshot||reply.status.state==='denied'||reply.status.state==='unavailable')return null;
 const age=now-Date.parse(snapshot.fetched_at);return Number.isFinite(age)&&age>=0&&age<=MAX_CACHE_AGE_MS?snapshot:null;
}
