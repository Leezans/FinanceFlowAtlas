import { NOW, SourceGateError, type D1Result, type GateD1 } from '../ashare/source-gate';
import { strictJSON } from '../ashare/strict-json';
import { assertAllowedSource, type NewsSource } from './sources';
import { MAX_DOCUMENT_BYTES } from './xml';

export const NEWS_GATE_TIMEOUT_MS = 5000;
export const NEWS_MAX_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_REFRESH_MS = 15 * 60 * 1000;
export const NEWS_MAX_STALE_MS = 24 * 60 * 60 * 1000;
export const NEWS_MAX_PERSISTED_BYTES = 2_100_000;
export interface NewsDocument {
  schemaVersion: 1;
  sourceId: string;
  sourceUrl: string;
  document: string;
  fetchedAt: number;
}
export interface NewsGateState {
  state: 'idle' | 'busy' | 'blocked';
  nowMs: number;
  attemptedAt: number;
  retryAt: number;
  error: string | null;
  snapshot: NewsDocument | null;
}
export interface NewsLease { token: string }
export type NewsOutcome =
  | { kind: 'success'; document: string }
  | { kind: 'temporary_failure'; error: string; retryAfterMs: number; retryAtMs?: number }
  | { kind: 'denied'; error: string };
export interface NewsGate {
  inspect(source: NewsSource): Promise<NewsGateState>;
  acquire(source: NewsSource): Promise<NewsLease>;
  release(source: NewsSource, lease: NewsLease, outcome: NewsOutcome): Promise<NewsGateState>;
}

const RETURN_FIELDS = `status, payload, attempted_ms, not_before_ms, error_text, ${NOW} AS now_ms`;
/** Separate table only. Database clock; busy/blocked never expire or auto-reset. */
export const NEWS_GATE_SQL = {
  inspect: `SELECT ${RETURN_FIELDS} FROM news_source_gate WHERE id=?`,
  acquire: `UPDATE news_source_gate SET status='busy',lease_token=?,attempted_ms=${NOW},updated_ms=${NOW}
    WHERE id=? AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
  finish: `UPDATE news_source_gate SET status=?,lease_token=NULL,updated_ms=${NOW},not_before_ms=max(${NOW}+?,?),error_text=?,
    payload=CASE WHEN ? THEN NULL WHEN ? IS NOT NULL THEN json_set(?,'$.fetchedAt',${NOW})
      WHEN payload IS NOT NULL AND json_extract(payload,'$.fetchedAt')+${NEWS_MAX_STALE_MS}<${NOW} THEN NULL ELSE payload END
    WHERE id=? AND status='busy' AND lease_token=? AND ?<=${NOW}+${NEWS_MAX_COOLDOWN_MS} RETURNING ${RETURN_FIELDS}`,
} as const;
const validMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 8.64e15;

function validateDocument(raw: unknown, source: NewsSource, nowMs: number): NewsDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SourceGateError('source_gate_unavailable');
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.sourceId !== source.id || value.sourceUrl !== source.url ||
    typeof value.document !== 'string' || new TextEncoder().encode(value.document).byteLength > MAX_DOCUMENT_BYTES ||
    !validMs(value.fetchedAt) || value.fetchedAt > nowMs) throw new SourceGateError('source_gate_unavailable');
  return value as unknown as NewsDocument;
}

/** Read the direct primary D1 binding, never a potentially stale replica/session. */
export class D1NewsGate implements NewsGate {
  constructor(private readonly db: GateD1 | undefined) {}
  private async run(sql: string, ...values: unknown[]): Promise<D1Result> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!this.db) throw new Error();
      const operation = this.db.prepare(sql).bind(...values).run();
      const result = await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SourceGateError('source_gate_unavailable')), NEWS_GATE_TIMEOUT_MS);
      })]);
      if (!result.success) throw new Error();
      return result;
    } catch { throw new SourceGateError('source_gate_unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
  private decode(source: NewsSource, row: Record<string, unknown> | undefined): NewsGateState {
    if (!row || !['idle', 'busy', 'blocked'].includes(String(row.status)) || !validMs(row.now_ms) ||
      !validMs(row.attempted_ms) || !validMs(row.not_before_ms) || row.attempted_ms > row.now_ms ||
      (row.error_text !== null && (typeof row.error_text !== 'string' || row.error_text.length > 256))) {
      throw new SourceGateError('source_gate_unavailable');
    }
    const state = row.status as NewsGateState['state'];
    let snapshot: NewsDocument | null = null;
    // Busy/blocked must never expose old payload, even if a corrupt row has one.
    if (state === 'idle' && row.payload !== null) {
      if (typeof row.payload !== 'string' || new TextEncoder().encode(row.payload).byteLength > NEWS_MAX_PERSISTED_BYTES) throw new SourceGateError('source_gate_unavailable');
      try { snapshot = validateDocument(strictJSON(row.payload), source, row.now_ms); }
      catch { throw new SourceGateError('source_gate_unavailable'); }
    }
    return { state, nowMs: row.now_ms, attemptedAt: row.attempted_ms, retryAt: row.not_before_ms, error: row.error_text as string | null, snapshot };
  }
  async inspect(source: NewsSource): Promise<NewsGateState> {
    assertAllowedSource(source);
    return this.decode(source, (await this.run(NEWS_GATE_SQL.inspect, source.id)).results?.[0]);
  }
  async acquire(source: NewsSource): Promise<NewsLease> {
    assertAllowedSource(source);
    const token = crypto.randomUUID();
    const result = await this.run(NEWS_GATE_SQL.acquire, token, source.id);
    if (result.meta?.changes === 1 && result.results?.[0]?.status === 'busy') return { token };
    if (result.meta?.changes !== 0) throw new SourceGateError('source_gate_unavailable');
    const state = await this.inspect(source);
    if (state.state === 'blocked') throw new SourceGateError('source_denied');
    if (state.state === 'busy') throw new SourceGateError('source_busy');
    if (state.retryAt > state.nowMs) throw new SourceGateError('source_cooldown');
    throw new SourceGateError('source_gate_unavailable');
  }
  async release(source: NewsSource, lease: NewsLease, outcome: NewsOutcome): Promise<NewsGateState> {
    assertAllowedSource(source);
    if (!lease.token || !['success', 'temporary_failure', 'denied'].includes(outcome.kind)) throw new SourceGateError('source_gate_unavailable');
    const delay = outcome.kind === 'temporary_failure' ? Math.max(NEWS_REFRESH_MS, outcome.retryAfterMs) : NEWS_REFRESH_MS;
    if (!validMs(delay) || delay > NEWS_MAX_COOLDOWN_MS) throw new SourceGateError('source_gate_unavailable');
    const retryAt = outcome.kind === 'temporary_failure' ? (outcome.retryAtMs ?? 0) : 0;
    if (!validMs(retryAt)) throw new SourceGateError('source_gate_unavailable');
    const error = outcome.kind === 'success' ? null : outcome.error;
    if (error !== null && (typeof error !== 'string' || error.length > 256)) throw new SourceGateError('source_gate_unavailable');
    let payload: string | null = null;
    if (outcome.kind === 'success') {
      if (typeof outcome.document !== 'string' || new TextEncoder().encode(outcome.document).byteLength > MAX_DOCUMENT_BYTES) throw new SourceGateError('source_gate_unavailable');
      payload = JSON.stringify({ schemaVersion: 1, sourceId: source.id, sourceUrl: source.url, document: outcome.document, fetchedAt: 0 });
      if (new TextEncoder().encode(payload).byteLength > NEWS_MAX_PERSISTED_BYTES) throw new SourceGateError('source_gate_unavailable');
    }
    // Exactly one token-guarded write. On unknown outcome never retry release or fetch.
    const result = await this.run(NEWS_GATE_SQL.finish, outcome.kind === 'denied' ? 'blocked' : 'idle', delay, retryAt, error,
      outcome.kind === 'denied' ? 1 : 0, payload, payload, source.id, lease.token, retryAt);
    if (result.meta?.changes === 0) throw new SourceGateError('source_stale_lease');
    if (result.meta?.changes !== 1) throw new SourceGateError('source_gate_unavailable');
    const state = this.decode(source, result.results?.[0]);
    if (state.state !== (outcome.kind === 'denied' ? 'blocked' : 'idle')) throw new SourceGateError('source_gate_unavailable');
    return state;
  }
}
