'use client';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {cacheSummary, diagnosticsPresentationSchema, diagnosticViews, formatDiagnosticTime, stateLabels, type DiagnosticReport, type DiagnosticSource} from '@/lib/diagnostics/presentation';
import s from './diagnostics.module.css';

const endpoint = '/api/v1/diagnostics';
const timeoutMs = 10_000;
async function fetchReport(signal: AbortSignal): Promise<{report: DiagnosticReport} | {error: string}> {
  const response = await fetch(endpoint, {method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', headers: {Accept: 'application/json'}, signal});
  if ([401, 403].includes(response.status)) return {error: '未能读取私人站状态。请确认已登录站点所有者账号。'};
  if (![200, 503].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid diagnostic response');
  const text = await response.text();
  if (text.length > 131_072) throw new Error('Oversized diagnostic response');
  const parsed = diagnosticsPresentationSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('Invalid diagnostic metadata');
  return {report: parsed.data};
}
function Time({value}: {value: string | null}) {
  return value ? <time dateTime={value}>{formatDiagnosticTime(value)}</time> : <span>无可展示记录</span>;
}
function SourceCard({row, label}: {row: DiagnosticSource; label: typeof diagnosticViews[number]}) {
  const cache = cacheSummary(row);
  return <article className={s.card} aria-labelledby={`${row.source}-${row.view}`}>
    <div className={s.cardTitle}><h3 id={`${row.source}-${row.view}`}>{label.name}</h3>
      <span className={s.badge} data-tone={row.coordination === 'stopped' ? 'stop' : 'neutral'}>{stateLabels[row.coordination]}</span></div>
    <p className={s.scope}>{label.scope}</p>
    <p className={s.cache} data-tone={cache.kind === 'expired' ? 'warning' : 'neutral'}>{cache.label}<span> · 内容未校验</span></p>
    {row.metadata !== 'read' && <p className={s.warning}>{row.metadata === 'not_initialized' ? '尚无初始化记录' : '元数据暂不可读'}，不能据此判定来源是否可用。</p>}
    <dl className={s.times}>
      <div><dt>采集完成记录</dt><dd><Time value={row.cache.recorded_acquisition_at}/></dd></div>
      <div><dt>源数据时点</dt><dd>未核验</dd></div>
    </dl>
    <details className={s.details}><summary>查看时间与状态依据</summary><dl className={s.times}>
      <div><dt>数据库读取时点</dt><dd><Time value={row.database_observed_at}/></dd></div>
      <div><dt>采集开始记录</dt><dd><Time value={row.cache.recorded_collection_start_at}/></dd></div>
      <div><dt>缓存写入记录</dt><dd><Time value={row.cache.recorded_commit_at}/></dd></div>
      <div><dt>缓存期限</dt><dd><Time value={row.cache.recorded_expiry_at}/></dd></div>
      <div><dt>{row.check_time_semantics === 'attempt_started' ? '检查开始记录' : row.check_time_semantics === 'attempt_finished_not_necessarily_successful' ? '检查完成记录' : '独立检查记录'}</dt><dd><Time value={row.last_check_recorded_at}/></dd></div>
      <div><dt>协调状态记录</dt><dd><Time value={row.coordination_updated_at}/></dd></div>
      {row.coordination === 'cooldown' && <div><dt>最早可再尝试</dt><dd><Time value={row.next_attempt_not_before}/></dd></div>}
      {row.provider_coordination !== null && <div><dt>共同提供方状态</dt><dd>{stateLabels[row.provider_coordination]}</dd></div>}
    </dl><p>检查记录不代表采集成功；冷却截止不是自动采集预约。无时间记录不等于从未采集。</p></details>
  </article>;
}

/** One bounded read on entry or explicit reread. No timers poll or call a provider. */
export default function Diagnostics() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const read = useCallback(() => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, timeoutMs);
    void fetchReport(controller.signal).then(result => {
      if (active.current !== controller) return;
      if (controller.signal.aborted) throw new Error('Diagnostic read aborted');
      if ('report' in result) setReport(result.report); else setError(result.error);
    }).catch(() => {
      if (active.current === controller) setError(timedOut ? '读取超时。尚未获得本次状态；可稍后重新读取。' : '本次状态未能读取。可能是连接、登录或响应格式问题，可稍后重新读取。');
    }).finally(() => {
      clearTimeout(timer);
      if (active.current === controller) {active.current = null; setLoading(false);}
    });
  }, []);
  useEffect(() => {void read(); return () => {active.current?.abort(); active.current = null;};}, [read]);
  const rows = report ? diagnosticViews.map(label => ({label, row: report.sources.find(row => row.source === label.source && row.view === label.view)!})) : [];
  return <main className={s.page}>
    <header className={s.header}><div><p className={s.eyebrow}>FINANCE FLOW ATLAS · 只读诊断</p><h1>来源状态</h1>
      <p>看清哪些来源已停止、哪些缓存已到期，以及还有哪些情况未知。</p></div>
      <button type="button" className={s.refresh} disabled={loading} onClick={() => {if (!active.current) {setLoading(true); setError(''); setReport(null); void read();}}}>{loading ? '正在读取状态…' : '重新读取状态'}</button></header>
    <aside className={s.notice} aria-label="只读范围与时间说明">
      <p><strong>只读，不采集。</strong>本页只读取已存元数据，不连接提供方、不写入数据、不解除停止状态。</p>
      <p>采集时间是本站获取记录的时间，<strong>不是源数据的行情时间或统计期</strong>。本摘要不读取源数据时点；缓存期限也不证明数据新鲜或有效。</p>
      <p>内置采集由请求触发；外部后台定时采集是否安装：<strong>未知</strong>。本页不证明每分钟自动更新。</p>
    </aside>
    <div className={s.readState} role="status" aria-live="polite" aria-atomic="true">
      {loading ? '只读取元数据，请稍候。' : error || (report?.metadata_complete ? '已读取全部固定视图的元数据，未验证数据内容或来源可用性。' : '部分或全部元数据缺失 / 暂不可读，未知状态已保留。')}
    </div>
    {report && <>
      <section className={s.overview} aria-label="读取结果摘要">
        <div><span>元数据可读</span><strong>{rows.filter(({row}) => row.metadata === 'read').length} / {rows.length}</strong></div>
        <div><span>已停止的视图</span><strong>{rows.filter(({row}) => row.coordination === 'stopped').length}</strong></div>
        <div><span>已超过缓存期限</span><strong>{rows.filter(({row}) => cacheSummary(row).kind === 'expired').length}</strong></div>
        <div><span>缓存状态 / 新鲜度未知</span><strong>{rows.filter(({row}) => cacheSummary(row).kind === 'unknown').length}</strong></div>
      </section>
      <section aria-labelledby="source-views"><div className={s.sectionTitle}><h2 id="source-views">来源与固定视图</h2><p>以下为各自读取时点的记录。停留本页不会自动刷新，所有时间均为 UTC。</p></div>
        <div className={s.grid}>{rows.map(({row, label}) => <SourceCard key={`${row.source}-${row.view}`} row={row} label={label}/>)}</div>
      </section>
      <section className={s.background} aria-labelledby="background-status"><h2 id="background-status">后台与未接入范围</h2>
        <p>后台安装状态：<strong>未知</strong>。即使读到运行记录，也不能证明定时任务已安装或正在持续运行。</p>
        <details className={s.details}><summary>查看已存后台记录</summary><dl className={s.times}>
          <div><dt>后台元数据</dt><dd>{report.external_scheduler.metadata === 'read' ? '已读取' : report.external_scheduler.metadata === 'not_initialized' ? '尚无初始化记录' : '暂不可读'}</dd></div>
          <div><dt>已存作业状态</dt><dd>{stateLabels[report.external_scheduler.observed_job_state]}</dd></div>
          <div><dt>最后事件记录</dt><dd><Time value={report.external_scheduler.last_event_seen_at}/></dd></div>
          <div><dt>最后获准执行记录</dt><dd><Time value={report.external_scheduler.last_admitted_tick_at}/></dd></div>
          <div><dt>作业开始记录</dt><dd><Time value={report.external_scheduler.last_job_started_at}/></dd></div>
          <div><dt>作业结束记录</dt><dd><Time value={report.external_scheduler.last_job_finished_at}/></dd></div>
        </dl></details>
        <p>Sina 在本站保持停用；IMF 尚未集成到托管应用。本页不代表全球市场全覆盖，也不能代替真实数据。</p>
      </section>
    </>}
  </main>;
}
