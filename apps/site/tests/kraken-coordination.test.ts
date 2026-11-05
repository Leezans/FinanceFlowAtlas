import {afterEach, describe, expect, it, vi} from 'vitest';
import {createKrakenHandler, KRAKEN_PAIRS_URL, MAX_CACHE_AGE_MS, REFRESH_MS, type KrakenGate, type KrakenReply} from '../lib/crypto/kraken';
import {SourceGateError} from '../lib/ashare/source-gate';
import {catalog} from './kraken-fixture';

const start = Date.parse('2026-11-05T10:00:00Z');
const request = () => new Request('https://test.invalid/api/v1/crypto/kraken/snapshot');
const ticker = () => ({error: [], result: {
  XXBTZUSD: {c: ['1', '1'], v: ['1', '1'], p: ['1', '1'], t: [1, 1]},
  XETHZUSD: {c: ['2', '1'], v: ['1', '1'], p: ['2', '2'], t: [1, 1]},
}});
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(start);
  const gate: KrakenGate = {
    inspect: vi.fn(async () => 'idle' as const),
    acquire: vi.fn(async () => ({token: 'owner'})),
    release: vi.fn(async () => {}),
  };
  const fetcher = vi.fn<typeof fetch>(async input => Response.json(String(input) === KRAKEN_PAIRS_URL ? catalog() : ticker()));
  const handler = createKrakenHandler({gate, fetcher, isolatedForTests: true});
  async function read() {
    const operation = handler(request());
    await vi.advanceTimersByTimeAsync(1_101);
    return await (await operation).json() as KrakenReply;
  }
  return {gate, fetcher, handler, read};
}
afterEach(() => vi.useRealTimers());

describe('Kraken shared cooldown is coordination, not a provider failure', () => {
  it.each(['source_busy', 'source_cooldown'] as const)('keeps repeated %s checks at one minute and recovers at the next eligible check', async code => {
    const t = setup();
    vi.mocked(t.gate.acquire).mockRejectedValue(new SourceGateError(code));
    for (let attempt = 0; attempt < 6; attempt++) {
      const at = Date.now(), result = await t.read();
      expect(result).toMatchObject({snapshot: null, status: {state: 'unavailable', error_code: code}});
      expect(Date.parse(result.status.next_retry_at!)).toBe(at + REFRESH_MS);
      expect(t.gate.acquire).toHaveBeenCalledTimes(attempt + 1);
      expect(t.fetcher).not.toHaveBeenCalled();
      expect(t.gate.release).not.toHaveBeenCalled();
      // Repeated/manual callers still cannot skip the minimum local pause.
      await t.handler(request());
      expect(t.gate.acquire).toHaveBeenCalledTimes(attempt + 1);
      await vi.advanceTimersByTimeAsync(REFRESH_MS - 1_101);
    }
    vi.mocked(t.gate.acquire).mockResolvedValue({token: 'owner'});
    expect(await t.read()).toMatchObject({status: {state: 'available', error_code: null}, snapshot: {source_observed_at: null}});
    expect(t.fetcher).toHaveBeenCalledTimes(2);
    expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner', {kind: 'success'});
  });

  it.each(['source_busy', 'source_cooldown'] as const)('does not inflate or reset actual failure history when %s intervenes', async code => {
    const t = setup();
    t.fetcher.mockImplementation(async () => Response.json({}, {status: 503}));
    const firstAt = Date.now(), first = await t.read();
    expect(Date.parse(first.status.next_retry_at!)).toBe(firstAt + REFRESH_MS);
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1_101);
    vi.mocked(t.gate.acquire).mockRejectedValue(new SourceGateError(code));
    const coordinationAt = Date.now(), coordination = await t.read();
    expect(Date.parse(coordination.status.next_retry_at!)).toBe(coordinationAt + REFRESH_MS);
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1_101);
    vi.mocked(t.gate.acquire).mockResolvedValue({token: 'owner'});
    const secondAt = Date.now(), second = await t.read();
    expect(second.status.error_code).toBe('upstream_http');
    expect(Date.parse(second.status.next_retry_at!)).toBe(secondAt + 2 * REFRESH_MS);
    expect(t.gate.release).toHaveBeenLastCalledWith('owner', {kind: 'temporary_failure', retryAfterMs: 2 * REFRESH_MS});
  });

  it('retains the original quote clock, marks contention stale, and never extends cache expiry', async () => {
    const t = setup(), first = await t.read();
    const fetched = first.snapshot!.fetched_at;
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    vi.mocked(t.gate.acquire).mockRejectedValue(new SourceGateError('source_cooldown'));
    const next = await t.read();
    expect(next).toMatchObject({snapshot: {fetched_at: fetched, source_observed_at: null}, status: {state: 'stale', error_code: 'source_cooldown'}});
    await vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS);
    expect(await t.read()).toMatchObject({snapshot: null, status: {state: 'unavailable'}});
    expect(t.fetcher).toHaveBeenCalledTimes(2);
  });

  it('continues honoring the provider Retry-After without early gate or source requests', async () => {
    const t = setup(), pause = 1_800_000;
    t.fetcher.mockImplementation(async () => Response.json({}, {status: 503, headers: {'Retry-After': String(pause / 1_000)}}));
    const result = await t.read();
    expect(Date.parse(result.status.next_retry_at!)).toBe(start + pause);
    await vi.advanceTimersByTimeAsync(10 * REFRESH_MS);
    await t.handler(request());
    expect(t.gate.acquire).toHaveBeenCalledTimes(1);
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    expect(t.gate.release).toHaveBeenCalledExactlyOnceWith('owner', {kind: 'temporary_failure', retryAfterMs: pause});
  });

  it('never reopens an explicit denial after a coordinating response', async () => {
    const t = setup();
    vi.mocked(t.gate.acquire).mockRejectedValueOnce(new SourceGateError('source_busy'));
    await t.read(); await vi.advanceTimersByTimeAsync(REFRESH_MS);
    vi.mocked(t.gate.acquire).mockRejectedValue(new SourceGateError('source_denied'));
    expect(await t.read()).toMatchObject({snapshot: null, status: {state: 'denied', next_retry_at: null}});
    await vi.advanceTimersByTimeAsync(100 * MAX_CACHE_AGE_MS);
    vi.mocked(t.gate.acquire).mockResolvedValue({token: 'owner'});
    expect(await t.read()).toMatchObject({snapshot: null, status: {state: 'denied'}});
    expect(t.gate.acquire).toHaveBeenCalledTimes(2);
    expect(t.fetcher).not.toHaveBeenCalled();
  });
});
