import { SourceGateError } from '@/lib/ashare/source-gate';
import { NEWS_REFRESH_MS, NEWS_MAX_COOLDOWN_MS, type NewsGate, type NewsGateState, type NewsLease, type NewsOutcome } from '@/lib/news/source-gate';
import { NEWS_SOURCES, type NewsSource } from '@/lib/news/sources';

/** In-memory test double only. Native-D1 tests separately exercise SQL atomicity. */
export class FixtureNewsGate implements NewsGate {
  readonly rows: Map<string, NewsGateState>;
  private readonly tokens = new Map<string, string>();
  constructor(private readonly now: () => number) {
    this.rows = new Map(NEWS_SOURCES.map(source => [source.id, {
      state: 'idle', nowMs: now(), attemptedAt: 0, retryAt: 0, error: null, snapshot: null,
    }]));
  }
  async inspect(source: NewsSource): Promise<NewsGateState> {
    const row = this.rows.get(source.id);
    if (!row) throw new SourceGateError('source_gate_unavailable');
    return { ...row, nowMs: this.now(), snapshot: row.state === 'idle' ? row.snapshot : null };
  }
  async acquire(source: NewsSource): Promise<NewsLease> {
    const row = this.rows.get(source.id);
    if (!row) throw new SourceGateError('source_gate_unavailable');
    if (row.state === 'blocked') throw new SourceGateError('source_denied');
    if (row.state === 'busy') throw new SourceGateError('source_busy');
    if (row.retryAt > this.now()) throw new SourceGateError('source_cooldown');
    const token = crypto.randomUUID();
    row.state = 'busy'; row.attemptedAt = this.now(); this.tokens.set(source.id, token);
    return { token };
  }
  async release(source: NewsSource, lease: NewsLease, outcome: NewsOutcome): Promise<NewsGateState> {
    const row = this.rows.get(source.id);
    if (!row || row.state !== 'busy' || this.tokens.get(source.id) !== lease.token) throw new SourceGateError('source_stale_lease');
    const delay = outcome.kind === 'temporary_failure' ? Math.max(NEWS_REFRESH_MS, outcome.retryAfterMs) : NEWS_REFRESH_MS;
    if (!Number.isSafeInteger(delay) || delay > NEWS_MAX_COOLDOWN_MS) throw new SourceGateError('source_gate_unavailable');
    const absoluteRetryAt = outcome.kind === 'temporary_failure' ? (outcome.retryAtMs ?? 0) : 0;
    if (!Number.isSafeInteger(absoluteRetryAt) || absoluteRetryAt < 0 || absoluteRetryAt > this.now() + NEWS_MAX_COOLDOWN_MS) throw new SourceGateError('source_gate_unavailable');
    row.state = outcome.kind === 'denied' ? 'blocked' : 'idle';
    row.retryAt = Math.max(this.now() + delay, absoluteRetryAt);
    row.error = outcome.kind === 'success' ? null : outcome.error;
    if (outcome.kind === 'denied') row.snapshot = null;
    if (outcome.kind === 'success') row.snapshot = { schemaVersion: 1, sourceId: source.id, sourceUrl: source.url, document: outcome.document, fetchedAt: this.now() };
    this.tokens.delete(source.id);
    return this.inspect(source);
  }
}
