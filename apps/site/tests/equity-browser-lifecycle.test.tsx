// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, renderHook} from '@testing-library/react';
import {useEquitySnapshot} from '../hooks/useEquitySnapshot';
import {MAX_CACHE_AGE_MS, REFRESH_MS} from '../lib/equity/model';
import {NOW, reply} from './equity-fixture';

const tick = (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms));
function visibility(value: 'visible' | 'hidden', emit = true) {
  Object.defineProperty(document, 'visibilityState', {value, configurable: true});
  if (emit) fireEvent(document, new Event('visibilitychange'));
}
function shortReply() {
  const body = reply();
  body.status.next_retry_at = new Date(NOW + 60_000).toISOString();
  return body;
}
beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(NOW); visibility('visible', false);});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); visibility('visible', false);});

describe('annual equity browser lifecycle', () => {
  it.each(['fetch', 'body'] as const)('settles a hung %s at exactly 35 seconds and retries after a minute', async stage => {
    const f = vi.fn<typeof fetch>().mockImplementationOnce(() => stage === 'fetch' ? new Promise(() => {}) :
      Promise.resolve({status: 200, headers: new Headers(), json: () => new Promise(() => {})} as Response))
      .mockImplementation(async () => Response.json(reply()));
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot);
    await tick(34_999); expect(result.current.loading).toBe(true); expect(result.current.failure).toBeNull();
    await tick(1); expect(result.current.loading).toBe(false); expect(result.current.failure).toBe('network');
    expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
    act(() => {void result.current.refresh();}); visibility('hidden'); visibility('visible');
    await tick(59_999); expect(f).toHaveBeenCalledOnce();
    await tick(1); expect(f).toHaveBeenCalledTimes(2); expect(result.current.snapshot).not.toBeNull();
  });

  it('does not admit hidden initial/manual checks, and rerendering does not restart its stable parser', async () => {
    visibility('hidden', false); const f = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', f);
    const view = renderHook(useEquitySnapshot); await tick();
    act(() => {void view.result.current.refresh();}); expect(f).not.toHaveBeenCalled();
    visibility('visible'); await tick(); expect(f).toHaveBeenCalledOnce();
    view.rerender(); await tick(); expect(f).toHaveBeenCalledOnce();
  });

  it('enforces the daily successful deadline across repeated clicks and wakes', async () => {
    const f = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', f);
    const {result} = renderHook(useEquitySnapshot); await tick();
    expect(result.current.coolingDown).toBe(true); expect(result.current.nextDeadline).toBe(NOW + REFRESH_MS);
    for (let i = 0; i < 3; i++) {act(() => {void result.current.refresh();}); visibility('hidden'); visibility('visible');}
    await tick(REFRESH_MS - 2); expect(f).toHaveBeenCalledOnce();
    await tick(1); expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([[120, 300], [300, 120]])('uses the later of Retry-After %s and structured deadline %s seconds', async (header, seconds) => {
    const body = reply(); body.status.next_retry_at = new Date(NOW + seconds * 1000).toISOString();
    const f = vi.fn(async () => Response.json(body, {headers: {'Retry-After': String(header)}})); vi.stubGlobal('fetch', f);
    const {result} = renderHook(useEquitySnapshot); await tick(); expect(result.current.nextDeadline).toBe(NOW + 300_000);
    act(() => {void result.current.refresh();}); visibility('hidden'); visibility('visible');
    await tick(299_998); expect(f).toHaveBeenCalledOnce(); await tick(1); expect(f).toHaveBeenCalledTimes(2);
  });

  it.each(['3600', new Date(NOW + 3600_000).toUTCString()])('preserves header %s even when the body times out', async header => {
    const f = vi.fn(async () => ({status: 503, headers: new Headers({'Retry-After': header}), json: () => new Promise(() => {})}) as Response);
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(35_000);
    expect(result.current.failure).toBe('network'); expect(result.current.nextDeadline).toBe(NOW + 3600_000);
    visibility('hidden'); visibility('visible'); await tick(3600_000 - 35_001); expect(f).toHaveBeenCalledOnce();
    await tick(1); expect(f).toHaveBeenCalledTimes(2);
  });

  it('recovers from source_busy after one minute rather than one day', async () => {
    const body = reply(); body.snapshot = null; body.status = {...body.status, state: 'unavailable', error_code: 'source_busy', next_retry_at: new Date(NOW + 60_000).toISOString()};
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body, {status: 503})).mockImplementation(async () => Response.json(reply()));
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(59_999);
    expect(result.current.snapshot).toBeNull(); expect(f).toHaveBeenCalledOnce();
    await tick(1); expect(f).toHaveBeenCalledTimes(2); expect(result.current.snapshot).not.toBeNull();
  });

  it.each(['JSON 503', 'non-JSON 503', 'invalid 200'] as const)('handles %s without confusing gateway errors with invalid evidence', async kind => {
    const error = kind === 'non-JSON 503' ? new Response('upstream unavailable', {status: 503}) : Response.json({error: 'temporary'}, {status: kind === 'invalid 200' ? 200 : 503});
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(shortReply())).mockResolvedValue(error);
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(); expect(result.current.snapshot).not.toBeNull();
    await tick(59_999); expect(f).toHaveBeenCalledTimes(2);
    expect(result.current.failure).toBe(kind === 'invalid 200' ? 'invalid' : 'network');
    if (kind === 'invalid 200') expect(result.current.snapshot).toBeNull();
    else {expect(result.current.snapshot?.fetched_at).toBe(new Date(NOW).toISOString()); expect(result.current.stale).toBe(true);}
  });

  it.each([{status: 401}, {status: 403}, {status: 407}, {status: 451}, {status: 302}, {status: 200, redirected: true}, {status: 0, type: 'opaqueredirect'}])('clears and stops access response %j before parsing the body', async response => {
    const json = vi.fn(() => new Promise(() => {}));
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(shortReply()))
      .mockResolvedValue({...response, headers: new Headers(), json} as unknown as Response);
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(); expect(result.current.snapshot).not.toBeNull();
    await tick(59_999); expect(result.current.failure).toBe('permission'); expect(result.current.snapshot).toBeNull(); expect(json).not.toHaveBeenCalled();
    act(() => {void result.current.refresh();}); visibility('hidden'); visibility('visible'); await tick(180_000); expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps a validated source denial terminal and clears prior evidence', async () => {
    const denied = reply(); denied.snapshot = null; denied.status = {...denied.status, state: 'denied', error_code: 'source_denied', next_retry_at: null};
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(shortReply())).mockResolvedValue(Response.json(denied, {status: 503}));
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(60_000);
    expect(result.current.denied).toBe(true); expect(result.current.snapshot).toBeNull();
    act(() => {void result.current.refresh();}); visibility('hidden'); visibility('visible'); await tick(180_000); expect(f).toHaveBeenCalledTimes(2);
  });

  it.each(['fetch', 'body'] as const)('ignores late %s completion after timeout and newer success', async stage => {
    let finish!: (value: never) => void;
    const pending = new Promise<never>(resolve => {finish = resolve;});
    const f = vi.fn<typeof fetch>().mockImplementationOnce(() => stage === 'fetch' ? pending : Promise.resolve({status: 200, headers: new Headers(), json: () => pending} as unknown as Response))
      .mockImplementation(async () => Response.json(reply()));
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(95_000);
    expect(result.current.snapshot).not.toBeNull();
    const late = reply(); late.snapshot = null; late.status = {...late.status, state: 'denied', next_retry_at: null};
    await act(async () => finish((stage === 'fetch' ? Response.json(late, {status: 503}) : late) as never));
    expect(result.current.denied).toBe(false); expect(result.current.snapshot).not.toBeNull(); expect(f).toHaveBeenCalledTimes(2);
  });

  it('allows admitted work to finish hidden without starting its due successor', async () => {
    let finish!: (value: Response) => void;
    const f = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => {finish = resolve;})).mockImplementation(async () => Response.json(reply()));
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(); visibility('hidden');
    expect(f.mock.calls[0][1]?.signal?.aborted).toBe(false); await act(async () => finish(Response.json(shortReply())));
    expect(result.current.snapshot).not.toBeNull(); await tick(60_000); expect(f).toHaveBeenCalledOnce();
    visibility('visible'); await tick(); expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not extend the original seven-day expiry after a retained response or network failure', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(shortReply())).mockResolvedValueOnce(Response.json(shortReply())).mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot); await tick(120_000);
    expect(f).toHaveBeenCalledTimes(3); expect(result.current.failure).toBe('network'); expect(result.current.stale).toBe(true);
    visibility('hidden'); vi.setSystemTime(NOW + MAX_CACHE_AGE_MS - 30_000); await tick(30_000);
    expect(result.current.snapshot).not.toBeNull(); await tick(30_000); expect(result.current.snapshot).toBeNull(); expect(f).toHaveBeenCalledTimes(3);
  });

  it('aborts on unmount, ignores late success and rejects a retained refresh callback', async () => {
    let finish!: (value: Response) => void; const f = vi.fn<typeof fetch>(() => new Promise(resolve => {finish = resolve;}));
    vi.stubGlobal('fetch', f); const view = renderHook(useEquitySnapshot); await tick(); const refresh = view.result.current.refresh;
    view.unmount(); expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => {finish(Response.json(reply())); await refresh();}); await tick(120_000); expect(f).toHaveBeenCalledOnce();
  });

  it('uses the daily fallback cadence when a successful reply omits its deadline', async () => {
    const body = reply(); body.status.next_retry_at = null;
    const f = vi.fn(async () => Response.json(body)); vi.stubGlobal('fetch', f); renderHook(useEquitySnapshot);
    await tick(REFRESH_MS - 1); expect(f).toHaveBeenCalledOnce(); await tick(1); expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps a finite minimum pause for a syntactically valid but impossible UTC offset', async () => {
    const body = reply(); body.status.next_retry_at = '2026-11-06T10:00:00+99:99';
    const f = vi.fn(async () => Response.json(body)); vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot);
    await tick(59_999); expect(result.current.nextDeadline).toBe(NOW + 60_000); expect(f).toHaveBeenCalledOnce();
    await tick(1); expect(f).toHaveBeenCalledTimes(2);
  });

  it('chunks a 40-day deadline without requesting at the timer overflow boundary', async () => {
    // Disable only the display clock so this scheduler test does not render 115,200 ticks.
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as unknown as typeof setInterval);
    const timers = vi.spyOn(globalThis, 'setTimeout'), body = reply(), delay = 40 * REFRESH_MS;
    body.status.next_retry_at = new Date(NOW + delay).toISOString();
    const f = vi.fn(async () => Response.json(body)); vi.stubGlobal('fetch', f); const {result} = renderHook(useEquitySnapshot);
    await tick(); expect(result.current.nextDeadline).toBe(NOW + delay);
    await tick(2_147_483_646); expect(f).toHaveBeenCalledOnce();
    await tick(delay - 2_147_483_648); expect(f).toHaveBeenCalledOnce();
    await tick(1); expect(f).toHaveBeenCalledTimes(2);
    expect(timers.mock.calls.every(call => typeof call[1] !== 'number' || call[1] <= 2_147_483_647)).toBe(true);
  });
});
