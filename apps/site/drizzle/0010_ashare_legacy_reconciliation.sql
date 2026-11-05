CREATE TABLE IF NOT EXISTS `ashare_recovery_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`prior_status` text NOT NULL,
	`prior_lease_token` text NOT NULL,
	`prior_acquired_ms` integer NOT NULL,
	`prior_finished_ms` integer,
	`prior_updated_ms` integer NOT NULL,
	`prior_not_before_ms` integer NOT NULL,
	`prior_reason_code` text,
	`reconciled_ms` integer NOT NULL,
	`invocation_outcome` text NOT NULL,
	`source_outcome` text NOT NULL,
	`evidence` text NOT NULL
);

--> statement-breakpoint
-- Deliberate ONE-TIME operator repair of the known terminal 2026-11-05
-- canceled invocation. This is not a lease expiry and is not evidence that
-- its unrecorded provider response succeeded. No blocked or other lease matches.
-- The trigger makes preservation of the full previous row atomic with release:
-- if the audit write fails, the gate UPDATE fails too.
CREATE TRIGGER IF NOT EXISTS ashare_legacy_reconciliation_audit
BEFORE UPDATE ON ashare_source_gate
WHEN OLD.id='single_upstream'
 AND OLD.status='busy'
 AND OLD.lease_token='5c3f28a0-6303-4432-8dab-019ff369586e'
 AND OLD.acquired_ms=1793856991992
 AND OLD.updated_ms=1793856991992
 AND OLD.finished_ms=1793842921309
 AND OLD.not_before_ms=1793842924309
 AND OLD.reason_code IS NULL
 AND NEW.status='idle' AND NEW.lease_token IS NULL AND NEW.reason_code IS NULL
BEGIN
 INSERT INTO ashare_recovery_audit (
  id,prior_status,prior_lease_token,prior_acquired_ms,prior_finished_ms,
  prior_updated_ms,prior_not_before_ms,prior_reason_code,reconciled_ms,
  invocation_outcome,source_outcome,evidence
 ) VALUES (
  'legacy_cancel_20261105_053632',OLD.status,OLD.lease_token,OLD.acquired_ms,
  OLD.finished_ms,OLD.updated_ms,OLD.not_before_ms,OLD.reason_code,NEW.updated_ms,
  'canceled_terminal','unknown',
  'Operational review: invocation at 2026-11-05 05:36:32 UTC canceled after about 1.6 seconds. Source response is unknown; no observed denial is established. User requested repair. Exact legacy lease only; original state preserved. This record does not attest source success or absence of an unobserved response.'
 );
END;
--> statement-breakpoint
UPDATE ashare_source_gate
SET status='idle',lease_token=NULL,
 finished_ms=(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
 updated_ms=(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
 not_before_ms=(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))+60000
WHERE id='single_upstream' AND status='busy'
 AND lease_token='5c3f28a0-6303-4432-8dab-019ff369586e'
 AND acquired_ms=1793856991992 AND updated_ms=1793856991992
 AND finished_ms=1793842921309 AND not_before_ms=1793842924309
 AND reason_code IS NULL
 AND (CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) >= 1793857171992
 AND NOT EXISTS (SELECT 1 FROM ashare_recovery_audit WHERE id='legacy_cancel_20261105_053632');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ashare_legacy_reconciliation_audit;
