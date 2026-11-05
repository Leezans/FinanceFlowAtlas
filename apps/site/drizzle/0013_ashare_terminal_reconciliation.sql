-- Deliberate ONE-TIME operator reconciliation of the independently verified
-- terminal 2026-11-05 09:35:29.146 UTC invocation. Runtime logs explicitly report
-- waitUntil cancellation at its retained execution ceiling. The original request
-- received HTTP 302; the redirected response is UNKNOWN. This is not automatic
-- lease expiry, source-success evidence, or clearance of a denied source.
-- The 20-second original-deadline prevention fix must be deployed first.
-- No blocked state, changed row, or different lease matches this operation.
-- The trigger makes preservation of the full previous row atomic with release:
-- if the audit write fails, the gate UPDATE fails too.
CREATE TRIGGER IF NOT EXISTS ashare_terminal_reconciliation_audit
BEFORE UPDATE ON ashare_source_gate
WHEN OLD.id='single_upstream'
 AND OLD.status='busy'
 AND OLD.lease_token='d40b43df-beb2-4d2e-a839-c6298519f450'
 AND OLD.acquired_ms=1793871300854
 AND OLD.updated_ms=1793871300854
 AND OLD.finished_ms=1793871239340
 AND OLD.not_before_ms=1793871299340
 AND OLD.reason_code IS NULL
 AND NEW.status='idle' AND NEW.lease_token IS NULL AND NEW.reason_code IS NULL
BEGIN
 INSERT INTO ashare_recovery_audit (
  id,prior_status,prior_lease_token,prior_acquired_ms,prior_finished_ms,
  prior_updated_ms,prior_not_before_ms,prior_reason_code,reconciled_ms,
  invocation_outcome,source_outcome,evidence
 ) VALUES (
  'runtime_cancel_20261105_093529',OLD.status,OLD.lease_token,OLD.acquired_ms,
  OLD.finished_ms,OLD.updated_ms,OLD.not_before_ms,OLD.reason_code,NEW.updated_ms,
  'waituntil_canceled_terminal','unknown',
  'Operational review: request a51dcec4e7ce88a5c73ed04f4d3a8112, trace f3c2429a8761993fa114438f2db6ccaa, terminated canceled at 2026-11-05 09:35:29.146 UTC after 31.504 seconds. Runtime explicitly reported waitUntil tasks canceled for exceeding the allowed post-invocation lifetime. Primary HTTP 302 observed at 09:35:21.652; the approved redirect started, but its response is unknown. No observed denial is established. User requested repair; the original 20-second deadline prevention is deployed. Gate id single_upstream. Exact terminal lease only; original state preserved with a fresh 60-second cooldown. This record does not attest source success or absence of an unobserved response.'
 );
END;
--> statement-breakpoint
UPDATE ashare_source_gate
SET status='idle',lease_token=NULL,
 finished_ms=(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
 updated_ms=(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
 not_before_ms=(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))+60000
WHERE id='single_upstream' AND status='busy'
 AND lease_token='d40b43df-beb2-4d2e-a839-c6298519f450'
 AND acquired_ms=1793871300854 AND updated_ms=1793871300854
 AND finished_ms=1793871239340 AND not_before_ms=1793871299340
 AND reason_code IS NULL
 AND (CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) >= 1793871509146
 AND NOT EXISTS (SELECT 1 FROM ashare_recovery_audit WHERE id='runtime_cancel_20261105_093529');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ashare_terminal_reconciliation_audit;
