// @vitest-environment jsdom
import React, {StrictMode} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import Diagnostics from '../components/diagnostics/Diagnostics';
import {cacheSummary, diagnosticsPresentationSchema, diagnosticViews, formatDiagnosticTime, type DiagnosticReport} from '../lib/diagnostics/presentation';
import {createDiagnosticsHandler} from '../lib/diagnostics/handler';

const now = '2026-11-06T10:00:00.000Z', earlier = '2026-11-06T09:00:00.000Z', later = '2026-11-06T11:00:00.000Z';
function report(): DiagnosticReport {
  return {schema: 'financeflow-diagnostics/1', mode: 'read_only_metadata', built_in_collection: 'request_driven', metadata_complete: true,
    external_scheduler: {installation: 'unknown', metadata: 'unavailable', observed_job_state: 'unknown', last_event_seen_at: null, last_admitted_tick_at: null, last_job_started_at: null, last_job_finished_at: null},
    sources: diagnosticViews.map(label => ({source: label.source, view: label.view, metadata: 'read', coordination: 'idle', provider_coordination: null, database_observed_at: now, coordination_updated_at: now, last_check_recorded_at: earlier,
      check_time_semantics: label.source === 'treasury-tic' ? 'attempt_started' : label.source === 'eastmoney' ? 'attempt_finished_not_necessarily_successful' : 'not_persisted_separately', next_attempt_not_before: null,
      cache: {validation: 'not_performed', record_present: true, recorded_acquisition_at: earlier, recorded_collection_start_at: null, recorded_commit_at: null, recorded_expiry_at: null}}))};
}
const response = (body: unknown = report(), status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const getCard = (name: string) => within(screen.getByRole('article', {name}));
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('diagnostics presentation boundary', () => {
  it('accepts the actual read-only handler response including all-unavailable 503', async () => {
    const result = await createDiagnosticsHandler()(new Request('https://local.invalid/api/v1/diagnostics'));
    expect(result.status).toBe(503);
    expect(diagnosticsPresentationSchema.safeParse(await result.json()).success).toBe(true);
  });
  it.each(['schema', 'mode', 'built_in_collection'])('rejects incompatible %s', field => {
    expect(diagnosticsPresentationSchema.safeParse({...report(), [field]: 'unknown'}).success).toBe(false);
  });
  it('rejects installed scheduler claims, unsafe timestamps, duplicate and unknown views', () => {
    let body = report(); body.external_scheduler.installation = 'installed' as 'unknown';
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
    body = report(); body.sources[0].cache.recorded_acquisition_at = 'SECRET_RAW_ERROR';
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
    body = report(); body.sources[0].cache.recorded_acquisition_at = '2026-02-30T00:00:00.000Z';
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
    body = report(); body.sources[0] = body.sources[1];
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
    body = report(); body.sources[0].source = 'SECRET_INTERNAL_IDENTIFIER';
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
  });
  it.each([
    {category: 'SECRET_URL'}, {recorded_at: 'SECRET_EXCEPTION'}, {recorded_at: later},
    {recorded_at: '2026-11-06T17:00:00+08:00'}, {durable_streak_count: 6}, {durable_streak_count: 0},
    {count_semantics: 'lifetime_total'},
  ])('rejects unsafe or misleading retained failure metadata %#', patch => {
    const body = report(); body.sources[0].retained_failure = {category: 'deadline', recorded_at: earlier, durable_streak_count: 1, count_semantics: 'durable_streak_capped_at_5', ...patch} as NonNullable<DiagnosticReport['sources'][number]['retained_failure']>;
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
  });
  it('rejects retained failure claims for other sources', () => {
    const body = report(); body.sources[1].retained_failure = {category: 'deadline', recorded_at: earlier, durable_streak_count: 1, count_semantics: 'durable_streak_capped_at_5'};
    expect(diagnosticsPresentationSchema.safeParse(body).success).toBe(false);
  });
  it('compares expiry against each database read time, never the viewer clock or acquisition date', () => {
    const row = report().sources[0];
    expect(cacheSummary(row).kind).toBe('unknown');
    row.cache.recorded_expiry_at = earlier; expect(cacheSummary(row).kind).toBe('expired');
    row.cache.recorded_expiry_at = now; expect(cacheSummary(row).kind).toBe('expired');
    row.cache.recorded_expiry_at = later; expect(cacheSummary(row).kind).toBe('unvalidated');
    row.coordination = 'stopped'; expect(cacheSummary(row).kind).toBe('unknown');
    row.coordination = 'idle'; row.cache.record_present = false; expect(cacheSummary(row).kind).toBe('missing');
    expect(formatDiagnosticTime(now)).toBe('2026-11-06 10:00:00 UTC');
  });
});

describe('read-only source status page', () => {
  it('shows retained failure evidence during idle without claiming recovery or a lifetime count', async () => {
    const body = report(); body.sources[0].retained_failure = {category: 'deadline', recorded_at: earlier, durable_streak_count: 5, count_semantics: 'durable_streak_capped_at_5'};
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    const card = getCard('A 股 · Eastmoney');
    expect(card.getByText('采集时限已到')).toBeTruthy();
    expect(card.getByText('5（已达计数上限）')).toBeTruthy();
    expect(card.getByText(/不是历史失败总数/)).toBeTruthy();
    expect(card.getByText(/空闲或冷却结束不代表来源已恢复/)).toBeTruthy();
    expect(getCard('加密 / 外汇 · Kraken').queryByText('保留的失败类别')).toBeNull();
  });
  it('accepts older v1 responses and shows unknown retained failure instead of zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(report())));
    render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    expect(getCard('A 股 · Eastmoney').getAllByText('未知')).toHaveLength(2);
  });
  it('reads only the diagnostics endpoint once, keeps acquisition distinct from source time and never claims working data', async () => {
    const body = report(); body.sources[0].cache.recorded_expiry_at = earlier;
    body.sources[1].coordination = 'stopped'; body.sources[1].cache.recorded_acquisition_at = null;
    body.sources[2].coordination = 'cooldown'; body.sources[2].next_attempt_not_before = later;
    const fetcher = vi.fn().mockResolvedValue(response({...body, limitations: 'SECRET_PROVIDER_ERROR', hidden_token: 'SECRET_TOKEN'})); vi.stubGlobal('fetch', fetcher);
    const {container} = render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('/api/v1/diagnostics');
    expect(fetcher.mock.calls[0][1]).toMatchObject({method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error'});
    expect(screen.getAllByRole('article')).toHaveLength(19);
    expect(getCard('巴西 · CVM').getByText('月度公开基金股票买卖')).toBeTruthy();
    expect(getCard('A 股 · Eastmoney').getByText('已超过缓存期限')).toBeTruthy();
    expect(getCard('A 股 · Eastmoney').getByText('检查完成记录')).toBeTruthy();
    expect(getCard('美国 · TIC 最新期').getByText('检查开始记录')).toBeTruthy();
    expect(getCard('加密 / 外汇 · Kraken').getByText('已停止')).toBeTruthy();
    expect(getCard('外汇 · ECB').getByText('最早可再尝试')).toBeTruthy();
    expect(screen.getAllByText('未核验')).toHaveLength(19);
    expect(container.textContent).not.toContain('SECRET_');
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.getByRole('button', {name: '重新读取状态'})).toBeTruthy();
    expect(container.textContent).toContain('停留本页不会自动刷新');
    expect(container.textContent).toContain('本页不证明每分钟自动更新');
  });
  it('displays valid 503, missing records and unavailable metadata without pretending they are healthy', async () => {
    const body = report(); body.metadata_complete = false;
    body.sources.forEach((row, index) => {row.metadata = index ? 'unavailable' : 'not_initialized'; row.coordination = 'unknown'; row.cache.record_present = null; row.cache.recorded_acquisition_at = null;});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body, 503)));
    render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    expect(getCard('A 股 · Eastmoney').getByText(/尚无初始化记录/)).toBeTruthy();
    expect(getCard('加密 / 外汇 · Kraken').getByText(/元数据暂不可读/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('未知状态已保留');
    expect(screen.getByText('0 / 19')).toBeTruthy();
  });
  it.each([401, 403])('handles authorization HTTP %s without raw output or alternate source calls', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('SECRET_LOGIN_PAGE', {status})); vi.stubGlobal('fetch', fetcher);
    render(<Diagnostics/>); await waitFor(() => expect(screen.getByRole('status').textContent).toContain('所有者账号'));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByRole('article')).toBeNull(); expect(document.body.textContent).not.toContain('SECRET');
  });
  it.each(['html', 'invalid-json', 'bad-schema', 'oversized', 'http-error', 'network'])('fails closed on %s', async scenario => {
    const fetcher = vi.fn();
    if (scenario === 'network') fetcher.mockRejectedValue(new Error('SECRET_URL'));
    else fetcher.mockResolvedValue(scenario === 'html' ? new Response('<html>SECRET_LOGIN</html>') : scenario === 'invalid-json' ? new Response('{SECRET', {headers: {'content-type': 'application/json'}}) : scenario === 'oversized' ? response({secret: 'x'.repeat(131_073)}) : response({secret: 'SECRET'}, scenario === 'http-error' ? 500 : 200));
    vi.stubGlobal('fetch', fetcher); render(<Diagnostics/>);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('本次状态未能读取'));
    expect(screen.queryByRole('article')).toBeNull(); expect(document.body.textContent).not.toContain('SECRET'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears old results while rereading and on failure; repeated clicks are mutually exclusive; a later reread works', async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>(resolve => {finish = resolve;})).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher); render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    fireEvent.click(screen.getByRole('button', {name: '重新读取状态'}));
    expect(screen.queryByRole('article')).toBeNull();
    const busy = screen.getByRole('button', {name: '正在读取状态…'}) as HTMLButtonElement;
    expect(busy.disabled).toBe(true); fireEvent.click(busy); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {finish(new Response('bad', {status: 500}));});
    expect(screen.queryByRole('article')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('本次状态未能读取');
    fireEvent.click(screen.getByRole('button', {name: '重新读取状态'})); await screen.findByRole('article', {name: 'A 股 · Eastmoney'}); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not poll while left open', async () => {
    const fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher); render(<Diagnostics/>);
    await screen.findByRole('article', {name: 'A 股 · Eastmoney'}); vi.useFakeTimers(); await act(() => vi.advanceTimersByTimeAsync(300_000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled read, aborts it and never schedules retries', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetcher); render(<Diagnostics/>); await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('status').textContent).toContain('读取超时'); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(300_000)); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('aborts on leave, ignores late results and reads anew after a return', async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {finish = resolve;})).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher); const view = render(<Diagnostics/>); view.unmount();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    await act(async () => {finish(response({bad: true}));});
    expect(screen.getAllByRole('article')).toHaveLength(19); expect(screen.getByRole('status').textContent).not.toContain('未能读取');
  });
  it('handles strict-mode remount without a stale result overriding the new request', async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {finish = resolve;})).mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetcher);
    render(<StrictMode><Diagnostics/></StrictMode>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    await act(async () => {finish(response({bad: true}));}); expect(screen.getAllByRole('article')).toHaveLength(19);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('keeps distinct view times and preserves provider stops and uncertainty', async () => {
    const body = report(); body.sources[9].provider_coordination = 'stopped'; body.sources[9].coordination = 'stopped';
    body.sources[11].cache.recorded_acquisition_at = '2026-11-06T01:00:00.000Z'; body.sources[12].cache.recorded_acquisition_at = '2026-11-06T02:00:00.000Z'; body.sources[13].cache.recorded_acquisition_at = '2026-11-06T03:00:00.000Z';
    body.sources[14].cache.recorded_acquisition_at = '2026-11-06T04:00:00.000Z'; body.sources[15].cache.recorded_acquisition_at = '2026-11-06T05:00:00.000Z';
    body.sources[3].coordination = 'busy_or_unconfirmed'; body.sources[4].coordination = 'outcome_unconfirmed';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body))); render(<Diagnostics/>); await screen.findByRole('article', {name: 'A 股 · Eastmoney'});
    expect(getCard('台湾 · TPEx 金额').getByText('共同提供方状态')).toBeTruthy(); expect(getCard('台湾 · TPEx 金额').getAllByText('已停止')).toHaveLength(2);
    for (const [name, hour] of [['Polymarket · 最新市场', '01'], ['Polymarket · 热门市场', '02'], ['Polymarket · 未平仓量', '03'], ['美国 · TIC 最新期', '04'], ['美国 · TIC 历史', '05']]) expect(getCard(name).getByText(`2026-11-06 ${hour}:00:00 UTC`)).toBeTruthy();
    expect(getCard('东盟 · ASEANstats').getByText('忙碌或结果待确认')).toBeTruthy(); expect(getCard('巴西 · CVM').getByText('结果未确认')).toBeTruthy();
  });
});
