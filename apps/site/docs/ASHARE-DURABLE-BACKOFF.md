# A-share durable retry state

The single primary D1 source-gate row is authoritative across scopes and Workers isolates. Migration 0019 is additive: it adds a capped failure count, the latest failure timestamp and one bounded failure code. It does not clear leases, denial records or old cooldowns, and does not infer the result of historical requests. Existing busy/blocked rows remain stopped. Missing migration fails closed.

A confirmed temporary failure after a source fetch starts atomically releases the matching busy token and increments the count (capped at five). Using D1's clock and the pre-increment count, the next delay is 60, 120, 240, 480, then 900 seconds, remaining at 900 seconds. Contention, failed admission and cancellation before source fetch do not increment. The count is source-wide, not per scope. Errors never authorize another host, proxy, faster pacing or parallel source fetches.

Partial-stage saves and pre-source cancellation release with the usual three-second pacing while preserving failure history. Only a fully validated completed snapshot's confirmed atomic publication resets the history in the production handler. The standalone gate success outcome has the same meaning for adapters without a snapshot store. Denial preserves the count and atomically latches blocked status. Unconfirmed writes never trigger another release or takeover.

Snapshot reads return last-good evidence together with a retained failure diagnosis even after its delay expires. The expired delay means another ordinary request may try, not that recovery occurred. Failure headers use the remaining D1-derived delay (rounded up, minimum one second), not a cold isolate's empty memory or an old isolate's local exponential counter. Successful fresh replies continue scheduling relative to oldest-page age. Healthy unexpired partial stages are reported as collection_in_progress, including on cold workers; a historical failure still takes priority until complete publication. No partial rows enter public evidence.

Only allowlisted error codes are persisted; no errors, URLs, bodies, identities or tokens are exposed as diagnostics. last_failure_ms is the most recent observed failed acquisition, not a source observation timestamp. Existing source_observed_at and trade_date remain unknown. A legacy failure with no durable diagnosis remains unknown; migration does not backfill guessed failures or successes.

## Offline verification

- npm test: SQL CAS, transaction rollback, cancellation, handler scheduling, old-cache failure visibility, client recovery and UI suites.
- npm run test:ashare-backoff-runtime: independent native workerd instances sharing transactional D1; exact exponential sequence and saturation, contention, stale release, bounded codes, stage/cancellation preservation, complete publication reset, unknown outcome and permanent denial. All outbound networking is forbidden. Clock advancement is test-only.
- Existing test:ashare-runtime, test:ashare-snapshots-runtime and test:ashare-staged-runtime exercise mocked native fetch, cancellation cleanup, snapshot transactionality and normal staged 3-second progression. These use synthetic data and prohibit real provider networking.
- Lint, TypeScript, build and built-asset integrity checks.

These tests establish local coordination behavior, not live provider availability, authorization or data reliability. Deployment must apply the generated additive migration before serving the new code, and keep the existing owner-private access controls.

## Rollout compatibility

Old v50 code ignores the additive fields. During mixed-version draining, an old invocation may use its fixed failure delay or publish success without resetting the new diagnosis. Rolling back to that code therefore loses the durable-backoff guarantee and can leave an old retained failure visible. Do not clear shared data or infer success to repair this. Prefer a forward-compatible rollback/fix that preserves these gate semantics; distinguish drained-new-code verification from overlapping old invocations.
