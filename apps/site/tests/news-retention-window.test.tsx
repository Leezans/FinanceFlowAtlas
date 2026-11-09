// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import NewsWorkspace from '../components/news/NewsWorkspace';
import {NEWS_LOOKBACK_MS, NEWS_REFRESH_MS} from '../components/news/presentation';
import {NEWS_UI_NOW, newsUiSnapshot} from './news-ui-fixture';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NEWS_UI_NOW);
  Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const tick = async (ms = 1) => { await act(() => vi.advanceTimersByTimeAsync(ms)); };

describe('retained news publication window', () => {
  it('expires a 30-day publication during repeated network failures despite a fresh acquisition', async () => {
    const snapshot = newsUiSnapshot();
    snapshot.news[0].publishedAt = new Date(NEWS_UI_NOW - NEWS_LOOKBACK_MS + 60_000).toISOString();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    render(<NewsWorkspace/>); await tick();
    expect(screen.getByRole('article', {name: 'Synthetic technology update'})).toBeTruthy();

    // The first failure still retains the near-boundary article, proving that
    // later removal is publication expiry rather than wholesale cache removal.
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.getByText('检查失败 · 保留上次结果')).toBeTruthy();
    expect(screen.getByRole('article', {name: 'Synthetic technology update'})).toBeTruthy();
    await tick(NEWS_REFRESH_MS * 2);
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole('article', {name: 'Synthetic technology update'})).toBeNull();
    expect(screen.getByRole('article', {name: 'Synthetic finance release'})).toBeTruthy();
    expect(screen.getByRole('article', {name: 'Synthetic diplomatic statement'})).toBeTruthy();
    expect(screen.getByText('来源发布时间：未知')).toBeTruthy();
    expect(Date.now() - Date.parse(snapshot.sources[0].fetchedAt!)).toBeLessThan(24 * 60 * 60 * 1000);
  });
  it('rechecks date-only boundaries at UTC midnight while a failed-fetch snapshot remains usable', async () => {
    const beforeMidnight = Date.parse('2026-11-09T23:59:00Z');
    vi.setSystemTime(beforeMidnight);
    const snapshot = newsUiSnapshot();
    snapshot.sources.forEach(source => {source.fetchedAt = new Date(beforeMidnight).toISOString();});
    snapshot.news[0].publishedAt = null;
    snapshot.news[0].publishedDate = '2026-10-10';
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    render(<NewsWorkspace/>); await tick();
    expect(screen.getByText('来源发布时间：2026-10-10（仅日期，时刻 / 时区未提供）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '重新检查'})); await tick();
    expect(screen.getByText('检查失败 · 保留上次结果')).toBeTruthy();
    await tick(60_001);
    expect(screen.queryByRole('article', {name: 'Synthetic technology update'})).toBeNull();
    expect(screen.getByRole('article', {name: 'Synthetic finance release'})).toBeTruthy();
    expect(screen.getByText('来源发布时间：未知')).toBeTruthy();
  });
});
