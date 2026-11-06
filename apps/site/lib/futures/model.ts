/** Official Legacy Futures Only. Contracts are never converted into dollars or flows. */
import {z} from 'zod';
export const CFTC_DATASET='https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy-Futures-Only/6dca-aqww';
export const CFTC_SCHEDULE='https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm';
export const REFRESH_MS=3_600_000,MAX_CACHE_AGE_MS=86_400_000,DAY_MS=86_400_000;
export const STALE_REPORT_DAYS=10,MAX_REPORT_AGE_DAYS=35;
export {CONTRACTS,FUTURES_CATEGORIES,LEGACY_CONTRACT_CODES} from './contracts';
import {CONTRACTS,LEGACY_CONTRACT_CODES} from './contracts';
export const MAX_SOURCE_ROWS=CONTRACTS.length*4,MAX_SOURCE_BYTES=262_144,MAX_SNAPSHOT_BYTES=65_536;
const count=z.number().int().safe().min(0).max(1_000_000_000);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d);
const instant=z.string().datetime({offset:true});
export const positionSchema=z.object({date:day,open_interest:count.refine(n=>n>0),noncommercial_long:count,noncommercial_short:count,spreading:count,commercial_long:count,commercial_short:count,nonreportable_long:count,nonreportable_short:count}).strict().refine(p=>
 p.noncommercial_long+p.spreading+p.commercial_long+p.nonreportable_long===p.open_interest&&
 p.noncommercial_short+p.spreading+p.commercial_short+p.nonreportable_short===p.open_interest,'open_interest_balance');
export type Position=z.infer<typeof positionSchema>;
const rowSchema=z.object({code:z.enum(CONTRACTS.map(c=>c.code) as [string,...string[]]),market_name:z.string(),contract_units:z.string(),current:positionSchema,previous:positionSchema}).strict().refine(row=>{
 const contract=CONTRACTS.find(c=>c.code===row.code);
 return !!contract&&contract.name===row.market_name&&contract.units===row.contract_units&&row.current.date>row.previous.date;
});
const commonShape={source:z.literal('CFTC'),dataset:z.literal('6dca-aqww'),report_type:z.literal('futures_only'),unit:z.literal('contracts'),source_released_at:z.null(),acquisition_started_at:instant,fetched_at:instant,net_capital_flow:z.null()};
const clocks=(s:{fetched_at:string;acquisition_started_at:string;rows:{current:Position}[]})=>
 Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&new Set(s.rows.map(r=>r.current.date)).size===1&&
 s.rows.every(r=>Date.parse(r.current.date)<=Date.parse(s.acquisition_started_at));
/** Legacy reports retain their original four-market coverage and clocks. */
export const legacySnapshotSchema=z.object({...commonShape,schema:z.literal('cftc-legacy-futures/1'),coverage:z.literal('four_selected_us_cftc_futures_markets'),rows:z.array(rowSchema).length(4)}).strict().refine(s=>
 clocks(s)&&new Set(s.rows.map(r=>r.code)).size===4&&s.rows.every(r=>LEGACY_CONTRACT_CODES.some(code=>code===r.code)));
/** Every reviewed market and both common report periods are required, atomically. */
export const currentSnapshotSchema=z.object({...commonShape,schema:z.literal('cftc-legacy-futures/2'),coverage:z.literal('fifty_two_selected_us_cftc_futures_markets'),rows:z.array(rowSchema).length(CONTRACTS.length)}).strict().refine(s=>
 clocks(s)&&new Set(s.rows.map(r=>r.code)).size===CONTRACTS.length&&new Set(s.rows.map(r=>r.previous.date)).size===1);
export const snapshotSchema=z.union([currentSnapshotSchema,legacySnapshotSchema]);
export type CftcSnapshot=z.infer<typeof snapshotSchema>;
const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable()}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetched_at===r.status.fetched_at));
export type CftcReply=z.infer<typeof replySchema>;
export type CftcStatus=z.infer<typeof statusSchema>;
export function reportAge(snapshot:CftcSnapshot,now:number){return (now-Date.parse(snapshot.rows[0].current.date))/DAY_MS;}
export function visibleSnapshot(reply:CftcReply|null,now:number):CftcSnapshot|null{
 const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;
 const age=now-Date.parse(s.fetched_at),days=reportAge(s,now);
 return age>=0&&age<=MAX_CACHE_AGE_MS&&days>=0&&days<=MAX_REPORT_AGE_DAYS?s:null;
}
export function net(position:Position,group:'noncommercial'|'commercial'|'nonreportable'='noncommercial'){return position[`${group}_long`]-position[`${group}_short`];}
