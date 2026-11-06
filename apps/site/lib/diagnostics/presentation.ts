import {z} from 'zod';

/** Fixed UI labels only. Never render upstream errors, payloads or internal IDs. */
export const diagnosticViews = [
  {source: 'eastmoney', view: 'level1_only', name: 'A 股 · Eastmoney', scope: '仅一级行业缓存，不涵盖全部个股'},
  {source: 'kraken', view: 'latest_reference_only', name: '加密 / 外汇 · Kraken', scope: '仅最近快照引用，不涵盖全部交易对和窗口'},
  {source: 'ecb', view: 'daily_reference', name: '外汇 · ECB', scope: '每日参考汇率，非日内行情'},
  {source: 'aseanstats', view: 'default', name: '东盟 · ASEANstats', scope: '年度行业直接投资'},
  {source: 'brazil-cvm', view: 'default', name: '巴西 · CVM', scope: '月度公开基金股票买卖'},
  {source: 'worldbank-wfe', view: 'default', name: '全球股市 · World Bank / WFE', scope: '年度股票市场统计'},
  {source: 'cftc', view: 'default', name: '期货 · CFTC', scope: '每周交易者持仓报告'},
  {source: 'tpex-shares', view: 'default', name: '台湾 · TPEx 股数', scope: '法人买卖股数'},
  {source: 'japan-mof', view: 'default', name: '日本 · 财务省', scope: '每周证券投资负债'},
  {source: 'tpex-money', view: 'institutional_summary', name: '台湾 · TPEx 金额', scope: '法人金额汇总，受同一提供方停止状态约束'},
  {source: 'cboe-europe', view: 'retained_quote_snapshot', name: '欧洲 · Cboe', scope: '保留的延迟报价快照，不用空检查刷新采集时间'},
  {source: 'polymarket', view: 'newest', name: 'Polymarket · 最新市场', scope: '最新市场独立快照'},
  {source: 'polymarket', view: 'hot', name: 'Polymarket · 热门市场', scope: '热门市场独立快照'},
  {source: 'polymarket', view: 'interest', name: 'Polymarket · 未平仓量', scope: '未平仓量独立快照与冷却状态'},
  {source: 'treasury-tic', view: 'latest', name: '美国 · TIC 最新期', scope: '月度跨境证券净交易，非交易所日内资金'},
  {source: 'treasury-tic', view: 'history', name: '美国 · TIC 历史', scope: '最近 12 期独立缓存，非实时数据'},
] as const;
const instant = z.string().max(40).datetime({offset: true}).refine(value => Number.isFinite(Date.parse(value))).nullable();
const state = z.enum(['idle', 'cooldown', 'busy_or_unconfirmed', 'stopped', 'outcome_unconfirmed', 'unknown']);
const metadata = z.enum(['read', 'not_initialized', 'unavailable']);
const source = z.object({
  source: z.string().max(32), view: z.string().max(40), metadata, coordination: state, provider_coordination: state.nullable(),
  database_observed_at: instant, coordination_updated_at: instant, last_check_recorded_at: instant,
  check_time_semantics: z.enum(['attempt_started', 'attempt_finished_not_necessarily_successful', 'not_persisted_separately']),
  next_attempt_not_before: instant,
  cache: z.object({validation: z.literal('not_performed'), record_present: z.boolean().nullable(), recorded_acquisition_at: instant,
    recorded_collection_start_at: instant, recorded_commit_at: instant, recorded_expiry_at: instant}),
});
export const diagnosticsPresentationSchema = z.object({
  schema: z.literal('financeflow-diagnostics/1'), mode: z.literal('read_only_metadata'),
  built_in_collection: z.literal('request_driven'), metadata_complete: z.boolean(),
  external_scheduler: z.object({installation: z.literal('unknown'), metadata,
    observed_job_state: z.enum(['idle', 'busy_or_unconfirmed', 'stopped', 'unknown']),
    last_event_seen_at: instant, last_admitted_tick_at: instant, last_job_started_at: instant, last_job_finished_at: instant}),
  sources: z.array(source).length(diagnosticViews.length).superRefine((rows, context) => {
    // Exact fixed views, once each. Unknown or duplicate IDs cannot become UI text.
    if (diagnosticViews.some(view => rows.filter(row => row.source === view.source && row.view === view.view).length !== 1)) {
      context.addIssue({code: z.ZodIssueCode.custom, message: 'Unexpected diagnostic views'});
    }
  }),
});
export type DiagnosticReport = z.infer<typeof diagnosticsPresentationSchema>;
export type DiagnosticSource = DiagnosticReport['sources'][number];
export const stateLabels: Record<DiagnosticSource['coordination'], string> = {
  idle: '空闲，不代表可用', cooldown: '冷却中', busy_or_unconfirmed: '忙碌或结果待确认',
  stopped: '已停止', outcome_unconfirmed: '结果未确认', unknown: '未知',
};
export function cacheSummary(row: DiagnosticSource): {kind: 'unknown' | 'missing' | 'expired' | 'unvalidated'; label: string} {
  if (row.metadata !== 'read' || !['idle', 'cooldown'].includes(row.coordination) || row.cache.record_present === null) {
    return {kind: 'unknown', label: '缓存状态未知'};
  }
  if (!row.cache.record_present) return {kind: 'missing', label: '未见缓存记录'};
  if (!row.cache.recorded_expiry_at || !row.database_observed_at) return {kind: 'unknown', label: '缓存新鲜度未知'};
  return Date.parse(row.cache.recorded_expiry_at) <= Date.parse(row.database_observed_at)
    ? {kind: 'expired', label: '已超过缓存期限'}
    : {kind: 'unvalidated', label: '读取时在缓存期限内'};
}
export function formatDiagnosticTime(value: string): string {
  return new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}
