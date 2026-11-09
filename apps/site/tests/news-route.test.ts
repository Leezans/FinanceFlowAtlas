import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsSnapshot } from '@/lib/news/types';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/news/host', () => ({ loadNewsSnapshot: load }));
import { GET } from '@/app/api/news/route';
const snapshot = (status: NewsSnapshot['status']): NewsSnapshot => ({
  schemaVersion: 1, status, generatedAt: '2026-11-09T10:00:00.000Z', news: [], events: [], sources: [],
  cacheTtlSeconds: 900, maxStaleSeconds: 86400,
  dedup: { newsRemoved: 0, eventsRemoved: 0, method: 'canonical-url; events additionally use identity and start' },
  disclaimer: 'Synthetic fixture only',
});
beforeEach(() => load.mockReset());
describe('news route HTTP contract', () => {
  it.each(['ok', 'partial'] as const)('returns 200 with no-store for %s without hiding source status', async (state) => {
    load.mockResolvedValue(snapshot(state));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual(snapshot(state));
  });
  it('returns the structured source-failure payload with 503 when unavailable', async () => {
    load.mockResolvedValue(snapshot('unavailable'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'unavailable' });
  });
});
