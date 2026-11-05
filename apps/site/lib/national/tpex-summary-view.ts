/** Browser-safe validation and presentation; no provider transport or cache code. */
import {z} from 'zod';
import type {MatrixGroup} from '@/lib/matrix/model';
import {tpexSummarySnapshotSchema, type TpexSummarySnapshot, type TpexSummaryParticipant} from './tpex-summary';

import {TPEX_SUMMARY_REFRESH_MS as SUMMARY_REFRESH_MS,TPEX_SUMMARY_CACHE_AGE_MS as SUMMARY_CACHE_AGE_MS,TPEX_SUMMARY_MAX_REPORT_DAYS,tpexSummaryReportAge as summaryReportAge} from './tpex-summary-policy';
export {SUMMARY_REFRESH_MS,SUMMARY_CACHE_AGE_MS,summaryReportAge};
const instant = z.string().datetime({offset:true});
export const summaryReplySchema = z.object({
  status:z.object({
    state:z.enum(['available','stale','unavailable','denied']), error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),
    last_attempt_at:instant.nullable(), fetched_at:instant.nullable(), cache_age_ms:z.number().finite().nullable(),
    report_age_days:z.number().finite().nullable(), refresh_ms:z.literal(SUMMARY_REFRESH_MS), max_cache_age_ms:z.literal(SUMMARY_CACHE_AGE_MS), next_retry_at:instant.nullable(),
  }).strict(), snapshot:tpexSummarySnapshotSchema.nullable(),
}).strict().refine(reply => ['available','stale'].includes(reply.status.state) === !!reply.snapshot
  && (!reply.snapshot || reply.snapshot.fetched_at === reply.status.fetched_at));
export type SummaryReply = z.infer<typeof summaryReplySchema>;
export function visibleSummary(reply:SummaryReply|null, now:number) {
  const snapshot = reply?.snapshot;
  if (!snapshot || !['available','stale'].includes(reply!.status.state)) return null;
  const age = now - Date.parse(snapshot.fetched_at), days = summaryReportAge(snapshot,now);
  return age >= 0 && age <= SUMMARY_CACHE_AGE_MS && days >= 0 && days <= TPEX_SUMMARY_MAX_REPORT_DAYS ? snapshot : null;
}
export const participantLabels:Record<TpexSummaryParticipant,string> = {foreign:'外资及陆资（不含自营商）',trust:'投信',dealer:'自营商',total:'三大法人合计'};
export const summaryMoney = (value:number) => `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN')} TWD`;
export function summaryGroups(snapshot:TpexSummarySnapshot|null):MatrixGroup[] {
  if (!snapshot) return [];
  return [{id:'TWN-OTC',label:'台湾上柜市场 · 官方法人分类（非行业）',items:snapshot.participants.filter(row=>row.id!=='total').map(row=>({
    id:row.id,label:participantLabels[row.id],displayValue:summaryMoney(row.net),colorValue:row.net,
    detail:`${snapshot.report_date} · 买进 ${row.buy.toLocaleString('zh-CN')} / 卖出 ${row.sell.toLocaleString('zh-CN')} TWD`,
    amount:{value:row.net,currency:'TWD',comparisonKey:`tpex-institutional-money:${snapshot.report_date}`},
  }))}];
}
