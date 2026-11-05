import {z} from 'zod';

export const ECB_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_INFO='https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';
export const ECB_RIGHTS='https://www.ecb.europa.eu/services/disclaimer/html/index.en.html';
export const CHECK_INTERVAL_MS=60*60_000;
export const RETRY_INTERVAL_MS=15*60_000;
export const MAX_SOURCE_BYTES=128*1024;
export const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const timestamp=z.string().datetime({offset:true});
const rate=z.object({currency:z.string().regex(/^[A-Z]{3}$/).refine(v=>v!=='EUR'),per_eur:z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(32).refine(v=>Number(v)>0&&Number.isFinite(Number(v)))}).strict();
export const fxSnapshotSchema=z.object({
 schema:z.literal('ecb-fx-reference/1'),concept:z.literal('exchange_rate_reference'),
 base_currency:z.literal('EUR'),reference_date:dateOnly,retrieved_at:timestamp,
 rates:z.array(rate).min(1).max(64),
}).strict().superRefine((v,ctx)=>{
 if(new Set(v.rates.map(r=>r.currency)).size!==v.rates.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate currency'});
 if(Number.isFinite(Date.parse(v.retrieved_at))&&v.reference_date>berlinDate(Date.parse(v.retrieved_at)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Future reference date'});
});
export type FxSnapshot=z.infer<typeof fxSnapshotSchema>;
export const fxErrorCode=z.enum(['network_error','source_unavailable','invalid_source','source_older','source_stopped','source_busy','source_cooldown','source_gate_unavailable']);
export type FxErrorCode=z.infer<typeof fxErrorCode>;
export const fxPayloadSchema=z.object({snapshot:fxSnapshotSchema.nullable(),source_state:z.enum(['available','stale','unavailable','stopped']),checked_at:timestamp.nullable(),next_check_at:timestamp.nullable(),error_code:fxErrorCode.nullable()}).strict().superRefine((v,ctx)=>{
 if((v.source_state==='available'||v.source_state==='stale')&&!v.snapshot||v.source_state==='available'&&v.error_code!==null||v.source_state==='stopped'&&(v.next_check_at!==null||v.snapshot!==null))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inconsistent source status'});
});
export type FxPayload=z.infer<typeof fxPayloadSchema>;
export function berlinDate(now:number){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(type=>parts.find(p=>p.type===type)?.value).join('-');
}
export function referenceAgeDays(date:string,now:number){return Math.max(0,Math.floor((Date.parse(berlinDate(now))-Date.parse(date))/86_400_000))}
/** A derived cross-rate, never a separately observed executable quote. */
export function crossRate(snapshot:FxSnapshot,from:string,to:string):number|null{
 const find=(code:string)=>code==='EUR'?1:Number(snapshot.rates.find(r=>r.currency===code)?.per_eur);
 const base=find(from),quote=find(to),value=quote/base;
 return base>0&&quote>0&&Number.isFinite(value)&&value>0?value:null;
}
