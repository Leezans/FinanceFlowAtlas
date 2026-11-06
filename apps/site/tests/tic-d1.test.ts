import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import {ticCache} from '../db/schema';
import {normalize} from '../lib/tic/adapter';
import {normalizeHistory, historySchema, HISTORY_CACHE_KEY, type TicHistory} from '../lib/tic/history';
import {getCachedSource, getTic, DAY_MS} from '../lib/tic/cache';
import {LATEST_CACHE_KEY, legacyCacheKey} from '../lib/tic/migration';
import {valid} from './tic-fixture';
const state = vi.hoisted(() => ({db: null as unknown}));
vi.mock('../db', () => ({getDb: () => state.db}));
import {repository} from '../lib/tic/d1';
let sqlite: DatabaseSync;
let db: ReturnType<typeof drizzle>;
const now = Date.parse('2026-11-05T03:00:00Z');
beforeEach(() => {
 sqlite = new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE tic_snapshot_cache(id TEXT PRIMARY KEY, payload TEXT, version TEXT, last_attempt_ms INTEGER, last_success_ms INTEGER, error TEXT, lease_until_ms INTEGER NOT NULL DEFAULT 0, lease_token TEXT)');
 db = drizzle(async (sql, params, method) => {
  const statement = sqlite.prepare(sql);
  if (method === 'run') {statement.run(...params); return {rows: []};}
  return {rows: statement.all(...params).map(row => Object.values(row))};
 });
 state.db = db;
});
afterEach(() => sqlite.close());
describe('actual SQLite repository migration and publication', () => {
 it.each([LATEST_CACHE_KEY, HISTORY_CACHE_KEY])('seeds %s once, retains it on upstream failure, and immediately attempts discovery', async key => {
  const snapshot = key === LATEST_CACHE_KEY ? await normalize(valid(), '2026-08', new Date(now).toISOString()) : await normalizeHistory(valid(), new Date(now).toISOString());
  await db.insert(ticCache).values({id: legacyCacheKey(key)!, payload: JSON.stringify(snapshot), version: snapshot.version,
   lastAttemptMs: now, lastSuccessMs: now, leaseUntilMs: 0, leaseToken: null});
  const repo = repository(key);
  await Promise.all([repo.ensure(), repo.ensure()]);
  expect((await repo.load())?.lastAttemptMs).toBeNull();
  const failed = vi.fn(async () => new Response('source failed', {status: 503}));
  const result = key === LATEST_CACHE_KEY ? await getTic(repo, failed, now) :
   await getCachedSource(repository<TicHistory>(key), value => historySchema.parse(value), normalizeHistory, failed, now);
  expect(failed).toHaveBeenCalledTimes(1); expect(result.status.state).toBe('stale');
  expect(result.snapshot?.version).toBe(snapshot.version);
  await repo.ensure(); expect((await repo.load())?.lastAttemptMs).toBe(now);
 });
 it('allows exactly one concurrent discovery and rejects stale lease publication', async () => {
  const repo = repository(); await repo.ensure();
  const claimed = await Promise.all([repo.claim(now, 'owner-a'), repo.claim(now, 'owner-b')]);
  expect(claimed.filter(Boolean)).toHaveLength(1);
  const snapshot = await normalize(valid(), undefined, new Date(now).toISOString());
  await expect(repo.success('not-owner', snapshot, now)).rejects.toThrow('not confirmed'); expect((await repo.load())?.payload).toBeNull();
  const owner = claimed[0] ? 'owner-a' : 'owner-b';
  await repo.success(owner, snapshot, now);
  expect((await repo.load())?.version).toBe(snapshot.version);
  expect(await repo.claim(now + DAY_MS - 1, 'too-soon')).toBe(false);
  expect(await repo.claim(now + DAY_MS, 'next-day')).toBe(true);
 });
 it('does not seed malformed legacy data or overwrite an existing latest cache', async () => {
  await db.insert(ticCache).values({id: legacyCacheKey(LATEST_CACHE_KEY)!, payload: 'bad json'});
  const repo = repository(); await repo.ensure(); expect((await repo.load())?.payload).toBeNull();
  expect(await repo.claim(now, 'fresh')).toBe(true);
  const snapshot = await normalize(valid(), undefined, new Date(now).toISOString());
  await repo.success('fresh', snapshot, now); await repo.ensure();
  expect((await repo.load())?.version).toBe(snapshot.version); expect((await repo.load())?.error).toBeNull();
 });
});
