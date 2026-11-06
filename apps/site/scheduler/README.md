# Optional, self-managed A-share scheduler

**This is a tested deployment component, not an installed background service.**
The published Sites app remains request-driven. This directory does not enable a
cron trigger, bind an account, create credentials, or change its access boundary.
The checked-in template is disabled and has no triggers or HTTP routes.

## Why this deployment shape

The existing collector supports Cloudflare Workers native fetch and a primary
D1 transaction boundary. It explicitly refuses an unverified Node/proxy runtime.
A generic VPS process calling the owner-only Site would also need authorized
long-lived service access, which is not presently configured. Do not copy a user
cookie, use an assistant reminder, keep a browser open, or repeatedly run a
preview shell as a substitute.

An independently deployed Cloudflare Worker can run the exact existing
`createAshareHandler`, `D1SourceGate`, `D1SnapshotStore`, `D1StageStore`,
`runCollectionBatch` and `consumeReply` against the **same primary D1** as the
Site. The request is an in-process call to the ordinary snapshot handler, not an
HTTP request to the Site and not a new provider adapter. It requires no runtime
password, user session, API token or public webhook. Deployment still requires an
already-authorized Cloudflare account and permission to give this Worker ongoing
access to that D1. This component does not grant that permission or provision it.

Sites publication has not established a supported cron-registration/readback
path. This is a separate, operator-managed Worker deployment. It is not an
arbitrary-VPS implementation and does not prove the current Site's D1 is
accessible to an independently deployed Worker. Verify that hosting capability
before enabling it. If the hosting platform cannot authorize the same binding,
stop: creating a separate database or copying cache/gate rows is not equivalent.

## Scheduling and safety contract

- The intended installed cron is `* * * * *` (UTC), one check per minute.
  One scope is attempted per admitted tick. There is no internal catch-up queue.
  Independently delivered late events from the most recent two minutes can
  arrive close together and each be admitted once, after the previous batch
  settles. The unchanged shared source gate and pacing still apply. This adapter
  does not impose another wall-clock 60-second minimum on such delayed events.
- Default selection is `level1`. Optional comma-separated `BK1234` constituent
  scopes are explicit, unique and capped at eight. No automatic universe or
  industry discovery occurs. Sorted round-robin order is durable. With N scopes,
  each scope's nominal check interval is **N minutes**, not one minute each.
  The same source's pacing and workload can delay that further.
- A batch follows only a validated `collection_in_progress` continuation, with
  the existing 180-second original window, maximum 20 application requests,
  35-second transport bound, 20-second source invocation budget and 3-second
  source request spacing. There is no unlimited inner loop. A batch may overlap
  later minute ticks; busy events are returned without an internal queue. A
  later redelivery is evaluated again against durable ownership and time limits;
  observing a busy event does not permanently consume that event's minute.
- The optional job row provides atomic durable ownership and idempotency for
  admitted minutes across separate Worker instances. Replayed/out-of-order, future, and events
  older than two minutes cannot start a new batch. D1's clock governs admission.
  Scope configuration changes fail closed until deliberately reconciled by an
  operator. A restart does not reset the cursor, token, denial or last tick.
- A crashed or uncertain job is **never expired or stolen**. A transport timeout
  leaves job ownership intact. An uncertain DB completion is reported and the
  completion write is never retried or followed by a separate unlock. If the
  atomic finish actually committed before its reply was lost, a later tick may
  proceed from that durable idle state; if not, ownership remains busy. A
  persistent source denial or unknown source outcome stops the job. Recovery
  requires investigating the actual source and storage outcomes;
  this repository supplies no automatic reset command.
- Source gates, stable pagination, partial-stage retention, complete atomic
  publication, denial/429 stops, normal quiet periods and durable failure
  cooldown remain unchanged. Browser requests and scheduled calls compete for
  the same gate and reuse the same cache. No partial denominator is published.
- The Worker returns 404 to every HTTP request and has no run-now/status API.
  Both workers.dev and preview URLs are disabled. It does not change owner-only
  access on the Site or grant rights to redistribute market data.
- Scheduler logs and status queries contain bounded diagnostics, scope IDs and
  acquisition/check times, never financial rows, user identities or credentials.
  A cached read retains the original oldest-page acquisition time. A minute check
  is not evidence that the provider published a new observation that minute.

## Operator deployment checklist (not performed by this change)

1. Confirm provider permission, hosting support, authorized account and the
   existing Site's primary D1 binding. Review the expanded ongoing access before
   binding a separate Worker. Do not create credentials automatically.
2. Copy `wrangler.example.jsonc` to ignored `wrangler.local.jsonc`. Replace the
   two database placeholders with the verified existing database. Do not commit
   this file or use a new database. Keep `ASHARE_SCHEDULER_ENABLED=false` and an
   empty `triggers.crons` initially. There are no public routes to add.
3. Verify the Site already has its ordinary A-share migrations, including shared
   source gate, durable backoff, snapshot cache and staged acquisitions. Apply
   `schema.sql` through the approved same-D1 migration workflow. It creates only
   two optional scheduler metadata tables and does not reset provider state.
4. Use the account's approved deployment workflow to deploy this independent
   Worker. Review account costs, CPU/runtime quotas and D1 capacity first. Do not
   use a local `wrangler dev` process as the persistent deployment.
5. When permitted, set the exact string `ASHARE_SCHEDULER_ENABLED` to `"true"`,
   choose the explicit scopes, and install `triggers.crons: ["* * * * *"]`.
   Read back the **installed** deployed version, same-D1 binding and cron. Merely
   editing this JSON file or publishing the main Site does not install a trigger.
6. With the browser closed, observe several distinct real scheduled executions,
   source admission, complete-cache acquisition times and the read-only health
   result below. Verify the existing authenticated Site reads those same rows.
   Record denial/cooldown/gap outcomes honestly. Do not claim live data or
   unattended operation based on synthetic tests or a repository commit.
7. Disabling the variable and removing the installed trigger stops future jobs;
   bounded work already admitted may still finish. Preserve the source and job
   rows. Do not clear busy/stopped state to make a health check appear green.

No deployment or migration command is run automatically by npm install, the Site
build, the normal test suite or this directory. The optional schema is deliberately
outside the normal Site migration stream.

## Gap checks and operational visibility

From `apps/site`, an operator with an existing authorized Cloudflare session can
run the read-only check against their explicitly selected remote configuration:

```sh
npm run scheduler:status -- --config scheduler/wrangler.local.jsonc --remote
```

It executes only `status.sql` SELECTs. Exit 0 means the returned metadata reports
healthy/running/source-busy/cooldown, 1 means a gap or actionable state, and 2 means
status could not be verified. It never signs in, requests credentials, changes
permissions or repairs a gate. Missing tables or binding are errors, not healthy.

Connect this command (or the equivalent SQL) to an **independent authorized
monitor** after deployment. No monitor or notification recipient is installed by
this change. Worker logs alone cannot detect a missing cron or a stopped Worker.
The query reports:

- `never_ran` before any scheduler event;
- `tick_gap` when no observed tick arrives for over 180 seconds;
- `admission_gap` when ticks arrive but no job is admitted for over 180 seconds;
- a job still busy after 210 seconds as `outcome_unconfirmed`;
- per-scope check and complete-acquisition gaps after N minutes plus the
  180-second bounded batch allowance;
- persistent source refusal, unknown source outcome and cooldown separately.

These are monitoring tolerances, not an assertion that data less than that age is
fresh. The normal 60-second cache freshness and the original source timestamp
uncertainty remain unchanged. `last_acquisition_ms` tracks the oldest collected
page, not the time the monitor or a cached read ran. Status does not read payloads
or change any state. Configuration mismatch and denied outcomes require review.
The existing Site's `background_collection:false` describes its built-in
request-driven collector; this optional independent deployment has its own
installation and health evidence and is not auto-discovered by that flag.

## Offline verification

```sh
npm test -- --run tests/ashare-scheduler.test.ts tests/ashare-scheduler-store.test.ts
npm run test:ashare-scheduler-runtime
npx tsc --noEmit
npm run lint
```

The native test invokes real workerd **scheduled events**, using synthetic
provider responses and real local transactional D1. It tests disabled behavior,
missing schema, two separate scheduler isolates, a real elapsed minute with no
page accesses, ten-page continuation, shared owner-handler cache/gate behavior,
403/429 refusal, durable cooldown, round-robin selection and no ownership theft.
All outbound requests are intercepted and exact-host checked. No cloud account,
remote database, provider, credential, cron installation or production deployment
is touched. These tests verify the component, not live hosting or data access.

Cloudflare references for the deployment operator:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- https://developers.cloudflare.com/d1/worker-api/
