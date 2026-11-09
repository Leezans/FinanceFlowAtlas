import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEWS_SOURCES } from '@/lib/news/sources';
import { NewsService, NEWS_CACHE_TTL_MS, NEWS_MAX_STALE_MS, NEWS_FETCH_TIMEOUT_MS } from '@/lib/news/service';
import { FixtureNewsGate } from './news-gate-fixture';
import { atom, calendar, NEWS_NOW, rss, rssItem, sourceBody, vevent } from './news-ingestion-fixture';

function setup() {
  let now = Date.parse(NEWS_NOW);
  const fetcher = vi.fn<typeof fetch>(async (input) => new Response(sourceBody(String(input))));
  const gate = new FixtureNewsGate(() => now);
  const service = new NewsService(fetcher, () => new Date(now), gate);
  return { fetcher, service, gate, advance: (ms: number) => { now += ms; }, now: () => now };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bounded official-source acquisition and freshness', () => {
  it('fails closed without an injected database gate', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const snapshot = await new NewsService(fetcher, () => new Date(NEWS_NOW)).snapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.news).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(snapshot.sources.every(source => source.lastAttemptAt === null)).toBe(true);
  });
  it('suppresses cached evidence after another service records a durable denial', async () => {
    const { fetcher, service, gate, advance, now } = setup();
    await service.snapshot();
    advance(NEWS_CACHE_TTL_MS + 1);
    const otherFetch = vi.fn<typeof fetch>(async () => new Response('denied', { status: 403 }));
    const other = new NewsService(otherFetch, () => new Date(now()), gate);
    const denied = await other.snapshot();
    advance(86400000);
    const original = await service.snapshot();
    expect(original.news).toEqual([]);
    expect(original.events).toEqual([]);
    expect(original.sources.every(source => source.halted)).toBe(true);
    expect(original.sources.map(source => source.lastAttemptAt)).toEqual(denied.sources.map(source => source.lastAttemptAt));
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('does not take over an old busy source or serve its previous evidence', async () => {
    const { fetcher, service, gate, advance } = setup();
    await service.snapshot();
    advance(NEWS_CACHE_TTL_MS + 1);
    for (const source of NEWS_SOURCES) await gate.acquire(source);
    const attemptedAt = (await gate.inspect(NEWS_SOURCES[0])).attemptedAt;
    advance(30 * 86400000);
    const snapshot = await service.snapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.news).toEqual([]);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.sources[0].lastAttemptAt).toBe(new Date(attemptedAt).toISOString());
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('makes six allowlisted requests and serves cache without claiming live publication', async () => {
    const { fetcher, service } = setup();
    const first = await service.snapshot();
    expect(first.status).toBe('ok');
    expect(first.news).toHaveLength(5);
    expect(first.events).toHaveLength(1);
    expect(first.sources).toHaveLength(6);
    expect(first.events[0].publishedAt).toBeNull();
    expect(first.sources[0].fetchedAt).toBe(NEWS_NOW);
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(NEWS_SOURCES.map((source) => source.url));
    for (const call of fetcher.mock.calls) expect(call[1]).toMatchObject({ redirect: 'manual', cache: 'no-store' });
  });
  it('coalesces concurrent requests for each source', async () => {
    const { fetcher, service } = setup();
    await Promise.all(Array.from({ length: 8 }, () => service.snapshot()));
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('isolates a failing source without returning invented records', async () => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async (url) => String(url) === NEWS_SOURCES[3].url ? new Response('busy', { status: 503 }) : new Response(sourceBody(String(url))));
    const snapshot = await service.snapshot();
    expect(snapshot.status).toBe('partial');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.sources[3]).toMatchObject({ status: 'error', fetchedAt: null, itemCount: 0, halted: false });
  });
  it('retains timestamped last-good evidence for transient failure then expires it', async () => {
    const { fetcher, service, advance } = setup();
    await service.snapshot();
    advance(NEWS_CACHE_TTL_MS + 1);
    fetcher.mockRejectedValue(new Error('network down'));
    const stale = await service.snapshot();
    expect(stale.status).toBe('partial');
    expect(stale.news).toHaveLength(5);
    expect(stale.sources.every((source) => source.status === 'stale' && source.fetchedAt === NEWS_NOW)).toBe(true);
    advance(NEWS_MAX_STALE_MS);
    const expired = await service.snapshot();
    expect(expired.status).toBe('unavailable');
    expect(expired.news).toEqual([]);
    expect(expired.events).toEqual([]);
  });
  it.each([401, 403, 451, 302])('suppresses stale rows and stops after explicit denial/redirect %s', async (status) => {
    const { fetcher, service, advance } = setup();
    await service.snapshot();
    advance(NEWS_CACHE_TTL_MS + 1);
    fetcher.mockImplementation(async () => new Response('denied', { status }));
    const denied = await service.snapshot();
    expect(denied.status).toBe('unavailable');
    expect(denied.news).toEqual([]);
    expect(denied.sources.every((source) => source.halted && source.nextRefreshAt === null)).toBe(true);
    advance(2 * NEWS_MAX_STALE_MS);
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(12);
  });
  it.each(['reject', 'hang'])('never converts known denial to transient failure if cancellation %s', async (mode) => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({ cancel: () => mode === 'reject' ? Promise.reject(new Error('cancel failed')) : new Promise(() => undefined) }), { status: 403 }));
    const snapshot = await service.snapshot();
    expect(snapshot.sources.every((source) => source.halted)).toBe(true);
    expect(snapshot.sources[0].error).toContain('403');
  });
  it('halts on an HTML access challenge, without following alternate routes', async () => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async () => new Response('<html><title>Just a moment</title>Verify you are human</html>', { headers: { 'content-type': 'text/html' } }));
    const snapshot = await service.snapshot();
    expect(snapshot.sources.every((source) => source.halted)).toBe(true);
    expect(snapshot.news).toHaveLength(0);
  });
  it('honors Retry-After seconds even if cancellation rejects', async () => {
    const { fetcher, service, advance } = setup();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({ cancel: () => Promise.reject(new Error('cancel failed')) }), { status: 429, headers: { 'Retry-After': '3600' } }));
    const snapshot = await service.snapshot();
    expect(snapshot.sources[0].nextRefreshAt).toBe('2026-11-09T11:00:00.000Z');
    advance(NEWS_CACHE_TTL_MS + 1);
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(6);
    advance(3600000);
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(12);
  });
  it('honors Retry-After HTTP-date and cannot leak expired last-good on long cooldown', async () => {
    const { fetcher, service, advance } = setup();
    await service.snapshot();
    advance(NEWS_CACHE_TTL_MS + 1);
    fetcher.mockImplementation(async () => new Response('busy', { status: 503, headers: { 'Retry-After': 'Wed, 11 Nov 2026 12:00:00 GMT' } }));
    await service.snapshot();
    advance(NEWS_MAX_STALE_MS);
    const expired = await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(expired.news).toHaveLength(0);
    expect(expired.status).toBe('unavailable');
    expect(expired.sources[0].nextRefreshAt).toBe('2026-11-11T12:00:00.000Z');
  });
  it('preserves absolute Retry-After against a skewed application clock', async () => {
    const dbNow = Date.parse(NEWS_NOW);
    const gate = new FixtureNewsGate(() => dbNow);
    const fetcher = vi.fn<typeof fetch>(async () => new Response('busy', {
      status: 503, headers: { 'Retry-After': 'Mon, 09 Nov 2026 12:00:00 GMT' },
    }));
    const service = new NewsService(fetcher, () => new Date(dbNow + 3600000), gate);
    const snapshot = await service.snapshot();
    expect(snapshot.sources.every(source => source.nextRefreshAt === '2026-11-09T12:00:00.000Z')).toBe(true);
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it.each(['declared', 'streamed'])('rejects %s oversized payloads', async (mode) => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async () => new Response(mode === 'streamed' ? 'x'.repeat(1_048_577) : '', { headers: mode === 'declared' ? { 'Content-Length': '1048577' } : {} }));
    const snapshot = await service.snapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.sources[0].error).toContain('1 MiB');
  });
  it('bounds the whole request including a body that never finishes', async () => {
    vi.useFakeTimers();
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_FETCH_TIMEOUT_MS + 1);
    const snapshot = await pending;
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.sources[0].error).toContain('超时');
  });
  it.each([200, 403])('keeps late fetch HTTP %s quarantined after timeout without another request', async (status) => {
    vi.useFakeTimers();
    const { fetcher, service, gate, advance } = setup();
    const finish: (() => void)[] = [];
    fetcher.mockImplementation((url) => new Promise(resolve => {
      finish.push(() => resolve(new Response(status === 200 ? sourceBody(String(url)) : 'denied', { status })));
    }));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_FETCH_TIMEOUT_MS + 1);
    expect((await pending).status).toBe('unavailable');
    for (const resolve of finish) resolve();
    await vi.advanceTimersByTimeAsync(0);
    advance(30 * 86400000);
    const second = await service.snapshot();
    expect(second.news).toEqual([]);
    expect(second.events).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect([...gate.rows.values()].every(row => row.state === 'busy')).toBe(true);
  });
  it('keeps a late body completion quarantined after timeout', async () => {
    vi.useFakeTimers();
    const { fetcher, service, gate, advance } = setup();
    const finish: (() => void)[] = [];
    fetcher.mockImplementation(async (url) => new Response(new ReadableStream({
      start(controller) {
        finish.push(() => { try { controller.enqueue(new TextEncoder().encode(sourceBody(String(url)))); controller.close(); } catch { /* already cancelled */ } });
      },
    })));
    const pending = service.snapshot();
    await vi.advanceTimersByTimeAsync(NEWS_FETCH_TIMEOUT_MS + 1);
    expect((await pending).status).toBe('unavailable');
    for (const complete of finish) complete();
    await vi.advanceTimersByTimeAsync(0);
    advance(30 * 86400000);
    expect((await service.snapshot()).status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect([...gate.rows.values()].every(row => row.state === 'busy')).toBe(true);
  });
  it('deduplicates only canonical news URLs, not equal headlines or calendar URLs', async () => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async (url) => {
      if (String(url) === NEWS_SOURCES[0].url) return new Response(rss(rssItem() + rssItem('https://www.federalreserve.gov/newsevents/pressreleases/example.htm?utm_source=x') + rssItem('https://www.federalreserve.gov/newsevents/pressreleases/other.htm')));
      if (String(url) === NEWS_SOURCES[3].url) return new Response(calendar(vevent('a') + '\n' + vevent('b')));
      return new Response(sourceBody(String(url)));
    });
    const snapshot = await service.snapshot();
    expect(snapshot.dedup.newsRemoved).toBe(1);
    expect(snapshot.news.filter((item) => item.sourceId === NEWS_SOURCES[0].id)).toHaveLength(2);
    expect(snapshot.events).toHaveLength(2);
  });
  it('filters old/future-dated news and past/distant events again on cached requests', async () => {
    const { fetcher, service, advance } = setup();
    fetcher.mockImplementation(async (url) => {
      if (String(url) === NEWS_SOURCES[0].url) return new Response(rss(rssItem(undefined, '2025-01-01') + rssItem('https://www.federalreserve.gov/future', '2027-01-01')));
      if (String(url) === NEWS_SOURCES[3].url) return new Response(calendar(vevent('past', 'DTSTART:20261108T130000Z') + '\n' + vevent('soon', 'DTSTART:20261109T100100Z') + '\n' + vevent('distant', 'DTSTART:20271109T130000Z')));
      return new Response(sourceBody(String(url)));
    });
    const first = await service.snapshot();
    expect(first.news.some((item) => item.sourceId === NEWS_SOURCES[0].id)).toBe(false);
    expect(first.events).toHaveLength(1);
    advance(120000);
    expect((await service.snapshot()).events).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('limits output per source while sorting before truncation', async () => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async (url) => String(url) === NEWS_SOURCES[0].url
      ? new Response(rss(Array.from({ length: 80 }, (_, i) => rssItem(`https://www.federalreserve.gov/item/${i}`)).join('')))
      : new Response(sourceBody(String(url))));
    const snapshot = await service.snapshot();
    expect(snapshot.news.filter((item) => item.sourceId === NEWS_SOURCES[0].id)).toHaveLength(60);
  });
  it('treats malformed input as source failure and empty valid input as empty success', async () => {
    const { fetcher, service } = setup();
    fetcher.mockImplementation(async (url) => new Response(String(url) === NEWS_SOURCES[0].url ? '<rss><broken>' : String(url) === NEWS_SOURCES[1].url ? rss('') : String(url) === NEWS_SOURCES[2].url ? atom() : calendar('')));
    const snapshot = await service.snapshot();
    expect(snapshot.status).toBe('partial');
    expect(snapshot.sources[0].status).toBe('error');
    expect(snapshot.sources[1]).toMatchObject({ status: 'ok', itemCount: 0 });
    expect(snapshot.sources[3]).toMatchObject({ status: 'ok', itemCount: 0 });
  });
});
