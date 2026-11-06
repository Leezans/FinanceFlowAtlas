import {z} from 'zod';

export const REFRESH_MS=60_000,MAX_CACHE_AGE_MS=300_000,METADATA_MAX_AGE_MS=86_400_000;
/** Per-response bounds remain unchanged. Only the combined stored snapshot has a larger limit. */
export const MAX_ROWS=2_000,MAX_BYTES=1_500_000,MAX_CACHE_BYTES=3_000_000;
export const OPTION_CURRENCIES=['BTC','ETH'] as const;
export type OptionCurrency=typeof OPTION_CURRENCIES[number];
const currencySchema=z.enum(OPTION_CURRENCIES);
const nonnegative=z.number().finite().min(0).max(1e15);
const timestamp=z.number().int().safe().min(0).max(8.64e15);
const instant=z.string().datetime({offset:true});
const rowFields={
 expiration_timestamp:timestamp,strike:nonnegative.refine(n=>n>0),option_type:z.enum(['call','put']),contract_size:nonnegative.refine(n=>n>0),
 creation_timestamp:timestamp,mark_price:nonnegative,mark_iv:nonnegative,price_change:z.number().finite().min(-100).max(1e12).nullable(),
 bid_price:nonnegative.nullable(),ask_price:nonnegative.nullable(),last:nonnegative.nullable(),volume:nonnegative,volume_usd:nonnegative,open_interest:nonnegative,
};
const rowIdentity=(r:{instrument:string;option_type:string;expiration_timestamp:number;creation_timestamp:number;volume:number;volume_usd:number})=>
 r.instrument.endsWith(r.option_type==='call'?'-C':'-P')&&r.expiration_timestamp>r.creation_timestamp&&(r.volume!==0||r.volume_usd===0);
export const optionRowSchema=z.object({
 instrument:z.string().regex(/^(BTC|ETH)-[1-9]\d?[A-Z]{3}\d{2}-\d+(?:\.\d+)?-[CP]$/),
 underlying_currency:currencySchema,...rowFields,
}).strict().refine(r=>r.instrument.startsWith(`${r.underlying_currency}-`)&&rowIdentity(r),'option_identity');
export type OptionRow=z.infer<typeof optionRowSchema>;
const commonFields={
 source:z.literal('Deribit'),acquisition_started_at:instant,fetched_at:instant,source_as_of:instant,
 net_capital_flow:z.null(),delay_policy:z.literal('source_delay_unconfirmed'),
};
export function coverageForCurrencies(currencies:readonly OptionCurrency[]){
 return currencies.length===2?'deribit_btc_eth_options':currencies[0]==='ETH'?'deribit_eth_options':'deribit_btc_options';
}
const metadataClocks=z.object({BTC:instant.optional(),ETH:instant.optional()}).strict();
const unifiedSnapshotSchema=z.object({
 schema:z.literal('deribit-options/2'),...commonFields,currencies:z.array(currencySchema).min(1).max(2),
 coverage:z.enum(['deribit_btc_options','deribit_eth_options','deribit_btc_eth_options']),
 metadata_fetched_at:metadataClocks,rows:z.array(optionRowSchema).min(1).max(2*MAX_ROWS),
}).strict().refine(s=>{
 const start=Date.parse(s.acquisition_started_at),end=Date.parse(s.fetched_at),asof=Date.parse(s.source_as_of);
 const canonical=OPTION_CURRENCIES.filter(currency=>s.currencies.includes(currency));
 const metaKeys=Object.keys(s.metadata_fetched_at);
 return end>=start&&asof>=start-30_000&&asof<=end+5_000&&
  canonical.join(',')===s.currencies.join(',')&&s.coverage===coverageForCurrencies(s.currencies)&&
  metaKeys.length===canonical.length&&metaKeys.every(currency=>canonical.includes(currency as OptionCurrency))&&
  canonical.every(currency=>{
   const meta=Date.parse(s.metadata_fetched_at[currency]??'');
   const count=s.rows.filter(row=>row.underlying_currency===currency).length;
   return meta<=end&&meta>=start-METADATA_MAX_AGE_MS&&count>=1&&count<=MAX_ROWS;
  })&&s.rows.every(row=>canonical.includes(row.underlying_currency))&&
  new Set(s.rows.map(row=>row.instrument)).size===s.rows.length&&
  // A normalized legacy BTC snapshot must survive API/cache revalidation without
  // changing its source clock. Newly acquired ETH/combined evidence uses exact min.
  (s.currencies.length===1&&s.currencies[0]==='BTC'||asof===Math.min(...s.rows.map(row=>row.creation_timestamp)))&&
  s.rows.every(row=>row.creation_timestamp>=asof&&row.creation_timestamp<=asof+5_000);
},'snapshot_identity_or_timing');
export type OptionsSnapshot=z.infer<typeof unifiedSnapshotSchema>;

// Exact schema-1 reader only. Preserve old BTC evidence and its original clocks;
// do not reset the shared gate, refresh evidence, or imply ETH was acquired.
const legacyRowSchema=z.object({
 instrument:z.string().regex(/^BTC-[1-9]\d?[A-Z]{3}\d{2}-\d+(?:\.\d+)?-[CP]$/),...rowFields,
}).strict().refine(rowIdentity,'option_identity');
const legacySnapshotSchema=z.object({
 schema:z.literal('deribit-btc-options/1'),...commonFields,currency:z.literal('BTC'),coverage:z.literal('deribit_btc_options'),
 metadata_fetched_at:instant,rows:z.array(legacyRowSchema).min(1).max(MAX_ROWS),
}).strict().refine(s=>{
 const start=Date.parse(s.acquisition_started_at),end=Date.parse(s.fetched_at),asof=Date.parse(s.source_as_of),meta=Date.parse(s.metadata_fetched_at);
 return end>=start&&asof>=start-30_000&&asof<=end+5_000&&meta<=end&&meta>=start-METADATA_MAX_AGE_MS&&
  new Set(s.rows.map(r=>r.instrument)).size===s.rows.length&&s.rows.every(r=>r.creation_timestamp>=asof&&r.creation_timestamp<=asof+5_000);
}).transform((s):OptionsSnapshot=>({
 schema:'deribit-options/2',source:s.source,currencies:['BTC'],coverage:s.coverage,
 acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at,source_as_of:s.source_as_of,
 metadata_fetched_at:{BTC:s.metadata_fetched_at},net_capital_flow:s.net_capital_flow,delay_policy:s.delay_policy,
 rows:s.rows.map(row=>({...row,underlying_currency:'BTC'})),
}));
export const snapshotSchema=z.union([unifiedSnapshotSchema,legacySnapshotSchema]);
export const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({snapshot:snapshotSchema.nullable(),status:statusSchema}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.status.fetched_at===r.snapshot.fetched_at));
export type OptionsReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:OptionsReply|null,now:number):OptionsSnapshot|null{
 const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;
 const fetchedAge=now-Date.parse(s.fetched_at),sourceAge=now-Date.parse(s.source_as_of);
 if(fetchedAge< -5_000||fetchedAge>MAX_CACHE_AGE_MS||sourceAge< -5_000||sourceAge>MAX_CACHE_AGE_MS)return null;
 const rows=s.rows.filter(r=>r.expiration_timestamp>now);return rows.length?{...s,rows}:null;
}
