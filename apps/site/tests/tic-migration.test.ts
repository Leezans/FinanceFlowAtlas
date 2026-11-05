import {describe, it, expect} from 'vitest';
import {normalize} from '../lib/tic/adapter';
import {normalizeHistory, HISTORY_CACHE_KEY} from '../lib/tic/history';
import {LATEST_CACHE_KEY, legacyCacheKey, seedLegacyCache} from '../lib/tic/migration';
import {readCached, readCachedSource, type CacheRow} from '../lib/tic/cache';
import {historySchema} from '../lib/tic/history';
import {valid} from './tic-fixture';
const time = Date.parse('2026-11-05T03:00:00Z');
function row(snapshot: {version: string}): CacheRow {
 return {payload: JSON.stringify(snapshot), version: snapshot.version, lastAttemptMs: time,
  lastSuccessMs: time, error: null, leaseUntilMs: time + 30000, leaseToken: 'old-owner'};
}
describe('latest-month cache migration', () => {
 it('seeds a validated country snapshot as stale, immediately due, without copying old lease ownership', async () => {
  const snapshot = await normalize(valid(), '2026-08', new Date(time).toISOString());
  const seeded = seedLegacyCache(LATEST_CACHE_KEY, row(snapshot));
  expect(seeded?.version).toBe(snapshot.version); expect(seeded?.lastAttemptMs).toBeNull();
  expect(seeded?.leaseToken).toBeNull(); expect(seeded?.leaseUntilMs).toBe(0);
  const result = readCached(seeded, time);
  expect(result.status.state).toBe('stale'); expect(result.status.error).toContain('verification is pending');
  expect(result.snapshot?.period).toBe('2026-08');
 });
 it('preserves compatible old history with a pending-discovery warning', async () => {
  const history = await normalizeHistory(valid(), new Date(time).toISOString());
  const seeded = seedLegacyCache(HISTORY_CACHE_KEY, row(history));
  expect(seeded?.version).toBe(history.version);
  expect(readCachedSource(seeded, time, value => historySchema.parse(value)).status.state).toBe('stale');
 });
 it('does not migrate corrupt, wrong-kind, unsupported, or empty payloads', async () => {
  const snapshot = await normalize(valid(), undefined, new Date(time).toISOString());
  expect(seedLegacyCache(HISTORY_CACHE_KEY, row(snapshot))).toBeNull();
  expect(seedLegacyCache(LATEST_CACHE_KEY, {...row(snapshot), payload:'invalid json'})).toBeNull();
  expect(seedLegacyCache('unrelated', row(snapshot))).toBeNull();
  expect(seedLegacyCache(LATEST_CACHE_KEY, null)).toBeNull();
  expect(legacyCacheKey(LATEST_CACHE_KEY)).toBe('tic-equity-2026-08');
  expect(legacyCacheKey(HISTORY_CACHE_KEY)).toBe('tic-equity-history-2025-09-2026-08-v1');
 });
});
