/** Annual national market size/liquidity. Neither indicator measures net capital flow. */
import {z} from 'zod';
import geography from '../../components/atlas/countries.json';
export const INDICATORS={capitalization:'CM.MKT.LCAP.CD',traded_value:'CM.MKT.TRAD.CD'} as const;
export const SOURCE='https://data.worldbank.org/indicator/';
export const LICENSE='https://data.worldbank.org/summary-terms-of-use';
export const REFRESH_MS=86_400_000,MAX_CACHE_AGE_MS=7*REFRESH_MS;
export const countries=new Map(geography.map(c=>[c.iso3,{name:c.name,iso2:c.iso2}]));
const instant=z.string().datetime({offset:true});
export const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d);
const observation=z.object({year:z.number().int().min(1975).max(9999),usd:z.number().finite().nonnegative().max(1e15)}).strict();
const row=z.object({iso3:z.string().refine(code=>countries.has(code)),capitalization:observation.nullable(),traded_value:observation.nullable()}).strict().refine(r=>r.capitalization!==null||r.traded_value!==null);
export const snapshotSchema=z.object({
 schema:z.literal('worldbank-equity/1'),source:z.literal('World Bank / WFE'),license:z.literal('CC BY 4.0'),frequency:z.literal('annual'),unit:z.literal('current USD'),net_capital_flow:z.null(),
 window_start:z.number().int(),window_end:z.number().int(),dataset_updated:day,source_released_at:z.null(),acquisition_started_at:instant,fetched_at:instant,
 rows:z.array(row).min(1).max(249),
}).strict().refine(s=>{
 const started=Date.parse(s.acquisition_started_at),fetched=Date.parse(s.fetched_at);
 return fetched>=started&&s.window_end===new Date(started).getUTCFullYear()-1&&s.window_start===s.window_end-2&&
 Date.parse(s.dataset_updated)<=started&&new Set(s.rows.map(r=>r.iso3)).size===s.rows.length&&
 s.rows.every(r=>[r.capitalization,r.traded_value].every(o=>o===null||o.year>=s.window_start&&o.year<=s.window_end));
});
export type EquitySnapshot=z.infer<typeof snapshotSchema>;
export type EquityMetric=keyof typeof INDICATORS;
const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable()}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetched_at===r.status.fetched_at));
export type EquityReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:EquityReply|null,now:number){
 const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;
 const age=now-Date.parse(s.fetched_at);return age>=0&&age<=MAX_CACHE_AGE_MS?s:null;
}
