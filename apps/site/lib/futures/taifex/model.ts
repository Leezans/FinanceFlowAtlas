/** TAIFEX daily institutional futures contract notional, never capital flow. */
import {z} from 'zod';
import {PRODUCTS,PRODUCT_IDS} from './products';
export {PRODUCTS,type Product} from './products';

export const REFRESH_MS=3_600_000,MAX_CACHE_AGE_MS=86_400_000,MAX_BYTES=256_000;
export const MAX_REPORT_AGE_DAYS=14,STALE_REPORT_DAYS=4,MAX_SOURCE_PRODUCTS=100,MAX_SOURCE_ROWS=300;
const DAY_MS=86_400_000,TAIPEI_OFFSET_MS=8*3_600_000,CLOCK_SKEW_MS=5_000;
export const PARTICIPANTS=[{id:'dealer',label:'自營商'},{id:'trust',label:'投信'},{id:'foreign',label:'外資及陸資'}] as const;
export type Participant=typeof PARTICIPANTS[number]['id'];
const count=z.number().int().safe().nonnegative();
const signedCount=z.number().int().safe();
export const MAX_SOURCE_THOUSANDS=Math.floor(Number.MAX_SAFE_INTEGER/1000);
const amount=z.number().int().safe().min(0).max(MAX_SOURCE_THOUSANDS*1000).multipleOf(1000);
const signedAmount=z.number().int().safe().min(-MAX_SOURCE_THOUSANDS*1000).max(MAX_SOURCE_THOUSANDS*1000).multipleOf(1000);
const instant=z.string().datetime({offset:true});
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'invalid_calendar_date');
const productSchema=z.enum(PRODUCT_IDS);
const numericShape={
 buy_contracts:count,sell_contracts:count,net_contracts:signedCount,
 buy_amount:amount,sell_amount:amount,reported_net_amount:signedAmount,
 long_oi_contracts:count,short_oi_contracts:count,net_oi_contracts:signedCount,
 long_oi_amount:amount,short_oi_amount:amount,reported_net_oi_amount:signedAmount,
};
type NumericRow=z.infer<z.ZodObject<typeof numericShape>>;
const withinRounding=(long:number,short:number,net:number)=>{
 const difference=BigInt(long)-BigInt(short)-BigInt(net);
 return difference>=BigInt(-1000)&&difference<=BigInt(1000);
};
/** Only invoke on validated safe integers. Also used before unknown groups are excluded. */
export const balancesValid=(row:NumericRow)=>
 Object.values(row).filter(value=>typeof value==='number').every(Number.isSafeInteger)&&
 BigInt(row.buy_contracts)-BigInt(row.sell_contracts)===BigInt(row.net_contracts)&&
 BigInt(row.long_oi_contracts)-BigInt(row.short_oi_contracts)===BigInt(row.net_oi_contracts)&&
 (row.buy_contracts!==0||row.buy_amount===0)&&(row.sell_contracts!==0||row.sell_amount===0)&&
 (row.long_oi_contracts!==0||row.long_oi_amount===0)&&(row.short_oi_contracts!==0||row.short_oi_amount===0)&&
 withinRounding(row.buy_amount,row.sell_amount,row.reported_net_amount)&&
 withinRounding(row.long_oi_amount,row.short_oi_amount,row.reported_net_oi_amount);
export const rowSchema=z.object({
 id:z.string(),product:productSchema,participant:z.enum(['dealer','trust','foreign']),...numericShape,
}).strict().refine(row=>row.id===`${row.product}/${row.participant}`&&balancesValid(row),'row_identity_or_balance');
export type FuturesRow=z.infer<typeof rowSchema>;
const numericFields=Object.keys(numericShape) as (keyof NumericRow)[];
const totalsSafe=(rows:FuturesRow[])=>numericFields.every(field=>{
 if(rows.some(row=>!Number.isSafeInteger(row[field])))return false;
 const total=rows.reduce((sum,row)=>sum+BigInt(row[field]),BigInt(0)),limit=BigInt(Number.MAX_SAFE_INTEGER);
 return total>=-limit&&total<=limit;
});
function taipeiCalendarDay(now:number){return Math.floor((now+TAIPEI_OFFSET_MS)/DAY_MS);}
export const snapshotSchema=z.object({
 schema:z.literal('taifex-futures-institutions/1'),source:z.literal('TAIFEX'),currency:z.literal('TWD'),source_unit:z.literal('thousand_TWD'),frequency:z.literal('daily'),
 metric:z.literal('contract_notional_turnover'),report_date:day,source_released_at:z.null(),acquisition_started_at:instant,fetched_at:instant,net_capital_flow:z.null(),
 source_product_count:count.min(1).max(MAX_SOURCE_PRODUCTS),excluded_product_count:count.max(MAX_SOURCE_PRODUCTS-1),excluded_row_count:count.max(MAX_SOURCE_ROWS-3),
 covered_products:z.array(productSchema).min(1).max(PRODUCTS.length),rows:z.array(rowSchema).min(3).max(PRODUCTS.length*3),
}).strict().refine(snapshot=>{
 const started=Date.parse(snapshot.acquisition_started_at),fetched=Date.parse(snapshot.fetched_at);
 const reportDay=Date.parse(snapshot.report_date)/DAY_MS;
 return Number.isFinite(started)&&Number.isFinite(fetched)&&fetched>=started&&reportDay<=taipeiCalendarDay(started)&&
  new Set(snapshot.covered_products).size===snapshot.covered_products.length&&
  snapshot.source_product_count===snapshot.covered_products.length+snapshot.excluded_product_count&&
  snapshot.excluded_row_count===snapshot.excluded_product_count*PARTICIPANTS.length&&
  snapshot.rows.length===snapshot.covered_products.length*PARTICIPANTS.length&&
  new Set(snapshot.rows.map(row=>row.id)).size===snapshot.rows.length&&totalsSafe(snapshot.rows)&&
  snapshot.covered_products.every(product=>PARTICIPANTS.every(participant=>snapshot.rows.some(row=>row.id===`${product}/${participant.id}`)));
},'snapshot_coverage_or_timing');
export type FuturesSnapshot=z.infer<typeof snapshotSchema>;
export const statusSchema=z.object({
 state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),
 last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),
 refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable(),
}).strict();
export const replySchema=z.object({snapshot:snapshotSchema.nullable(),status:statusSchema}).strict().refine(reply=>
 (reply.status.state==='available'||reply.status.state==='stale')===!!reply.snapshot&&(!reply.snapshot||reply.status.fetched_at===reply.snapshot.fetched_at),
 'reply_snapshot_state');
export type FuturesReply=z.infer<typeof replySchema>;
/** Integer Taiwan calendar days. No inferred exchange/holiday calendar. */
export function reportAge(snapshot:FuturesSnapshot,now:number){return taipeiCalendarDay(now)-Date.parse(snapshot.report_date)/DAY_MS;}
export function visibleSnapshot(reply:FuturesReply|null,now:number):FuturesSnapshot|null{
 const snapshot=reply?.snapshot;
 if(!snapshot||!['available','stale'].includes(reply.status.state)||!Number.isFinite(now))return null;
 const cacheAge=now-Date.parse(snapshot.fetched_at),days=reportAge(snapshot,now);
 return cacheAge>=-CLOCK_SKEW_MS&&cacheAge<=MAX_CACHE_AGE_MS&&days>=0&&days<=MAX_REPORT_AGE_DAYS?snapshot:null;
}
