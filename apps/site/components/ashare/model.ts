import {z} from 'zod';
const number=z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const rawNumber=z.union([number,z.null(),z.literal('-'),z.literal('--'),z.literal('')]);
export const numericFields=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'] as const;
const raw=z.object({f12:z.string().min(1),f14:z.string().trim().min(1),f2:rawNumber,f3:rawNumber,f62:rawNumber,f184:rawNumber,f66:rawNumber,f69:rawNumber,f72:rawNumber,f75:rawNumber,f78:rawNumber,f81:rawNumber,f84:rawNumber,f87:rawNumber}).passthrough();
export const scopeSchema=z.object({kind:z.enum(['industry_rank','industry_stocks']),fs:z.string(),classification_level:z.enum(['eastmoney_level_1','eastmoney_level_2','eastmoney_level_3','unknown_may_mix_levels'])}).strict();
const schema=z.object({schema:z.literal('ashare-provider-evidence/1'),rows:z.array(raw),source_total:z.number().int().nonnegative(),fetched_at:z.string().datetime({offset:true}),scope:scopeSchema,page_count:z.number().int().min(1),source_observed_at:z.null(),trade_date:z.null(),metric_kind:z.literal('provider_order_flow_proxy'),metric_field:z.literal('f62'),unit:z.literal('CNY'),field_units:z.object({f62:z.literal('CNY'),f3:z.literal('percent'),f2:z.literal('CNY')}).strict(),delay_status:z.literal('not_provided'),classification_exclusivity:z.literal('not_established'),notice:z.string().min(1),stale:z.boolean(),has_error:z.boolean()}).strict();
export type EvidenceSnapshot=z.infer<typeof schema>;
export type Scope=z.infer<typeof scopeSchema>;
export type EvidenceRow=EvidenceSnapshot['rows'][number];
declare const verified:unique symbol;
export type ValidEvidence=EvidenceSnapshot&{readonly [verified]:true};
export const numeric=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
export const scopeKey=(scope:Scope)=>JSON.stringify([scope.kind,scope.fs,scope.classification_level]);
export function validateEvidence(input:unknown,expectedScope?:Scope):ValidEvidence{
 const s=schema.parse(input);const levels:Record<string,string>={'m:90+s:2+f:!50':'eastmoney_level_1','m:90+s:4+f:!50':'eastmoney_level_2','m:90+s:8+f:!50':'eastmoney_level_3'};
 if(s.scope.kind==='industry_rank'){if(!levels[s.scope.fs]||s.scope.classification_level!==levels[s.scope.fs])throw new Error('行业层级混合或scope不匹配：拒绝聚合树图')}else if(!/^b:BK\d+$/.test(s.scope.fs)||s.scope.classification_level!=='unknown_may_mix_levels')throw new Error('Unsupported stock scope');
 if(expectedScope&&scopeKey(s.scope)!==scopeKey(expectedScope))throw new Error('Returned scope differs from requested scope');
 if(s.source_total!==s.rows.length)throw new Error('Incomplete source pagination');
 const seen=new Set<string>();for(const row of s.rows){if(!(s.scope.kind==='industry_rank'?/^BK\d+$/:/^\d{6}$/).test(row.f12)||seen.has(row.f12))throw new Error('Invalid or duplicate provider code');seen.add(row.f12);if(numeric(row.f2)!==null&&Number(row.f2)<0||numeric(row.f3)!==null&&Number(row.f3)< -100)throw new Error('Invalid price or return')}
 return s as ValidEvidence;
}
export function coverage(snapshot:ValidEvidence){const nonzero=snapshot.rows.filter(r=>numeric(r.f62)!==null&&r.f62!==0),zero=snapshot.rows.filter(r=>r.f62===0),missing=snapshot.rows.filter(r=>numeric(r.f62)===null);return {nonzero,zero,missing,denominator:nonzero.reduce((sum,r)=>sum+Math.abs(Number(r.f62)),0)}}
export function signedCny(value:number|null){return value===null?'未提供':`${value>0?'+':''}${new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(value)} CNY`}
