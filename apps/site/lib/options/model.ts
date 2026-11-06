import {z} from 'zod';

export const REFRESH_MS=60_000,MAX_CACHE_AGE_MS=300_000,METADATA_MAX_AGE_MS=86_400_000;
export const MAX_ROWS=2_000,MAX_BYTES=1_500_000;
const nonnegative=z.number().finite().min(0).max(1e15);
const timestamp=z.number().int().safe().min(0).max(8.64e15);
const instant=z.string().datetime({offset:true});
export const optionRowSchema=z.object({
 instrument:z.string().regex(/^BTC-[1-9]\d?[A-Z]{3}\d{2}-\d+(?:\.\d+)?-[CP]$/),
 expiration_timestamp:timestamp,strike:nonnegative.refine(n=>n>0),option_type:z.enum(['call','put']),contract_size:nonnegative.refine(n=>n>0),
 creation_timestamp:timestamp,mark_price:nonnegative,mark_iv:nonnegative,price_change:z.number().finite().min(-100).max(1e12).nullable(),
 bid_price:nonnegative.nullable(),ask_price:nonnegative.nullable(),last:nonnegative.nullable(),volume:nonnegative,volume_usd:nonnegative,open_interest:nonnegative,
}).strict().refine(r=>r.instrument.endsWith(r.option_type==='call'?'-C':'-P')&&r.expiration_timestamp>r.creation_timestamp&&
 (r.volume!==0||r.volume_usd===0),'option_identity');
export type OptionRow=z.infer<typeof optionRowSchema>;
export const snapshotSchema=z.object({
 schema:z.literal('deribit-btc-options/1'),source:z.literal('Deribit'),currency:z.literal('BTC'),coverage:z.literal('deribit_btc_options'),
 acquisition_started_at:instant,fetched_at:instant,source_as_of:instant,metadata_fetched_at:instant,
 net_capital_flow:z.null(),delay_policy:z.literal('source_delay_unconfirmed'),rows:z.array(optionRowSchema).min(1).max(MAX_ROWS),
}).strict().refine(s=>{
 const start=Date.parse(s.acquisition_started_at),end=Date.parse(s.fetched_at),asof=Date.parse(s.source_as_of),meta=Date.parse(s.metadata_fetched_at);
 return end>=start&&asof>=start-30_000&&asof<=end+5_000&&meta<=end&&meta>=start-METADATA_MAX_AGE_MS&&
 new Set(s.rows.map(r=>r.instrument)).size===s.rows.length&&s.rows.every(r=>r.creation_timestamp>=asof&&r.creation_timestamp<=asof+5_000);
});
export type OptionsSnapshot=z.infer<typeof snapshotSchema>;
export const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({snapshot:snapshotSchema.nullable(),status:statusSchema}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.status.fetched_at===r.snapshot.fetched_at));
export type OptionsReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:OptionsReply|null,now:number):OptionsSnapshot|null{
 const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;
 const fetchedAge=now-Date.parse(s.fetched_at),sourceAge=now-Date.parse(s.source_as_of);
 if(fetchedAge< -5_000||fetchedAge>MAX_CACHE_AGE_MS||sourceAge< -5_000||sourceAge>MAX_CACHE_AGE_MS)return null;
 const rows=s.rows.filter(r=>r.expiration_timestamp>now);return rows.length?{...s,rows}:null;
}
