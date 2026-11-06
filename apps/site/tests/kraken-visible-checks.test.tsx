// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {useKrakenEvidence} from '../components/crypto/useKrakenEvidence';
import KrakenSpot from '../components/crypto/KrakenSpot';
import KrakenFxSpot from '../components/forex/KrakenFxSpot';
import {MAX_CACHE_AGE_MS, REFRESH_MS} from '../lib/crypto/contract';

const now = Date.parse('2026-11-06T03:00:00.000Z');
function visibility(value: 'visible' | 'hidden', emit = true) {
  Object.defineProperty(document, 'visibilityState', {value, configurable: true});
  if (emit) fireEvent(document, new Event('visibilitychange'));
}
const empty = () => Response.json({snapshot: null, trade_snapshot: null, status: {
  state: 'unavailable', error_code: null, last_attempt_at: null, fetched_at: null,
  cache_age_ms: null, refresh_ms: REFRESH_MS, max_cache_age_ms: MAX_CACHE_AGE_MS, next_retry_at: null,
}}, {status: 503});
function HookProbe() {
  const evidence = useKrakenEvidence();
  return <button onClick={() => void evidence.refresh()}>{evidence.loading ? 'pending' : 'check'}</button>;
}
const tick = async (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms));
beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(now); visibility('visible', false);});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); visibility('visible', false);});

it('does not acquire on an initially hidden mount, then checks once when visible', async () => {
  visibility('hidden', false);
  const fetcher = vi.fn(async () => empty()); vi.stubGlobal('fetch', fetcher);
  render(<HookProbe/>); await tick(180_000);
  expect(fetcher).not.toHaveBeenCalled();
  visibility('visible'); await tick(); expect(fetcher).toHaveBeenCalledOnce();
});

it('rechecks visibility when a scheduled callback runs before the hidden event', async () => {
  const fetcher = vi.fn(async () => empty()); vi.stubGlobal('fetch', fetcher);
  render(<HookProbe/>); await tick(); expect(fetcher).toHaveBeenCalledOnce();
  visibility('hidden', false); await tick(180_000);
  expect(fetcher).toHaveBeenCalledOnce();
  visibility('visible'); await tick(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not create requests from manual callbacks while hidden', async () => {
  const fetcher = vi.fn(async () => empty()); vi.stubGlobal('fetch', fetcher);
  render(<HookProbe/>); await tick(); visibility('hidden');
  fireEvent.click(screen.getByRole('button', {name: 'check'})); await tick();
  expect(fetcher).toHaveBeenCalledOnce();
});

it('leaves an admitted request alive when hidden but schedules no hidden successor', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => {finish = resolve;}));
  vi.stubGlobal('fetch', fetcher); render(<HookProbe/>); await tick();
  const signal = fetcher.mock.calls[0][1]!.signal!;
  visibility('hidden'); expect(signal.aborted).toBe(false);
  await act(async () => finish(empty())); await tick(180_000);
  expect(fetcher).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false);
  visibility('visible'); await tick(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('coalesces hide-show wakes during pending work and schedules only one successor', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => {finish = resolve;}));
  vi.stubGlobal('fetch', fetcher); render(<HookProbe/>); await tick();
  visibility('hidden'); visibility('visible'); visibility('hidden'); visibility('visible');
  await tick(1000); expect(fetcher).toHaveBeenCalledOnce();
  await act(async () => finish(empty()));
  await tick(REFRESH_MS - 1); expect(fetcher).toHaveBeenCalledOnce();
  await tick(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([401, 403])('visibility changes do not revive an HTTP %s permission stop', async status => {
  const fetcher = vi.fn(async () => new Response('unavailable', {status})); vi.stubGlobal('fetch', fetcher);
  render(<HookProbe/>); await tick(); visibility('hidden'); visibility('visible'); await tick(180_000);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('does not restart a hidden mount after it has unmounted', async () => {
  visibility('hidden', false); const fetcher = vi.fn(async () => empty()); vi.stubGlobal('fetch', fetcher);
  const view = render(<HookProbe/>); await tick(); view.unmount(); visibility('visible'); await tick(180_000);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([['crypto', KrakenSpot], ['fiat', KrakenFxSpot]] as const)('%s discloses access-driven checks and expiry without inventing a provider error', async (_name, View) => {
  vi.stubGlobal('fetch', vi.fn(async () => empty())); render(<View/>); await tick();
  const notice = screen.getByLabelText('行情检查触发方式');
  expect(notice.textContent).toContain('页面打开且可见');
  expect(notice.textContent).toContain('没有后台持续采集');
  expect(notice.textContent).toContain('15 分钟');
  expect(notice.textContent).toContain('不等于来源拒绝或故障');
});
