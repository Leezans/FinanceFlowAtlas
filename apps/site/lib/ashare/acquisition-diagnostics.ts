/** Ephemeral metadata only. No URLs, source values, identifiers, errors, timers,
 * network, storage or control decisions. Platform logs supply request correlation.
 * Timings describe application phases, not DNS/TLS or source-side root causes.
 */
export const ACQUISITION_PHASES = [
  'cache_read', 'queue', 'preflight', 'cache_recheck', 'gate_acquire',
  'admission_wait', 'stage_read', 'source_pacing', 'source_headers',
  'response_validation', 'source_body', 'body_cleanup', 'page_validation',
  'publication_check', 'snapshot_commit', 'stage_save', 'stage_discard',
  'gate_release', 'denial_cleanup',
] as const;
export type AcquisitionPhase = typeof ACQUISITION_PHASES[number];
type Result = 'unfinished' | 'cache_reused' | 'snapshot_published' | 'stage_saved' | 'failed' | 'skipped';
const phases = new Set<string>(ACQUISITION_PHASES);
const results = new Set<string>(['unfinished', 'cache_reused', 'snapshot_published', 'stage_saved', 'failed', 'skipped']);
// A nonsensical clock is unknown, not an invented timing or a control input.
function elapsed(from: number, to: number): number | null {
  const value = to - from;
  return Number.isFinite(from) && Number.isFinite(to) && value >= 0 && value <= 86_400_000 ? Math.floor(value) : null;
}
export function createAcquisitionDiagnostics(now: () => number, started: number) {
  let phase: AcquisitionPhase = 'cache_read', phaseStarted = started;
  let failedPhase: AcquisitionPhase | null = null, result: Result = 'unfinished';
  let page: number | null = null, route: 'primary' | 'official_redirect' | null = null, completedPages = 0, requests = 0;
  const durations: Partial<Record<AcquisitionPhase, number | null>> = {};
  const clock = () => {try {return now();} catch {return NaN;}};
  const duration = (at: number) => elapsed(phaseStarted, at);
  const add = (previous: number | null | undefined, value: number | null) => previous === null || value === null ? null : Math.min(86_400_000, (previous ?? 0) + value);
  return {
    enter(next: AcquisitionPhase) {
      if (!phases.has(next) || next === phase) return;
      const at = clock(); durations[phase] = add(durations[phase], duration(at));
      phase = next; phaseStarted = at;
    },
    request(nextPage: number, nextRoute: 'primary' | 'official_redirect') {
      page = Number.isSafeInteger(nextPage) && nextPage >= 1 && nextPage <= 20 ? nextPage : null;
      route = nextRoute === 'primary' || nextRoute === 'official_redirect' ? nextRoute : null;
      requests = Math.min(21, requests + 1);
    },
    validatedPage() {completedPages = Math.min(20, completedPages + 1);},
    failure(replace = false) {if (replace || failedPhase === null) failedPhase = phase;},
    result(next: Result) {if (results.has(next)) result = next;},
    snapshot() {
      const at = clock();
      return {phase, elapsed_ms: elapsed(started, at), phase_elapsed_ms: duration(at),
        failed_phase: failedPhase, last_requested_page: page, route, validated_pages_this_invocation: completedPages,
        source_requests_this_invocation: requests, result,
        phase_durations_ms: {...durations, [phase]: add(durations[phase], duration(at))}};
    },
  };
}
export type AcquisitionDiagnostics = ReturnType<typeof createAcquisitionDiagnostics>;

/** A diagnostic sink failure must never change acquisition or cleanup behavior. */
export function logAcquisitionDiagnostics(event: 'acquisition_deadline' | 'acquisition_finished', trace: AcquisitionDiagnostics) {
  if (event !== 'acquisition_deadline' && event !== 'acquisition_finished') return;
  try {console.info('[ashare phases]', JSON.stringify({event, ...trace.snapshot()}));} catch { /* metadata is best-effort */ }
}
