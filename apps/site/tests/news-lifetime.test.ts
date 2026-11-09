import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsService, NEWS_FETCH_TIMEOUT_MS, NEWS_OPERATION_TIMEOUT_MS } from '@/lib/news/service';
import { FixtureNewsGate } from './news-gate-fixture';
import { NEWS_NOW, sourceBody } from './news-ingestion-fixture';
function setup() {
  vi.useFakeTimers();
  let now = Date.parse(NEWS_NOW);
  const gate = new FixtureNewsGate(() => now);
  const release = vi.spyOn(gate, 'release');
  const acquire = vi.spyOn(gate, 'acquire');
  const finish: (() => void)[] = [];
  const retained: Promise<unknown>[] = [];
  const waitUntil = vi.fn((work: Promise<unknown>) => { retained.push(work); });
  const fetcher = vi.fn<typeof fetch>();
  const service = new NewsService(fetcher, () => new Date(now), gate, waitUntil);
  return { gate, release, acquire, finish, retained, waitUntil, fetcher, service, advance: (ms: number) => { now += ms; } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('retained news operation lifetime', () => {
  it.each([200, 401, 403, 451, 302, 429, 503])('finalizes late HTTP %s exactly once under the original lease', async status => {
    const ctx = setup();
    const { fetcher, finish, service, gate, release, retained } = ctx;
    fetcher.mockImplementation(url => new Promise(resolve => finish.push(() => resolve(new Response(status === 200 ? sourceBody(String(url)) : 'synthetic', { status, headers: { 'Retry-After': '3600' } })))));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_FETCH_TIMEOUT_MS + 1);
    expect((await pending).status).toBe('unavailable');
    expect(release).not.toHaveBeenCalled();
    await Promise.all([service.snapshot(), new NewsService(fetcher, () => new Date(NEWS_NOW), gate).snapshot()]);
    expect(fetcher).toHaveBeenCalledTimes(11);
    finish.forEach(resolve => resolve());
    await Promise.all(retained);
    expect(release).toHaveBeenCalledTimes(11);
    const result = await service.snapshot();
    if (status === 200) expect(result.status).toBe('ok');
    else if ([401, 403, 451, 302].includes(status)) {
      expect(result.sources.every(source => source.halted)).toBe(true);
      ctx.advance(30 * 86400000);
      await service.snapshot();
    } else expect(result.sources.every(source => source.nextRefreshAt === '2026-11-09T11:00:00.000Z')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(11);
    expect(release).toHaveBeenCalledTimes(11);
    expect(ctx.acquire).toHaveBeenCalledTimes(11);
  });
  it.each(['valid', 'challenge', 'oversized', 'malformed'])('validates late body before publishing or blocking: %s', async kind => {
    const { fetcher, finish, service, retained, release } = setup();
    fetcher.mockImplementation(async url => new Response(new ReadableStream({ start(controller) {
      finish.push(() => {
        controller.enqueue(new TextEncoder().encode(kind === 'valid' ? sourceBody(String(url)) : kind === 'challenge' ? '<html>Access denied</html>' : kind === 'oversized' ? 'x'.repeat(1_048_577) : '<rss><broken>'));
        controller.close();
      });
    } })));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_FETCH_TIMEOUT_MS + 1);
    expect((await pending).news).toEqual([]);
    expect(release).not.toHaveBeenCalled();
    finish.forEach(resolve => resolve());
    await Promise.all(retained);
    const result = await service.snapshot();
    if (kind === 'valid') expect(result.status).toBe('ok');
    else if (kind === 'challenge') expect(result.sources.every(source => source.halted)).toBe(true);
    else { expect(result.status).toBe('unavailable'); expect(result.sources.every(source => !source.halted)).toBe(true); }
    expect(release).toHaveBeenCalledTimes(11);
  });
  it.each(['fetch', 'fetch-denied', 'body'])('quarantines hung %s at hard deadline even after late completion', async kind => {
    const { fetcher, finish, service, gate, retained, release, advance } = setup();
    fetcher.mockImplementation(url => kind.startsWith('fetch') ? new Promise(resolve => {
      finish.push(() => resolve(new Response(kind === 'fetch-denied' ? 'denied' : sourceBody(String(url)), { status: kind === 'fetch-denied' ? 403 : 200 })));
    }) : Promise.resolve(new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }))));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_OPERATION_TIMEOUT_MS + 1);
    expect((await pending).status).toBe('unavailable');
    await Promise.all(retained);
    finish.forEach(resolve => resolve());
    await vi.advanceTimersByTimeAsync(0);
    advance(30 * 86400000);
    await service.snapshot();
    expect(release).not.toHaveBeenCalled();
    expect([...gate.rows.values()].every(row => row.state === 'busy')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(11);
  });
  it('does not admit requests when waitUntil registration throws', async () => {
    const { waitUntil, service, acquire, fetcher } = setup();
    waitUntil.mockImplementation(() => { throw new Error('no execution context'); });
    expect((await service.snapshot()).status).toBe('unavailable');
    expect(acquire).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([false, true])('does not retry late release acknowledgement loss (committed=%s)', async committed => {
    const { fetcher, finish, service, gate, release, retained } = setup();
    release.mockImplementation(async (...args) => {
      if (committed) await FixtureNewsGate.prototype.release.apply(gate, args);
      throw new Error('acknowledgement lost');
    });
    fetcher.mockImplementation(url => new Promise(resolve => finish.push(() => resolve(new Response(sourceBody(String(url)))))));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_FETCH_TIMEOUT_MS + 1);
    await pending;
    finish.forEach(resolve => resolve());
    await Promise.all(retained);
    expect(release).toHaveBeenCalledTimes(11);
    expect([...gate.rows.values()].every(row => row.state === (committed ? 'idle' : 'busy'))).toBe(true);
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(11);
    expect(release).toHaveBeenCalledTimes(11);
  });
  it('does not fetch after unknown acquisition acknowledgement', async () => {
    const { acquire, gate, service, fetcher, release } = setup();
    acquire.mockImplementation(async source => {
      await FixtureNewsGate.prototype.acquire.call(gate, source);
      throw new Error('acknowledgement lost');
    });
    expect((await service.snapshot()).status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect([...gate.rows.values()].every(row => row.state === 'busy')).toBe(true);
  });
});
