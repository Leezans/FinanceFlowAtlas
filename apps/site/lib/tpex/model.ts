/** TPEx OTC listed-company institutional trading, in shares. Never monetary flow. */
import {z} from 'zod';
export const FLOW_DATASET='https://data.gov.tw/dataset/11856';
export const COMPANY_DATASET='https://data.gov.tw/dataset/25036';
export const LICENSE='https://data.gov.tw/license';
export const REFRESH_MS=3_600_000,MAX_CACHE_AGE_MS=86_400_000,DAY_MS=86_400_000;
export const STALE_REPORT_DAYS=4,MAX_REPORT_AGE_DAYS=14;
export const PARTICIPANTS=[{id:'total',label:'三大法人合计'},{id:'foreign',label:'外资及陆资（不含外资自营商）'},{id:'trust',label:'投信'},{id:'dealer',label:'自营商'}] as const;
export type Participant=typeof PARTICIPANTS[number]['id'];
const count=z.number().int().safe().min(0).max(1_000_000_000_000);
const signed=z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d);
const instant=z.string().datetime({offset:true});
export const tradingSchema=z.object({buy:count,sell:count,net:signed}).strict().refine(v=>v.buy-v.sell===v.net);
export type Trading=z.infer<typeof tradingSchema>;
export const flowSchema=z.object({foreign:tradingSchema,trust:tradingSchema,dealer:tradingSchema,total:tradingSchema}).strict().refine(v=>v.foreign.buy+v.trust.buy+v.dealer.buy===v.total.buy&&v.foreign.sell+v.trust.sell+v.dealer.sell===v.total.sell);
export type Flow=z.infer<typeof flowSchema>;
const code=z.string().regex(/^[A-Z0-9]{4,8}$/);
const rowSchema=z.object({code,name:z.string().min(1).max(100),industry_code:z.string().regex(/^\d{2}$/),flow:flowSchema.nullable()}).strict();
export const snapshotSchema=z.object({schema:z.literal('tpex-institutional/1'),source:z.literal('TPEx'),market:z.literal('Taiwan_OTC_listed_companies'),unit:z.literal('shares'),report_date:day,classification_date:day,source_released_at:z.null(),acquisition_started_at:instant,fetched_at:instant,net_capital_flow:z.null(),source_security_count:count,excluded_security_count:count,rows:z.array(rowSchema).min(1).max(3000)}).strict().refine(s=>
 s.report_date===s.classification_date&&Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&s.report_date<=new Date(Date.parse(s.acquisition_started_at)+8*3_600_000).toISOString().slice(0,10)&&new Set(s.rows.map(r=>r.code)).size===s.rows.length&&s.rows.filter(r=>r.flow!==null).length+s.excluded_security_count===s.source_security_count&&s.rows.some(r=>r.flow!==null));
export type TpexSnapshot=z.infer<typeof snapshotSchema>;
const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable()}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetched_at===r.status.fetched_at));
export type TpexReply=z.infer<typeof replySchema>;
export function reportAge(snapshot:TpexSnapshot,now:number){return (now-(Date.parse(snapshot.report_date)-8*3_600_000))/DAY_MS;}
export function visibleSnapshot(reply:TpexReply|null,now:number):TpexSnapshot|null{const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;const age=now-Date.parse(s.fetched_at),days=reportAge(s,now);return age>=0&&age<=MAX_CACHE_AGE_MS&&days>=0&&days<=MAX_REPORT_AGE_DAYS?s:null;}
export function intensity(trading:Trading|null){return trading===null?null:trading.buy+trading.sell===0?0:trading.net/(trading.buy+trading.sell);}
