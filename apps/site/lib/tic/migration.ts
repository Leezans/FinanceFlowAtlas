import {snapshotSchema} from './adapter';
import {historySchema, HISTORY_CACHE_KEY} from './history';
import type {CacheRow} from './cache';

export const LATEST_CACHE_KEY = 'tic-equity-latest-v2';
export function legacyCacheKey(key: string): string | null {
 return key === LATEST_CACHE_KEY ? 'tic-equity-2026-08' :
  key === HISTORY_CACHE_KEY ? 'tic-equity-history-2025-09-2026-08-v1' : null;
}

/** Preserve validated last-good data, but require a fresh discovery check before calling it available. */
export function seedLegacyCache(key: string, row: CacheRow | null): CacheRow | null {
 if (!legacyCacheKey(key) || !row?.payload) return null;
 try {
  const value: unknown = JSON.parse(row.payload);
  const snapshot = key === LATEST_CACHE_KEY ? snapshotSchema.parse(value) : historySchema.parse(value);
  return {payload: JSON.stringify(snapshot), version: snapshot.version, lastAttemptMs: null,
   lastSuccessMs: row.lastSuccessMs, error: 'Previous fixed-window snapshot; latest source month verification is pending.',
   leaseUntilMs: 0, leaseToken: null};
 } catch {return null;}
}
