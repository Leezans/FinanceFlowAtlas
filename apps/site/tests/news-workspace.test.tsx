// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import NewsWorkspace from '../components/news/NewsWorkspace';
import {BROWSER_RETENTION_MS, NEWS_REFRESH_MS} from '../components/news/presentation';
import {NEWS_REQUEST_TIMEOUT_MS} from '../components/news/useNewsFeed';
import {NEWS_UI_NOW, expandedNewsUiSnapshot, newsUiItem, newsUiSnapshot} from './news-ui-fixture';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NEWS_UI_NOW); Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick(ms = 1) { await act(() => vi.advanceTimersByTimeAsync(ms)); }
async function start() { const view = render(<NewsWorkspace/>); await tick(); return view; }
function mockSuccess() { const fetcher = vi.fn(async () => Response.json(newsUiSnapshot())); vi.stubGlobal('fetch', fetcher); return fetcher; }

describe('global news reading workspace', () => {
  it('filters Hong Kong government and ECB coverage without relabeling it as global corroboration', async () => {
    const snapshot = expandedNewsUiSnapshot();
    const fetcher = vi.fn(async () => Response.json(snapshot)); vi.stubGlobal('fetch', fetcher); await start();
    expect(screen.getAllByRole('article')).toHaveLength(snapshot.news.length);
    expect(screen.getByRole('option', {name: '中国香港'}).getAttribute('value')).toBe('HKG');
    fireEvent.click(screen.getByRole('button', {name: '政务综合'}));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const hk = screen.getByRole('article', {name: 'Synthetic Hong Kong government update'});
    expect(within(hk).getByText(/单一来源陈述，未独立交叉核验.*中国香港/)).toBeTruthy();
    expect(within(hk).queryByRole('navigation', {name: '相关市场'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: '全部主题'}));
    fireEvent.change(screen.getByRole('combobox', {name: '来源 / 主题地区'}), {target: {value: 'EU'}});
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const ecb = screen.getByRole('article', {name: 'Synthetic ECB monetary policy release'});
    expect(within(ecb).getByRole('link', {name: '外汇行情 ↗'}).getAttribute('href')).toBe('/forex');
    fireEvent.click(screen.getByRole('button', {name: /来源状态/}));
    expect(screen.getByText(`${snapshot.sources.length} 个接入来源`)).toBeTruthy();
    expect(screen.getAllByRole('link', {name: /使用条款/})).toHaveLength(snapshot.sources.length);
    expect(screen.getByText(/不代表中国内地或亚洲全面覆盖，未自动判断事件重要性/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: /新闻发布/}));
    expect(screen.getByRole('article', {name: 'Synthetic ECB monetary policy release'})).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('separates publication from occurrence and links only existing markets', async () => {
    mockSuccess(); await start();
    expect(screen.getByRole('heading', {name: '全球新闻与日程'})).toBeTruthy();
    const tech = screen.getByRole('article', {name: 'Synthetic technology update'});
    expect(within(tech).getByText('来源发布时间：2026/11/09 07:30（北京时间）')).toBeTruthy();
    expect(within(tech).getByText(/事件发生时间：未核验/)).toBeTruthy();
    expect(within(tech).getByText(/单一来源陈述，未独立交叉核验/)).toBeTruthy();
    expect(within(tech).getByRole('link', {name: '加密现货 ↗'}).getAttribute('href')).toBe('/crypto');
    expect(screen.queryByText('not-a-real-market')).toBeNull();
    expect(screen.getByText('来源发布时间：未知')).toBeTruthy();
    expect(screen.getByText('来源更新时间：2026/11/09 07:30（北京时间）')).toBeTruthy();
    expect(screen.queryByRole('article', {name: 'Synthetic official release'})).toBeNull();
    expect(screen.getByText(/新闻按规范化原文链接去重/)).toBeTruthy();
  });
  it('filters category, region and text without refetching, then clears them', async () => {
    const fetcher = mockSuccess(); await start();
    fireEvent.click(screen.getByRole('button', {name: '科技'}));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', {name: '来源 / 主题地区'}), {target: {value: 'GBR'}});
    expect(screen.getByRole('heading', {name: '没有符合筛选的条目'})).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', {name: '清除筛选'})[0]);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox'), {target: {value: 'diplomatic'}});
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', {name: 'Synthetic diplomatic statement'})).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('shows scheduled/date-only/cancelled events separately and preserves category selection', async () => {
    mockSuccess(); await start();
    fireEvent.click(screen.getByRole('button', {name: '金融'}));
    fireEvent.click(screen.getByRole('button', {name: /未来日程/}));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getAllByText('2026/11/10 21:30（北京时间）')).toHaveLength(2);
    expect(screen.getByText('2026-11-12（来源日期 · 全天）')).toBeTruthy();
    expect(screen.getByText(/原始时区：未提供；未换算为北京时间/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', {name: '日程状态'}), {target: {value: 'cancelled'}});
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('来源标记此日程已取消。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: /新闻发布/}));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', {name: 'Synthetic finance release'})).toBeTruthy();
  });
  it('explains partial failures, acquisition and reuse terms for each source', async () => {
    const snapshot = newsUiSnapshot(); snapshot.status = 'partial'; snapshot.sources[0].status = 'stale'; snapshot.sources[0].error = 'Synthetic timeout'; snapshot.sources[0].warnings = ['Synthetic skipped row'];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot))); await start();
    expect(screen.getByText('部分来源未更新')).toBeTruthy();
    expect(screen.getByText('旧副本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '查看来源状态'}));
    expect(screen.getByRole('heading', {name: '逐个来源核验'})).toBeTruthy();
    expect(screen.getByText('获取情况：Synthetic timeout')).toBeTruthy();
    expect(screen.getByText('Synthetic skipped row')).toBeTruthy();
    expect(screen.getAllByRole('link', {name: /使用条款/})).toHaveLength(4);
  });
  it('shows unavailable and halted sources without fake fallback records', async () => {
    const snapshot = newsUiSnapshot(); snapshot.status = 'unavailable'; snapshot.news = []; snapshot.events = []; snapshot.sources.forEach(source => {source.status = 'error'; source.itemCount = 0; source.halted = true; source.nextRefreshAt = null; source.fetchedAt = null;});
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot, {status: 503}))); await start();
    expect(screen.getByText('来源暂不可用')).toBeTruthy(); expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('当前没有可展示的新闻')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: /来源状态 4/}));
    expect(screen.getAllByText('已停止自动重试')).toHaveLength(4);
  });
  it('starts in a loading state and retries an initial network failure', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(newsUiSnapshot())); vi.stubGlobal('fetch', fetcher);
    render(<NewsWorkspace/>); expect(screen.getByText('正在获取来源快照')).toBeTruthy(); await tick();
    expect(screen.getByRole('alert').textContent).toContain('本次检查失败');
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.getAllByRole('article')).toHaveLength(3); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('retains data and filters on transient failure, then replaces it on retry', async () => {
    const fetcher = mockSuccess(); await start();
    fireEvent.click(screen.getByRole('button', {name: '科技'}));
    fetcher.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.getByText('检查失败 · 保留上次结果')).toBeTruthy(); expect(screen.getAllByRole('article')).toHaveLength(1);
    const next = newsUiSnapshot(); next.news[0].title = 'Synthetic revised technology update'; fetcher.mockResolvedValueOnce(Response.json(next));
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.getByRole('article', {name: 'Synthetic revised technology update'})).toBeTruthy(); expect(screen.queryByText('检查失败 · 保留上次结果')).toBeNull();
    expect(screen.getByRole('button', {name: '科技'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('expires retained records by original source acquisition during continuous failures', async () => {
    const fetcher = mockSuccess(); await start(); fetcher.mockRejectedValue(new Error('offline'));
    vi.setSystemTime(NEWS_UI_NOW + BROWSER_RETENTION_MS + 1);
    fireEvent(document, new Event('visibilitychange')); await tick();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(/已隐藏 3 条超出副本保留期/)).toBeTruthy();
  });
  it.each([302, 401, 403, 451])('clears prior data and stops retries on HTTP %s', async status => {
    const fetcher = mockSuccess(); await start(); fetcher.mockResolvedValueOnce(new Response('blocked', {status}));
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.queryAllByRole('article')).toHaveLength(0); expect(screen.getByRole('alert').textContent).toContain('自动检查已停止');
    await tick(NEWS_REFRESH_MS * 2); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', {name: '重新检查'})).toHaveProperty('disabled', true);
  });
  it('clears malformed success payloads instead of rendering unchecked content', async () => {
    const fetcher = mockSuccess(); await start(); fetcher.mockResolvedValueOnce(Response.json({...newsUiSnapshot(), sources: [{}]}));
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.queryAllByRole('article')).toHaveLength(0); expect(screen.getByRole('alert').textContent).toContain('响应未通过校验');
  });
  it('polls only in foreground and resumes once when overdue', async () => {
    const fetcher = mockSuccess(); await start();
    Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
    await tick(NEWS_REFRESH_MS * 2); expect(fetcher).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
    fireEvent(document, new Event('visibilitychange')); fireEvent(document, new Event('visibilitychange')); await tick();
    expect(fetcher).toHaveBeenCalledTimes(2); await tick(NEWS_REFRESH_MS); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('coalesces clicks, aborts on unmount and cancels scheduled requests', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise<Response>(resolve => {finish = resolve;})); vi.stubGlobal('fetch', fetcher);
    const view = await start(); fireEvent.click(screen.getByRole('button', {name: '正在检查…'})); expect(fetcher).toHaveBeenCalledTimes(1);
    view.unmount(); expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    await act(async () => finish(Response.json(newsUiSnapshot()))); await tick(NEWS_REFRESH_MS * 2); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('times out a stalled response body and leaves a usable retry button', async () => {
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'redirected' | 'json'>>>(() => Promise.resolve({ok: true, status: 200, redirected: false, json: () => new Promise(() => {})})); vi.stubGlobal('fetch', fetcher);
    await start(); await tick(NEWS_REQUEST_TIMEOUT_MS);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('本次检查失败'); expect(screen.getByRole('button', {name: '重新检查'})).toHaveProperty('disabled', false);
  });
  it('requires opt-in for in-page arrivals, does not repeat and can turn them off', async () => {
    const fetcher = mockSuccess(); await start();
    const next = newsUiSnapshot(); next.news.push(newsUiItem({id: 'new-1', title: 'Synthetic new story', url: 'https://example.invalid/new'}));
    fetcher.mockResolvedValueOnce(Response.json(next)); fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick(); expect(screen.queryByText(/本次打开期间新增/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', {name: /开启本页新条目提示/}));
    next.news.push(newsUiItem({id: 'new-2', title: 'Synthetic second story', url: 'https://example.invalid/new2'}));
    fetcher.mockResolvedValueOnce(Response.json(next)); fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick(); expect(screen.getByText(/本次打开期间新增 1 条/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '知道了'}));
    fetcher.mockResolvedValueOnce(Response.json(next)); fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick(); expect(screen.queryByText(/本次打开期间新增/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', {name: /开启本页新条目提示/})); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
  });
});
