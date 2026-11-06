import {and, eq, lte, sql} from 'drizzle-orm';
import {ticCache} from '@/db/schema';
import type {getDb} from '@/db';

/** Dedicated metadata row in the existing cache table; never stores financial observations. */
export const TIC_SOURCE_GATE_KEY = 'tic-treasury-source-gate-v1';
const legacyDenial = sql`EXISTS (SELECT 1 FROM tic_snapshot_cache WHERE id IN ('tic-equity-latest-v2','tic-equity-history-latest-12-v2','tic-equity-2026-08','tic-equity-history-2025-09-2026-08-v1') AND (error LIKE '%HTTP 401%' OR error LIKE '%HTTP 403%' OR error LIKE '%HTTP 407%' OR error LIKE '%HTTP 429%' OR error LIKE '%HTTP 451%' OR error LIKE '%redirect rejected%' OR error LIKE '%access challenge%'))`;
const legacyPending = sql`EXISTS (SELECT 1 FROM tic_snapshot_cache WHERE id IN ('tic-equity-latest-v2','tic-equity-history-latest-12-v2','tic-equity-2026-08','tic-equity-history-2025-09-2026-08-v1') AND (lease_token IS NOT NULL OR (error IS NOT NULL AND error <> 'Previous fixed-window snapshot; latest source month verification is pending.')))`;
const clock = sql`(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))`;
export type SourceState = 'ready' | 'checking' | 'cooldown' | 'denied' | 'uncertain' | 'coordination_unavailable';
export type SourceGateView = {state: SourceState; retryAt: number | null; error: string | null; checkedAt: number | null};
export type SourceOutcome = {state: 'ready' | 'cooldown' | 'denied' | 'uncertain'; delayMs?: number; retryAtMs?: number; error?: string};
export interface TicSourceGate {
 ensure(): Promise<void>;
 inspect(now: number): Promise<SourceGateView>;
 claim(now: number, token: string): Promise<boolean>;
 finish(token: string, outcome: SourceOutcome, now: number): Promise<void>;
}
export class TicGateError extends Error {constructor(){super('Treasury source coordination is unavailable; acquisition stopped.');}}
/** Busy/denied/uncertain never expire. A lost or ambiguous write must not open a fresh acquisition route. */
export function sourceGate(db: ReturnType<typeof getDb>): TicSourceGate {
 return {
  async ensure() {
   await db.insert(ticCache).values({id: TIC_SOURCE_GATE_KEY, version: sql`CASE WHEN ${legacyDenial} THEN 'denied' WHEN ${legacyPending} THEN 'uncertain' ELSE 'ready' END`, leaseUntilMs: 0}).onConflictDoNothing();
  },
  async inspect() {
   const row = (await db.select({state: ticCache.version, retryAt: ticCache.leaseUntilMs, error: ticCache.error,
    checkedAt: ticCache.lastAttemptMs, now: clock}).from(ticCache).where(eq(ticCache.id, TIC_SOURCE_GATE_KEY)).limit(1))[0];
   if (!row || !['ready', 'checking', 'cooldown', 'denied', 'uncertain'].includes(row.state ?? '') ||
    !Number.isSafeInteger(row.retryAt) || row.retryAt < 0 || row.retryAt > 8.64e15 ||
    typeof row.now !== 'number' || !Number.isSafeInteger(row.now) ||
    row.checkedAt !== null && (!Number.isSafeInteger(row.checkedAt) || row.checkedAt < 0 || row.checkedAt > 8.64e15)) throw new TicGateError();
   return {state: row.state === 'cooldown' && row.retryAt <= row.now ? 'ready' : row.state as SourceState,
    retryAt: row.state === 'cooldown' && row.retryAt > row.now ? row.retryAt : null, error: row.error, checkedAt: row.checkedAt};
  },
  async claim(_now, token) {
   const rows = await db.update(ticCache).set({version: 'checking', leaseToken: token, lastAttemptMs: clock})
    .where(and(eq(ticCache.id, TIC_SOURCE_GATE_KEY), sql`${ticCache.version} IN ('ready','cooldown')`, lte(ticCache.leaseUntilMs, clock)))
    .returning({id: ticCache.id});
   return rows.length === 1;
  },
  async finish(token, outcome) {
   const delay = outcome.delayMs ?? 0, absolute = outcome.retryAtMs ?? 0;
   if (!token || !['ready', 'cooldown', 'denied', 'uncertain'].includes(outcome.state) || !Number.isSafeInteger(delay) || delay < 0 || delay > 8.64e15 - Date.now() || !Number.isSafeInteger(absolute) || absolute < 0 || absolute > 8.64e15) throw new TicGateError();
   const rows = await db.update(ticCache).set({version: outcome.state, leaseToken: null,
    leaseUntilMs: outcome.state === 'cooldown' ? sql`MAX(${clock} + ${delay}, ${absolute})` : 0, error: outcome.error?.slice(0, 500) ?? null})
    .where(and(eq(ticCache.id, TIC_SOURCE_GATE_KEY), eq(ticCache.version, 'checking'), eq(ticCache.leaseToken, token)))
    .returning({id: ticCache.id});
   if (rows.length !== 1) throw new TicGateError();
  },
 };
}
