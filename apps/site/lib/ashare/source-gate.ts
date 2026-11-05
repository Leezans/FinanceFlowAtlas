import {safeSourceCode,isSourceStopped} from './recovery';
/** Metadata-only, shared across ALL isolates via a single primary D1 row.
 * No timers, expiry, reset, takeover, source requests, payloads, or user identities.
 * Pass the D1 binding directly, NOT a read-replica session.
 */
export type SourceOutcome = { kind: 'success' | 'temporary_failure' | 'denied' | 'cancelled'; reason?: string };
export type SourceLease = { token: string; acquiredAtMs?:number };
export interface SourceGate {
  acquire(scope: string, signal?: AbortSignal): Promise<SourceLease>;
  release(token: string, outcome: SourceOutcome): Promise<void>;
  inspect?(): Promise<SourceGateCode | null>;
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
export const NOW = "(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
export const SUCCESS_QUIET_MS = 3_000;
// The database computes each failure window from the previous durable count.
// A diagnostic threshold only, not a lease expiry or proof of source outcome.
// This deliberately conservative diagnostic does not expire the 20s operation.
export const UNCONFIRMED_AFTER_MS = 180_000;
export const SQL = {
  acquire: `UPDATE ashare_source_gate SET status='busy', lease_token=?, acquired_ms=${NOW}, updated_ms=${NOW}
    WHERE id='single_upstream' AND status='idle' AND not_before_ms <= ${NOW}
    AND typeof(failure_count)='integer' AND failure_count BETWEEN 0 AND 5 RETURNING status, acquired_ms`,
  inspect: `SELECT status, acquired_ms, not_before_ms, ${NOW} AS now_ms FROM ashare_source_gate WHERE id='single_upstream'`,
  failure: `UPDATE ashare_source_gate SET status='idle', lease_token=NULL, failure_code=?,
    failure_count=min(failure_count+1,5), last_failure_ms=${NOW},
    finished_ms=${NOW}, updated_ms=${NOW}, not_before_ms=${NOW}+min(900000,60000*(1 << min(failure_count,4)))
    WHERE id='single_upstream' AND status='busy' AND lease_token=? RETURNING status`,
  denied: `UPDATE ashare_source_gate SET status='blocked', lease_token=NULL, reason_code=?,
    finished_ms=${NOW}, updated_ms=${NOW}, not_before_ms=${NOW}+${SUCCESS_QUIET_MS}
    WHERE id='single_upstream' AND status='busy' AND lease_token=? RETURNING status`,
  preserve: `UPDATE ashare_source_gate SET status=?, lease_token=NULL,
    finished_ms=${NOW}, updated_ms=${NOW}, not_before_ms=${NOW}+?
    WHERE id='single_upstream' AND status='busy' AND lease_token=? RETURNING status`,
  finish: `UPDATE ashare_source_gate SET status=?, lease_token=NULL, reason_code=?, failure_count=0, last_failure_ms=NULL, failure_code=NULL,
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
        await this.release(token, { kind: 'cancelled' });
        throw new SourceGateError('source_aborted');
      }
      const acquiredAtMs=acquired.results?.[0]?.acquired_ms;
      return {token,...(typeof acquiredAtMs==='number'&&Number.isSafeInteger(acquiredAtMs)&&acquiredAtMs>=0?{acquiredAtMs}:{})};
    }
    if (acquired.meta?.changes !== 0) throw new SourceGateError('source_gate_unavailable');
    throw new SourceGateError((await this.inspect()) ?? 'source_gate_unavailable');
  }
  /** Read-only shared status: does not acquire, expire, clear, or retry anything. */
  async inspect(): Promise<SourceGateCode | null> {
    const state = (await this.run(SQL.inspect)).results?.[0];
    return inspectGateState(state);
  }
  async release(token: string, outcome: SourceOutcome): Promise<void> {
    if (!token || !['success', 'temporary_failure', 'denied', 'cancelled'].includes(outcome.kind))
      throw new SourceGateError('source_gate_unavailable');
    // Denial is persisted atomically WITH releasing ownership, never after it.
    const result = outcome.kind === 'temporary_failure'
      ? await this.run(SQL.failure, retainedFailureCode(outcome.reason), token)
      : outcome.kind === 'cancelled'
        ? await this.run(SQL.preserve, 'idle', SUCCESS_QUIET_MS, token)
        : outcome.kind === 'denied'
          ? await this.run(SQL.denied,reasonCode(outcome),token)
          : await this.run(SQL.finish, 'idle', null, SUCCESS_QUIET_MS, token);
    if (result.meta?.changes === 0) throw new SourceGateError('source_stale_lease');
    if (result.meta?.changes !== 1) throw new SourceGateError('source_gate_unavailable');
  }
}

/** Shared fail-closed classification; never mutates or expires a lease. */
export function inspectGateState(state:Record<string,unknown>|undefined):SourceGateCode|null {
    if (state?.status === 'blocked') return 'source_denied';
    // A busy operation may be crashed or still active. Never guess or take over.
    if (state?.status === 'busy') {
      // Age changes only the explanation. Never release, reset, or retry this
      // acquisition: it may have observed a denial before losing persistence.
      if (typeof state.acquired_ms !== 'number' || !Number.isSafeInteger(state.acquired_ms) || state.acquired_ms < 0 ||
        typeof state.now_ms !== 'number' || !Number.isSafeInteger(state.now_ms) || state.now_ms < state.acquired_ms)
        throw new SourceGateError('source_gate_unavailable');
      return state.now_ms - state.acquired_ms >= UNCONFIRMED_AFTER_MS ? 'source_outcome_unconfirmed' : 'source_busy';
    }
    if (state?.status === 'idle' && typeof state.not_before_ms === 'number' && Number.isSafeInteger(state.not_before_ms) && state.not_before_ms >= 0 &&
      typeof state.now_ms === 'number' && Number.isSafeInteger(state.now_ms) && state.now_ms >= 0)
      return state.not_before_ms > state.now_ms ? 'source_cooldown' : null;
    // Concurrent changes or absent/malformed row are fail-closed too.
    throw new SourceGateError('source_gate_unavailable');
}

/** Persist only bounded failure codes, never raw exception content. */
export function retainedFailureCode(reason:unknown):string {
  const code=safeSourceCode(reason);
  return code&&!isSourceStopped(code)?code:'collection_failed';
}
