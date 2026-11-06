import {consumeReply, emptyState, type EvidenceState, type WireReply} from '../components/ashare/client';
import {runCollectionBatch} from '../lib/ashare/collection-batch';
import {parseScope} from '../lib/ashare/snapshot';
import {safeSourceCode} from '../lib/ashare/recovery';
import {configuredScopes, SchedulerStore, type Finish} from './state';

export type TickReport = {code: string; scope?: string; requests?: number};
export async function runSchedulerTick(options: {
  enabled: unknown; scopes: unknown; scheduledTime: number; store: SchedulerStore;
  request: (request: Request) => Promise<Response>;
}): Promise<TickReport> {
  // Exact opt-in. Even DB reads are absent when disabled.
  if (options.enabled !== 'true') return {code: 'scheduler_disabled'};
  let scopes: string[];
  try { scopes = configuredScopes(options.scopes); } catch { return {code: 'scheduler_config_invalid'}; }
  const admitted = await options.store.claim(scopes, options.scheduledTime);
  if (!admitted.claim) return {code: admitted.code};
  const claim = admitted.claim;
  const url = new URL('https://scheduler.invalid/api/v1/ashare/snapshot');
  url.searchParams.set('scope', claim.scope);
  const scope = parseScope(url);
  let state = emptyState();
  const batch = await runCollectionBatch({request: async signal => {
    // In-process ordinary handler, never fetch this synthetic hostname or a Site.
    const response = await options.request(new Request(url, {signal,
      headers: state.etag ? {'If-None-Match': state.etag} : {}}));
    const reply: WireReply = {status: response.status,
      etag: response.headers.get('etag') ?? undefined,
      errorCode: response.headers.get('X-Ashare-Error-Code') ?? undefined,
      recoveryMode: response.headers.get('X-Ashare-Recovery') ?? undefined,
      retryAfter: response.headers.get('Retry-After') ?? undefined};
    // A stopped response is authoritative even if its body stalls. The handler's
    // own retained work still owns cleanup. No alternate host or authentication.
    if (![304,401,403].includes(response.status) && reply.recoveryMode !== 'stopped')
      reply.payload = await response.json();
    state = consumeReply(state, reply, scope);
    return state;
  }});
  // An uncertain adapter/transport outcome cannot release ownership, restart a
  // batch on the next minute, or guess what its late work did.
  if (batch.reason === 'unconfirmed' || batch.reason === 'cancelled')
    return {code: 'scheduler_outcome_unconfirmed', scope: claim.scope, requests: batch.requests};
  const result = summarize(state, batch.reason, batch.requests);
  try { await options.store.finish(claim, result); }
  catch { return {code: 'scheduler_store_unconfirmed', scope: claim.scope, requests: batch.requests}; }
  return {code: result.code, scope: claim.scope, requests: batch.requests};
}
function summarize(state: EvidenceState, reason: 'response'|'limit', requests: number): Finish {
  const acquired = state.snapshot ? Date.parse(state.snapshot.collection_started_at ?? state.snapshot.fetched_at) : NaN;
  return {
    code: state.recovery?.mode === 'stopped' ? safeSourceCode(state.recovery.code) ?? 'source_stopped' :
      reason === 'limit' ? 'collection_limit' : state.recovery ? safeSourceCode(state.recovery.code) ?? 'collection_failed' :
      state.snapshot ? 'complete_snapshot' : 'invalid_application_response',
    stopped: state.recovery?.mode === 'stopped', requests,
    // Never stamp a cached read or a failed collection as a new acquisition.
    acquisitionMs: Number.isSafeInteger(acquired) && acquired >= 0 ? acquired : null,
  };
}
