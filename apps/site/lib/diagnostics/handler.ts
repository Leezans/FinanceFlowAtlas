import {DIAGNOSTIC_QUERIES, SCHEDULER_QUERY, type DiagnosticQuery} from './queries';
import {z} from 'zod';

/** Capability deliberately excludes run, batch, exec, services and fetch. */
export interface ReadOnlyD1 {
  prepare(sql: string): {all(): Promise<{success: boolean; results: Record<string, unknown>[]}>};
}
export const DIAGNOSTIC_TIMEOUT_MS = 2_000;
type Row = Record<string, unknown>;
type ReadResult = {kind: 'row'; row: Row} | {kind: 'missing' | 'unavailable'};
type State = 'idle' | 'cooldown' | 'busy_or_unconfirmed' | 'stopped' | 'outcome_unconfirmed' | 'unknown';
const maximumTime = 8_640_000_000_000_000;
const validMs = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= maximumTime;
const recordedInstant = z.string().max(40).datetime({offset: true});
function pastTime(value: unknown, now: number): string | null {
  return validMs(value) && value > 0 && value <= now ? new Date(value).toISOString() : null;
}
function recordedTime(value: unknown, now: number): string | null {
  if (!recordedInstant.safeParse(value).success) return null;
  // Canonical UTC milliseconds are diagnostic metadata, not financial precision.
  // Date.parse alone would normalize impossible dates such as February 30.
  return pastTime(Date.parse(value as string), now);
}
function state(raw: unknown, retry: unknown, now: number): State {
  if (raw === 'blocked' || raw === 'denied') return 'stopped';
  if (raw === 'uncertain') return 'outcome_unconfirmed';
  if (raw === 'busy' || raw === 'checking') return 'busy_or_unconfirmed';
  if (typeof raw !== 'string' || !['idle', 'ready', 'cooldown'].includes(raw) || !validMs(retry)) return 'unknown';
  return retry > now ? 'cooldown' : 'idle';
}
async function read(db: ReadOnlyD1 | undefined, sql: string): Promise<ReadResult> {
  let timer: number | ReturnType<typeof setTimeout> | undefined;
  try {
    // The deadline only stops waiting. A late SELECT cannot publish or retry.
    const result = await Promise.race([
      Promise.resolve().then(() => db?.prepare(sql).all()),
      new Promise<undefined>(resolve => {timer = setTimeout(resolve, DIAGNOSTIC_TIMEOUT_MS);}),
    ]);
    if (!result?.success || !Array.isArray(result.results) || result.results.length > 1) return {kind: 'unavailable'};
    const row = result.results[0];
    if (!row) return {kind: 'missing'};
    return typeof row === 'object' && validMs(row.now_ms) && row.now_ms > 0 ? {kind: 'row', row} : {kind: 'unavailable'};
  } catch {
    // Never expose SQL, schema names, upstream text, identifiers or exceptions.
    return {kind: 'unavailable'};
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function project(definition: DiagnosticQuery, result: ReadResult) {
  const row = result.kind === 'row' ? result.row : undefined;
  const now = row?.now_ms as number | undefined;
  let coordination: State = row && now ? state(row.state, row.retry_ms, now) : 'unknown';
  let providerCoordination: State | null = null;
  if (definition.source === 'tpex-money' && row && now) {
    providerCoordination = state(row.provider_state, row.provider_retry_ms, now);
    // An idle summary cannot override its provider's refusal or uncertainty.
    const states = [coordination, providerCoordination];
    coordination = (['stopped', 'outcome_unconfirmed', 'unknown', 'busy_or_unconfirmed', 'cooldown', 'idle'] as const).find(value => states.includes(value))!;
  }
  const inspectCache = row && now && (coordination === 'idle' || coordination === 'cooldown') && (providerCoordination === null || providerCoordination === 'idle');
  const hasCache = inspectCache && row.cache_present === 1;
  const acquired = hasCache ? recordedTime(row.acquired_at, now) ?? pastTime(row.acquired_ms, now) : null;
  const started = hasCache ? recordedTime(row.started_at, now) : null;
  return {
    source: definition.source, view: definition.view,
    metadata: result.kind === 'row' ? 'read' : result.kind === 'missing' ? 'not_initialized' : 'unavailable',
    coordination, provider_coordination: providerCoordination,
    database_observed_at: now ? new Date(now).toISOString() : null,
    coordination_updated_at: row && now ? pastTime(row.updated_ms, now) : null,
    last_check_recorded_at: row && now ? pastTime(row.checked_ms, now) : null,
    check_time_semantics: definition.source === 'treasury-tic' ? 'attempt_started' : ['eastmoney', 'ecb', 'polymarket'].includes(definition.source) ? 'attempt_finished_not_necessarily_successful' : 'not_persisted_separately',
    next_attempt_not_before: coordination === 'cooldown' && row && now
      ? new Date(Math.max(validMs(row.retry_ms) ? row.retry_ms : 0, validMs(row.provider_retry_ms) ? row.provider_retry_ms : 0)).toISOString() : null,
    cache: {
      validation: 'not_performed',
      record_present: inspectCache && (row.cache_present === 0 || row.cache_present === 1) ? row.cache_present === 1 : null,
      recorded_acquisition_at: acquired,
      recorded_collection_start_at: started && acquired && started <= acquired ? started : null,
      recorded_commit_at: hasCache ? pastTime(row.committed_ms, now) : null,
      recorded_expiry_at: hasCache && validMs(row.expires_ms) && row.expires_ms > 0 ? new Date(row.expires_ms).toISOString() : null,
    },
  };
}
function scheduler(result: ReadResult) {
  const row = result.kind === 'row' ? result.row : undefined;
  const now = row?.now_ms as number | undefined;
  return {
    installation: 'unknown',
    metadata: result.kind === 'row' ? 'read' : result.kind === 'missing' ? 'not_initialized' : 'unavailable',
    observed_job_state: row?.state === 'idle' ? 'idle' : row?.state === 'busy' ? 'busy_or_unconfirmed' : row?.state === 'stopped' ? 'stopped' : 'unknown',
    last_event_seen_at: row && now ? pastTime(row.last_seen_ms, now) : null,
    last_admitted_tick_at: row && now ? pastTime(row.last_tick_ms, now) : null,
    last_job_started_at: row && now ? pastTime(row.last_started_ms, now) : null,
    last_job_finished_at: row && now ? pastTime(row.last_finished_ms, now) : null,
  };
}
const headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'};
export type DiagnosticsBody = {
  schema: 'financeflow-diagnostics/1'; mode: 'read_only_metadata'; limitations: string;
  built_in_collection: 'request_driven'; external_scheduler: ReturnType<typeof scheduler>;
  metadata_complete: boolean; sources: ReturnType<typeof project>[];
  inactive_sources: {source: string; implementation: string}[];
};

/** Metadata only. No source acquisition, initialization, pruning, repair or writes.
 * Site owner authentication remains at the existing hosting boundary.
 */
export function createDiagnosticsHandler(db?: ReadOnlyD1) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({error: 'method_not_allowed'}, {status: 405, headers: {...headers, Allow: 'GET'}});
    const url = new URL(request.url);
    if (url.pathname !== '/api/v1/diagnostics') return Response.json({error: 'not_found'}, {status: 404, headers});
    if (url.search) return Response.json({error: 'invalid_request'}, {status: 400, headers});
    const results = await Promise.all(DIAGNOSTIC_QUERIES.map(definition => read(db, definition.sql)));
    const background = await read(db, SCHEDULER_QUERY);
    const body: DiagnosticsBody = {
      schema: 'financeflow-diagnostics/1', mode: 'read_only_metadata',
      limitations: 'Metadata does not validate snapshot contents, source access, financial coverage, observation freshness or installed schedules. Idle does not mean a working data feed.',
      built_in_collection: 'request_driven', external_scheduler: scheduler(background),
      metadata_complete: results.every(result => result.kind === 'row'),
      sources: DIAGNOSTIC_QUERIES.map((definition, index) => project(definition, results[index])),
      inactive_sources: [{source: 'sina', implementation: 'disabled'}, {source: 'imf', implementation: 'not_integrated_in_hosted_app'}],
    };
    return Response.json(body, {status: results.some(result => result.kind === 'row') ? 200 : 503, headers});
  };
}
