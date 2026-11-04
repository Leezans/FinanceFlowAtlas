# Architecture v0.2

Monorepo; modular monolith, no microservices required. apps/web consumes apps/api; API/worker/CLI reuse packages/core. The frontend never independently interprets vendor units or invents financial flows.

`provider -> raw immutable content-addressed file -> normalize -> validate -> atomic snapshot -> query API -> 60-second client poll -> global map`

- Source: IMF PIP equity only, six-month period, reporting-resident to issuer-resident geography.
- All ISO 3166-1 249 countries/territories remain queryable even without observations. This registry size is not source coverage. Polygons may omit microterritories, which must remain searchable.
- No aggregate locations or domestic rows become bilateral edges. No total+sector or total+asset double counting.
- Position stock, transaction flow, activity proxy and price are incompatible concepts. This first map renders positions only.
- `period` is observation interval; `published_at` is source publication metadata; `retrieved_at` is local acquisition time. This version is not a historical point-in-time release archive.
- SQLite/WAL stores immutable validated snapshots plus task state; raw data is separate. Later production can move to PostgreSQL/object storage behind the same service contract.
- A failure preserves the last good snapshot but publishes an error state. UI must show stale/error status. One process lock prevents duplicate ingestions. A worker restart can retry interrupted refresh.
- Client poll interval 60 seconds; ETag handles unchanged snapshots. It does not request IMF every minute. Explicit worker loop checks due time; this semiannual source is rechecked once per day for revisions. Its configured observation period does not auto-discover newer releases yet.
- No queue/WebSocket/SSE, external credential, automated trading or persistent server guarantee.

## Source verification gate
SCALE must not be blindly used as a multiplier. Adapter currently requires operator-reviewed unit semantics before publishing amounts. Unknown units, nonfinite/negative amounts, duplicates, malformed data and empty validated sets fail publication.

## Migration
legacy/ preserves v0.1 reference implementation for traceability; not part of the new runtime. Existing private Site remains v0.1 until a compatible Python hosting plan is selected. This monorepo does not pretend Cloudflare Workers can directly host a Python FastAPI service.
