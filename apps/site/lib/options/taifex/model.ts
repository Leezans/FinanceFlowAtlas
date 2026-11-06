/** TAIFEX daily institutional option premium-trading evidence, never capital flow. */
import {z} from 'zod';

export const REFRESH_MS=3_600_000,MAX_CACHE_AGE_MS=86_400_000,MAX_BYTES=256_000;
export const MAX_REPORT_AGE_DAYS=14,STALE_REPORT_DAYS=4;
const DAY_MS=86_400_000,TAIPEI_OFFSET_MS=8*3_600_000,CLOCK_SKEW_MS=5_000;
export const PRODUCTS=[
 {id:'txo',label:'臺指選擇權'}, {id:'teo',label:'電子選擇權'}, {id:'tfo',label:'金融選擇權'},
 {id:'equity',label:'股票選擇權'}, {id:'etf',label:'ETF選擇權'},
] as const;
export const PARTICIPANTS=[{id:'dealer',label:'自營商'},{id:'trust',label:'投信'},{id:'foreign',label:'外資及陸資'}] as const;
export type Product=typeof PRODUCTS[number]['id'];
export type Participant=typeof PARTICIPANTS[number]['id'];
export type OptionType='call'|'put';
const count=z.number().int().safe().nonnegative();
const signedCount=z.number().int().safe();
// Source monetary values are whole thousands of TWD, never fractional currency.
export const MAX_SOURCE_THOUSANDS=Math.floor(Number.MAX_SAFE_INTEGER/1000);
const amount=z.number().int().safe().min(0).max(MAX_SOURCE_THOUSANDS*1000).multipleOf(1000);
const signedAmount=z.number().int().safe().min(-MAX_SOURCE_THOUSANDS*1000).max(MAX_SOURCE_THOUSANDS*1000).multipleOf(1000);
const instant=z.string().datetime({offset:true});
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'invalid_calendar_date');
export const rowSchema=z.object({
 id:z.string(),product:z.enum(['txo','teo','tfo','equity','etf']),option_type:z.enum(['call','put']),participant:z.enum(['dealer','trust','foreign']),
 buy_contracts:count,sell_contracts:count,net_contracts:signedCount,
 buy_amount:amount,sell_amount:amount,reported_net_amount:signedAmount,
 long_oi_contracts:count,short_oi_contracts:count,net_oi_contracts:signedCount,
 long_oi_amount:amount,short_oi_amount:amount,reported_net_oi_amount:signedAmount,
}).strict().refine(row=>
 row.id===`${row.product}/${row.option_type}/${row.participant}`&&
 row.buy_contracts-row.sell_contracts===row.net_contracts&&row.long_oi_contracts-row.short_oi_contracts===row.net_oi_contracts&&
 // No contracts means no premium amount for that side. The reverse is not
 // required: a small positive count can round to zero source thousands.
 (row.buy_contracts!==0||row.buy_amount===0)&&(row.sell_contracts!==0||row.sell_amount===0)&&
 (row.long_oi_contracts!==0||row.long_oi_amount===0)&&(row.short_oi_contracts!==0||row.short_oi_amount===0)&&
 // Separately rounded source columns can differ by one thousand TWD. Preserve
 // the published net columns instead of silently recomputing them.
 Math.abs(row.buy_amount-row.sell_amount-row.reported_net_amount)<=1000&&
 Math.abs(row.long_oi_amount-row.short_oi_amount-row.reported_net_oi_amount)<=1000,
 'row_identity_or_balance');
export type TaifexRow=z.infer<typeof rowSchema>;
const monetaryFields=['buy_amount','sell_amount','reported_net_amount','long_oi_amount','short_oi_amount','reported_net_oi_amount'] as const;
const monetaryTotalsSafe=(rows:TaifexRow[])=>monetaryFields.every(field=>{
 // Exact aggregation also bounds the matrix's monetary denominator. Signed
 // source nets are checked, never presented as synthetic capital flow.
 if(rows.some(row=>!Number.isSafeInteger(row[field])))return false;
 const total=rows.reduce((sum,row)=>sum+BigInt(row[field]),BigInt(0)),limit=BigInt(Number.MAX_SAFE_INTEGER);
 return total>=-limit&&total<=limit;
});
function taipeiCalendarDay(now:number){return Math.floor((now+TAIPEI_OFFSET_MS)/DAY_MS);}
export const snapshotSchema=z.object({
 schema:z.literal('taifex-options-institutions/1'),source:z.literal('TAIFEX'),currency:z.literal('TWD'),source_unit:z.literal('thousand_TWD'),frequency:z.literal('daily'),
 report_date:day,source_released_at:z.null(),acquisition_started_at:instant,fetched_at:instant,net_capital_flow:z.null(),rows:z.array(rowSchema).length(30),
}).strict().refine(snapshot=>{
 const started=Date.parse(snapshot.acquisition_started_at),fetched=Date.parse(snapshot.fetched_at);
 const reportDay=Date.parse(snapshot.report_date)/DAY_MS;
 return Number.isFinite(started)&&Number.isFinite(fetched)&&fetched>=started&&reportDay<=taipeiCalendarDay(started)&&
  new Set(snapshot.rows.map(row=>row.id)).size===30&&monetaryTotalsSafe(snapshot.rows)&&
  PRODUCTS.every(product=>['call','put'].every(type=>PARTICIPANTS.every(participant=>snapshot.rows.some(row=>row.id===`${product.id}/${type}/${participant.id}`))));
},'snapshot_coverage_or_timing');
export type TaifexSnapshot=z.infer<typeof snapshotSchema>;
export const statusSchema=z.object({
 state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),
 last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),
 refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable(),
}).strict();
export const replySchema=z.object({snapshot:snapshotSchema.nullable(),status:statusSchema}).strict().refine(reply=>
 (reply.status.state==='available'||reply.status.state==='stale')===!!reply.snapshot&&(!reply.snapshot||reply.status.fetched_at===reply.snapshot.fetched_at),
 'reply_snapshot_state');
export type TaifexReply=z.infer<typeof replySchema>;
/** Integer Taiwan calendar days. No inferred exchange/holiday calendar. */
export function reportAge(snapshot:TaifexSnapshot,now:number){return taipeiCalendarDay(now)-Date.parse(snapshot.report_date)/DAY_MS;}
export function visibleSnapshot(reply:TaifexReply|null,now:number):TaifexSnapshot|null{
 const snapshot=reply?.snapshot;
 if(!snapshot||!['available','stale'].includes(reply.status.state)||!Number.isFinite(now))return null;
 const cacheAge=now-Date.parse(snapshot.fetched_at),days=reportAge(snapshot,now);
 return cacheAge>=-CLOCK_SKEW_MS&&cacheAge<=MAX_CACHE_AGE_MS&&days>=0&&days<=MAX_REPORT_AGE_DAYS?snapshot:null;
}
