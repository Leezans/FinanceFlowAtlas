// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import EquityContext from '../components/equity/EquityContext';
import {MAX_CACHE_AGE_MS, REFRESH_MS} from '../lib/equity/model';
import {reply, NOW} from './equity-fixture';

beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(NOW); window.history.replaceState({}, '', '/equities');});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});});
async function start() {render(<EquityContext/>); await act(() => vi.advanceTimersByTimeAsync(1));}
const globalMatrix = () => screen.getByRole('region', {name: '全球股市年度矩阵'});
const focus = () => screen.getByRole('region', {name: '所选国家年度股市'});
const expectEmpty = () => {
  expect(globalMatrix().querySelector('[data-matrix-empty=true]')).toBeTruthy();
  expect(globalMatrix().querySelectorAll('[data-id]')).toHaveLength(0);
  expect(focus().querySelectorAll('[data-id]')).toHaveLength(0);
};
describe('annual equity context UI', () => {
  it('renders every numeric measure through the shared matrices and distinguishes annual size from flow', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply()))); await start();
    expect(screen.getByRole('heading', {name: '美国'})).toBeTruthy();
    expect(globalMatrix().querySelectorAll('[data-id]')).toHaveLength(249);
    expect(globalMatrix().querySelectorAll('[data-color^=magnitude]')).toHaveLength(2);
    expect(focus().querySelectorAll('[data-id]')).toHaveLength(2);
    expect(within(focus()).getByText('10 亿美元')).toBeTruthy(); expect(within(focus()).getByText('20 亿美元')).toBeTruthy();
    expect(screen.getByText(/这是年度市场规模与交易活跃度/)).toBeTruthy();
    expect(screen.getByText(/249 个地理索引不等于数据覆盖/)).toBeTruthy();
    expect(screen.getByRole('link', {name: /美国真实月度跨境股票净买入/}).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText(/前 15 名/)).toBeNull();
  });
  it('changes country and metric locally without mixing the retained older metric into the newest year', async () => {
    const fetcher = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', fetcher); await start();
    fireEvent.click(globalMatrix().querySelector('[data-id=JPN]')!);
    expect(screen.getByRole('heading', {name: '日本'})).toBeTruthy();
    expect(within(focus()).getByText(/2024 全年/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('比较指标'), {target: {value: 'traded_value'}});
    expect(globalMatrix().querySelector('[data-id=JPN]')?.getAttribute('data-color')).toBe('missing');
    expect(screen.getByText(/2025 年 · 1 个国家/)).toBeTruthy();
    expect(screen.queryByLabelText('观测年度')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(window.location.search).toBe('?country=JPN');
  });
  it('keeps the color scale and current controls through region filtering and a same-scope refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply()))); await start();
    fireEvent.change(screen.getByLabelText('筛选区域'), {target: {value: 'Asia'}});
    expect(globalMatrix().querySelector('[data-id=USA]')).toBeNull();
    expect(globalMatrix().querySelector('[data-id=JPN]')?.getAttribute('data-color')).toBe('magnitude-1');
    fireEvent.keyDown(globalMatrix().querySelector('[data-id=JPN]')!, {key: 'Enter'});
    fireEvent.click(screen.getByRole('button', {name: '检查数据'})); await act(() => vi.advanceTimersByTimeAsync(1));
    expect((screen.getByLabelText('筛选区域') as unknown as {value: string}).value).toBe('Asia');
    expect(screen.getByRole('heading', {name: '日本'})).toBeTruthy();
  });
  it('honors deep links, Back/Forward, and repeated selections without duplicate history', async () => {
    window.history.replaceState({}, '', '/equities?country=JPN');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply()))); await start();
    expect(screen.getByRole('heading', {name: '日本'})).toBeTruthy();
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByRole('button', {name: '美国优先 ↗'}));
    fireEvent.click(screen.getByRole('button', {name: '美国优先 ↗'})); expect(push).toHaveBeenCalledTimes(1);
    window.history.replaceState({}, '', '/equities?country=JPN'); fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByRole('heading', {name: '日本'})).toBeTruthy();
    window.history.replaceState({}, '', '/equities?country=USA'); fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByRole('heading', {name: '美国'})).toBeTruthy();
  });
  it('keeps unreported countries missing, never zero or sample observations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply()))); await start();
    fireEvent.change(screen.getByLabelText('选择国家 / 地区'), {target: {value: 'AFG'}});
    expect(within(focus()).getAllByText('暂无观测')).toHaveLength(2);
    expect(globalMatrix().querySelector('[data-id=AFG]')?.getAttribute('data-color')).toBe('missing');
    expect(within(focus()).queryByText('0 美元')).toBeNull();
  });
  it('retains an empty matrix instead of a list or synthetic data when unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({snapshot: null, status: {...reply().status, state: 'unavailable'}}, {status: 503})));
    await start(); expectEmpty(); expect(screen.getByText('年度股市矩阵暂无可核验数据')).toBeTruthy();
  });
  it('retains verified data on transient failure and hides it after seven days even in a hidden tab', async () => {
    const fetcher = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', fetcher); await start();
    fetcher.mockRejectedValue(new Error()); fireEvent.click(screen.getByRole('button', {name: '检查数据'}));
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(screen.getByText('已保留数据 · 获取状态陈旧')).toBeTruthy();
    Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
    vi.setSystemTime(NOW + MAX_CACHE_AGE_MS + 30_001); await act(() => vi.advanceTimersByTimeAsync(30_000)); expectEmpty();
  });
  it.each([401, 403, 302])('clears evidence and stops requests after permission HTTP %s', async status => {
    const fetcher = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', fetcher); await start();
    fetcher.mockImplementation(async () => new Response('Login', {status}));
    fireEvent.click(screen.getByRole('button', {name: '检查数据'})); await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('展示权限已失效')).toBeTruthy(); expectEmpty();
    await act(() => vi.advanceTimersByTimeAsync(2 * REFRESH_MS)); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('coalesces repeated requests and stops after a source denial', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(done => resolve = done)); vi.stubGlobal('fetch', fetcher);
    const view = render(<EquityContext/>); await act(() => vi.advanceTimersByTimeAsync(1));
    fireEvent.click(screen.getByRole('button', {name: '正在检查…'})); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => resolve(Response.json({snapshot: null, status: {...reply().status, state: 'denied', error_code: 'source_denied'}}, {status: 503})));
    await act(() => vi.advanceTimersByTimeAsync(2 * REFRESH_MS)); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText('来源访问已停止')).toBeTruthy(); expectEmpty(); view.unmount();
  });
  it('aborts and ignores a pending request on unmount', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetcher);
    const view = render(<EquityContext/>); await act(() => vi.advanceTimersByTimeAsync(1)); view.unmount();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('clears malformed successful responses while retaining the empty matrix shell', async () => {
    const fetcher = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', fetcher); await start();
    fetcher.mockImplementation(async () => Response.json({snapshot: {...reply().snapshot, rows: []}, status: reply().status}));
    fireEvent.click(screen.getByRole('button', {name: '检查数据'})); await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('响应未通过校验，已清空浏览器数据。')).toBeTruthy(); expectEmpty();
  });
});
