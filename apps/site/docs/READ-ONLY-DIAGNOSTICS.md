# Read-only source diagnostics

`GET /api/v1/diagnostics` reads bounded source coordination and cache-time metadata
from the existing primary D1. It is covered by the Site's existing owner-private
hosting boundary. No new audience, authentication mechanism, credential, public
webhook, scheduler, binding or migration is added.

This is a diagnostic API, not a new data feed. It does not repair access, make
financial evidence valid, or prove that unattended collection is installed.

## Why an independent endpoint

An audit of main `0c644f54c6492eda8debefa7c38080638d2f62d2` found different
semantics behind existing read-looking routes:

- A-share and Kraken `/status` return from explicit status branches before
  snapshot-only acquisition. Their shared store reads are SELECT-only. Reusing
  a handler with `/snapshot` does **not** imply that `/status` acquires data.
- ASEAN, CVM, World Bank, Cboe, CFTC, TPEx, Japan MOF, TPEx monetary summary and
  Polymarket `/status` likewise inspect without initiating acquisition.
- Sina's hosted handler is disabled before source access; IMF status is static.
- TIC `/flows/tic/status` calls `getTic` before choosing its response shape.
  `getCachedSource` can initialize coordination, claim, fetch and publish.
- ECB has no separate `/status`; `/fx/reference` calls the read-through service
  and can acquire, fetch and write.

These existing routes retain their existing behavior. Do not poll them all as
if they were side-effect-free health probes. The new endpoint imports none of
their handlers, services, stores, gate classes, ensure methods or host wiring.

## Strict read-only contract

- Sixteen fixed source/view SELECTs and one optional scheduler SELECT. Each
  returns at most one row. No request parameter controls SQL, table, key, scope,
  source URL or JSON path. Queries are rejected, including source filters.
- The application database capability exposes only `prepare(...).all()`. There
  is no `run`, `batch`, `exec`, `fetch`, initialization, cleanup, gate reset,
  admission, retry, publication, waitUntil job or automatic timer loop.
- Every SELECT wait is bounded to two seconds with no retry. Source reads run
  in parallel; the optional scheduler read follows, so the worst wait is four
  seconds. A late SELECT may finish, but cannot write or initiate another read.
- Missing tables, columns, bindings or failed reads are `unavailable`. A
  successfully read table with no fixed row is `not_initialized`. Neither state
  creates a row. HTTP 503 means no source metadata row was readable; a partial
  report can be HTTP 200 with `metadata_complete:false`.
- Only fixed source/view names, enumerated states, booleans and validated
  timestamps leave the handler. Never return raw payloads, financial rows,
  request identities, SQL, table/row identifiers, tokens, credentials, arbitrary
  database errors or source error text. Responses are `private, no-store`,
  `nosniff`, with no added CORS allowance.

The schema is `financeflow-diagnostics/1`. `metadata_complete` means all fixed
source/view rows were read, not that their sources or financial data are healthy.
Each SELECT has its own `database_observed_at`; this is not a cross-source atomic
snapshot. The endpoint is intended for deliberate inspection, not minute polling
of every provider. It performs no provider calls regardless of access state.

## Meaning of states and times

`idle` is a coordination state, not a verified working feed or source permission.
`busy_or_unconfirmed` deliberately does not claim that a worker is still running.
`stopped` and `outcome_unconfirmed` stay visible. No age threshold expires,
releases, changes or retries them. Unknown or malformed states remain unknown.

`coordination_updated_at` can be an acquisition or release transition. It is not
the last successful collection. `last_check_recorded_at` includes a
`check_time_semantics`: TIC records attempt start, A-share/ECB/Polymarket record
attempt finish that may have failed, and other gates do not separately persist
that timestamp. A `next_attempt_not_before` is only a cooldown boundary, not a
scheduled execution or permission to retry.

Every cache reports `validation:not_performed`. The endpoint extracts scalar
times without revalidating its financial payload. Missing, malformed, unknown-
schema or future timestamps are null. Supported ISO offset and fractional
timestamps normalize to UTC milliseconds. Cache presence and recorded times
never become `available`, `fresh`, a source observation time or a coverage count.
Busy, stopped and unknown coordination suppress cache metadata. TPEx monetary
summary also respects its original provider's blocked, busy, unknown or cooldown
state in the same SELECT, including when the summary itself is idle.

Scope is intentionally bounded:

- A-share shows only the level-1 cache, not every industry/stock scope. Its
  collection start, fetched time, commit and expiry are separate.
- Kraken shows only its `latest` reference, not every pair/time-window cohort.
- Cboe reports the retained quote snapshot's time. A newer empty-window check
  cannot renew that timestamp. Both current wrapper and legacy format are read.
- Polymarket newest, hot and open-interest views have separate records, times
  and cooldown boundaries. Wrapper and old single-view formats cannot invent a
  timestamp for a missing view.
- TIC latest and history caches remain separate. Their acquisition/commit times
  do not certify that a seeded legacy cache is the latest published report.
- The response explicitly lists Sina as disabled and IMF as not integrated in
  the hosted app. This says nothing about the separate Python pipeline.

## Background collection remains unverified

`built_in_collection:request_driven` describes the Site's existing behavior.
`external_scheduler.installation` is always `unknown`: a table, job status or
historical tick does not prove an installed cron, deployed version, same binding
or ongoing operation. Optional scheduler timestamps describe only recorded
events. Missing schema does not prove that no external scheduler exists.

The endpoint does not supply a reset, run-now or enable action. Actual unattended
operation still requires authorized deployment and independent verification of
installed triggers and multiple real executions with the browser closed.

## Verification

```
npm test -- --run tests/diagnostics.test.ts
npm run test:diagnostics-runtime
npx tsc --noEmit
npm run lint
npm run build
```

Unit tests use a database capability with no write methods and a forbidden
network stub. They cover fixed queries, missing/failed/hung reads, invalid dates,
source/provider stop priority, redaction, private headers and unknown scheduler
installation. Native workerd/D1 tests apply real migrations to isolated local
databases, compare every table row before/after requests across two isolates and
intercept all outbound calls. They also characterize the actual existing
A-share/Kraken status routes as read-only and demonstrate TIC's read-through
behavior using one intercepted synthetic denial. All fixture mutations occur
only during isolated test setup, never in the diagnostic handler.

These tests are not live-provider acceptance, production database inspection,
private-login verification or scheduler deployment. The hosting authentication
boundary must be verified separately through the normal authorized session.

## User-visible source summary

The shared navigation's **来源状态** link opens `/diagnostics`. The page performs one same-origin `GET /api/v1/diagnostics` on entry, or when **重新读取状态** is explicitly selected. It never polls, calls source `/status` or `/snapshot` routes, changes a gate, or acquires provider data. A 10-second deadline aborts the browser read; the API retains its own narrower SELECT deadlines. Leaving the page aborts the pending read. Rereads are mutually exclusive and discard earlier results before loading, so a failed refresh cannot present old metadata as current.

All source/view names and labels are fixed; unknown schemas, duplicate views, invalid timestamps, HTML/login responses and oversized bodies fail closed. Valid diagnostic 503 responses remain displayable. No raw error, financial payload, source URL, lease identifier or permission credential is rendered. Existing owner-private hosting is unchanged.

Status wording is deliberately limited: idle is **空闲，不代表可用**, a persisted stop stays **已停止**, and unavailable / absent metadata remain distinct. Cache expiry is compared only to that row's database observation time. An unexpired cache is still unvalidated; a missing expiry gives unknown freshness. The results are a read-time snapshot, not an auto-refreshing view.

Acquisition, collection start, cache commit, cache expiry, check and coordination timestamps retain separate labels. Source observation time / financial reporting period is **未核验**, not substituted with acquisition time. No endpoint expansion or financial-payload reading was added to populate that field. The background installation state remains **未知**, even when job records exist. No change in this UI establishes real global data or unattended minute updates.

Validation includes `tests/diagnostics-ui.test.tsx`, existing navigation coverage, `test:diagnostics-runtime`, and full build checks. For safe browser QA, run `node scripts/prepare-diagnostics-browser-fixture.mjs dist <absolute-output-directory>`, then use the supported static preview. This runs the unchanged built Worker in isolated local workerd and keeps its built assets unchanged; an early test-only bootstrap supplies visibly labeled synthetic mixed/expired/stopped/unknown, empty-503, authorization and malformed-HTML scenarios while blocking provider requests. Never deploy the fixture or treat it as live-data evidence.
