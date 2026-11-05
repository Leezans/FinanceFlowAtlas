/** Metadata-only, shared across ALL isolates via a single primary D1 row.
 * No timers, expiry, reset, takeover, source requests, payloads, or user identities.
 * Pass the D1 binding directly, NOT a read-replica session.
 */
export type SourceOutcome = { kind: 'success' | 'temporary_failure' | 'denied'; reason?: string };
export type SourceLease = { token: string };
export interface SourceGate {
  acquire(scope: string, signal?: AbortSignal): Promise<SourceLease>;
  release(token: string, outcome: SourceOutcome): Promise<void>;
}
export type SourceGateCode = 'source_denied' | 'source_busy' | 'source_outcome_unconfirmed' | 'source_cooldown' |
  'source_gate_unavailable' | 'source_stale_lease' | 'source_aborted';
export class SourceGateError extends Error {
  constructor(public readonly code: SourceGateCode) { super(code); this.name = 'SourceGateError'; }
}
export interface D1Result {
  success: boolean;
  results?: Record<string, unknown>[];
  meta?: { changes?: number };
}
export interface GateD1 {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<D1Result> } };
}
// Database clock, not independently skewed isolate clocks.
const NOW = "(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const SUCCESS_QUIET_MS = 3_000;
// In-memory exponential backoff does not survive a new isolate. Keep its first
// 60s failure window in shared metadata so cold isolates cannot retry after 3s.
const TEMPORARY_FAILURE_QUIET_MS = 60_000;
// A diagnostic threshold only, not a lease expiry or proof of source outcome.
// Allow the 90s acquisition budget plus cleanup margin before asking for review.
export const UNCONFIRMED_AFTER_MS = 180_000;
export const SQL = {
  acquire: `UPDATE ashare_source_gate SET status='busy', lease_token=?, acquired_ms=${NOW}, updated_ms=${NOW}
    WHERE id='single_upstream' AND status='idle' AND not_before_ms <= ${NOW} RETURNING status`,
  inspect: `SELECT status, acquired_ms, not_before_ms, ${NOW} AS now_ms FROM ashare_source_gate WHERE id='single_upstream'`,
  finish: `UPDATE ashare_source_gate SET status=?, lease_token=NULL, reason_code=?,
    finished_ms=${NOW}, updated_ms=${NOW}, not_before_ms=${NOW}+?
    WHERE id='single_upstream' AND status='busy' AND lease_token=? RETURNING status`,
} as const;
function reasonCode(outcome: SourceOutcome): string | null {
  if (outcome.kind !== 'denied') return null;
  // Never persist arbitrary source messages, URLs, response bodies, or caller input.
  const allowed = ['http_403', 'http_429', 'challenge', 'captcha', 'access_denied', 'login_required'];
  return allowed.includes(outcome.reason ?? '') ? outcome.reason! : 'access_denied';
}
export class D1SourceGate implements SourceGate {
  constructor(private readonly db: GateD1) {}
  private async run(sql: string, ...values: unknown[]): Promise<D1Result> {
    try {
      const result = await this.db.prepare(sql).bind(...values).run();
      if (!result.success) throw new Error();
      return result;
    } catch { throw new SourceGateError('source_gate_unavailable'); }
  }
  async acquire(_scope: string, signal?: AbortSignal): Promise<SourceLease> {
    if (signal?.aborted) throw new SourceGateError('source_aborted');
    let token: string;
    try { token = crypto.randomUUID(); }
    catch { throw new SourceGateError('source_gate_unavailable'); }
    // No race-with-abort: settle the DB operation before any return or cleanup.
    const acquired = await this.run(SQL.acquire, token);
    if (acquired.meta?.changes === 1) {
      if (signal?.aborted) {
        await this.release(token, { kind: 'temporary_failure' });
        throw new SourceGateError('source_aborted');
      }
      return { token };
    }
    if (acquired.meta?.changes !== 0) throw new SourceGateError('source_gate_unavailable');
    const state = (await this.run(SQL.inspect)).results?.[0];
    if (state?.status === 'blocked') throw new SourceGateError('source_denied');
    // A busy operation may be crashed or still active. Never guess or take over.
    if (state?.status === 'busy') {
      // Age changes only the explanation. Never release, reset, or retry this
      // acquisition: it may have observed a denial before losing persistence.
      if (typeof state.acquired_ms !== 'number' || !Number.isSafeInteger(state.acquired_ms) || state.acquired_ms < 0 ||
        typeof state.now_ms !== 'number' || !Number.isSafeInteger(state.now_ms) || state.now_ms < state.acquired_ms)
        throw new SourceGateError('source_gate_unavailable');
      throw new SourceGateError(state.now_ms - state.acquired_ms >= UNCONFIRMED_AFTER_MS ? 'source_outcome_unconfirmed' : 'source_busy');
    }
    if (state?.status === 'idle' && typeof state.not_before_ms === 'number' &&
      typeof state.now_ms === 'number' && state.not_before_ms > state.now_ms)
      throw new SourceGateError('source_cooldown');
    // Concurrent changes or absent/malformed row are fail-closed too.
    throw new SourceGateError('source_gate_unavailable');
  }
  async release(token: string, outcome: SourceOutcome): Promise<void> {
    if (!token || !['success', 'temporary_failure', 'denied'].includes(outcome.kind))
      throw new SourceGateError('source_gate_unavailable');
    // Denial is persisted atomically WITH releasing ownership, never after it.
    const quietMs = outcome.kind === 'temporary_failure' ? TEMPORARY_FAILURE_QUIET_MS : SUCCESS_QUIET_MS;
    const result = await this.run(SQL.finish, outcome.kind === 'denied' ? 'blocked' : 'idle', reasonCode(outcome), quietMs, token);
    if (result.meta?.changes === 0) throw new SourceGateError('source_stale_lease');
    if (result.meta?.changes !== 1) throw new SourceGateError('source_gate_unavailable');
  }
}
