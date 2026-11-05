# FinanceFlowAtlas architecture

Reviewed 2026-11-05 against main `6715f086`, including CVM and the unified FX/crypto matrices.
The global-country matrix migration below builds on that baseline.
This is a modular monolith. Adding another market must not require another copy
of the renderer, or pretend that its financial measure equals another source's.

## 1. Product boundary

Every supported asset page should lead with a matrix/heatmap. The data must still
say what it measures: a price, holding, trade count, participant transaction,
cross-border transaction or direct investment. A common visual language is not a
common financial denominator. There is no defensible single “global capital
inflow” total across these layers.

A geography registry is navigation, not proof of financial coverage. A geography
map may remain an alternate navigation view; it is not the substitute for each
asset's matrix. No country, industry or instrument gets a synthetic value merely
to fill a tile. The evidence matrix shows only the source's actual dimensions.

## 2. What actually runs

There are two separate application paths in this repository:

- **Hosted product:** `apps/site`, React/Vinext running on Cloudflare Workers,
  with source-specific server modules in `lib/`, route entrypoints in `app/`,
  D1 coordination/cache tables, and private host authentication. This is the
  application whose matrix pages are being extended.
- **Python data service and research frontend:** `apps/api`, `apps/worker`,
  `apps/cli`, `packages/core`, and `apps/web`. These support the separately run
  Python ingestion/query pipeline. They are not implicitly running behind Sites.
  `packages/contracts` is not currently the contract for every hosted adapter.

A source must identify its execution path. Do not import Python into Workers,
pretend a frontend poll schedules the Python worker, or add a second implementation
unless a real consumer needs it. Keep the Python service intact; replacing it is
not a prerequisite for fixing the hosted matrices.

The hosted path is:

```text
private route
  -> source handler/service
  -> independent source admission gate
  -> bounded transport -> source parser/validation -> validated snapshot
  -> permitted cache + response schema
  -> client lifecycle -> pure source-to-matrix projection -> matrix renderer
```

`host.ts` is the platform wiring boundary (`env.DB`, `waitUntil`). Parsers,
projections and display models must not import that boundary. Authentication is
separate from source access: a public dataset does not make the application public.

## 3. Dependency boundaries

Keep the existing source folders rather than doing a disruptive folder rewrite.
Use these responsibilities consistently:

| Boundary | Current examples | Owns | Must not own |
| --- | --- | --- | --- |
| Source contract | `lib/futures/model.ts`, `lib/asean/model.ts` | Schema, units, source identity, timestamps, validation, expiry rules | JSX, router, D1, fetching |
| Source adapter | `lib/*/adapter.ts`, CVM parser/transport | Official coordinates, parsing, joins, budgets, exact financial calculations | Rendering, navigation |
| Application service | `lib/*/handler.ts`, `lib/fx/service.ts` | Admission, refresh, cache publication, error transitions | Chart layout |
| Platform adapter | `lib/*/host.ts`, `source-gate.ts` | Worker lifetime and atomic D1 operations | Financial interpretation |
| Matrix projection | `components/futures/matrix.ts`, `components/tpex/matrix.ts` | Pure transformation from validated evidence to labeled display values | Fetching, React, source admission |
| Presentation contract | `lib/matrix/model.ts` | Item/group types, scale classification, accessible labels, layout weights | Provider units, financial inference |
| Renderer | `components/matrix/MatrixHeatmap.tsx` | Layout, focus/hover, keyboard selection, readable density | Fetching, source conversion, data repair |
| Page/controller | `components/*/*Workspace.tsx`, source page components | Scope, filters, selected item, lifecycle composition | A new parser, gate or copy of chart logic |

The projection directory location is historical, not permission to depend on JSX.
Projection types now import the pure matrix model; compatibility re-exports keep
existing consumers working. New sources should use the pure import directly.

## 4. Evidence is not just a number

Keep source-specific discriminated schemas. Do not replace them with a giant
optional-field `MarketData` object. Each source contract must make these concepts
explicit when applicable:

- Source and version, exact instrument/geography/classification coordinates.
- Financial measure and unit, including currency, multiplier and precision.
- Observation date/interval, source publication time if known, acquisition start,
  successful acquisition time and last attempted check. Unknown stays unknown.
- Coverage universe and observed subset; partial/confidential/unmatched/ambiguous
  counts; classification date and whether it is point-in-time.
- Measured zero versus missing, unavailable, source `n.a`, confidential, duplicate
  or quarantined data. A numeric null cannot silently become zero.
- Source URLs, relevant license/attribution, and hashes when provided by that
  source's verified acquisition design.

Shared display state is a separate concept from evidence state:

- Loading means a specific request is active, not simply that a snapshot is null.
- Unavailable means no displayable verified snapshot; the reason remains visible.
- Stale means an eligible last-good snapshot remains, with its original time.
- Expired means the evidence is no longer displayable; failed checks do not renew it.
- Denied/permission stop clears the relevant evidence and does not automatically retry.
- An uncertain acquisition outcome is not a temporary error that authorizes lease
  takeover. A generic “waiting for data” message must not hide this condition.

`MatrixItem` deliberately contains display values, color values and positive
layout weights only. Rich evidence remains in the source model, selected by stable
IDs. The renderer never parses a formatted number or reconstructs hidden evidence.

## 5. One matrix language, appropriate geometry

`MatrixHeatmap` is the common grouped-item renderer for futures, TPEx, CVM, FX,
crypto and TIC country evidence. It supports:

- Treemap for a small/hierarchical dataset with explicit area semantics.
- Readable equal-area grid for dense industry/security data. All names remain
  visible and keyboard accessible; scrolling replaces illegibly small labels.
- Explicit color and area descriptions, a fixed scale when comparisons require
  one, and source-appropriate empty title/message/note.
- A shared selection/readout model independent of D3. Readable grids do not run
  a discarded treemap layout.

The existing ASEAN country × industry table is a genuine two-dimensional matrix.
Do not flatten it into unrelated rectangles just to claim a single component.
A-share still has a specialized industry treemap. Migrate its common mechanics
only after preserving its source-specific drilldown. TIC now uses the common
readable grid, preserving region/country navigation and treating a reported zero
as a neutral equal-area tile, rather than dropping it from the primary view. A
small family of renderers sharing a presentation contract is preferable to a
universal widget with dozens of source-name conditionals.

Rules for any projection:

1. Declare the selected measure, unit, color meaning and area meaning.
2. Compute scale from the intended comparable universe, before search filtering.
   Filtering must not silently recolor an unchanged value.
3. Use equal areas unless a meaningful, validated positive weighting exists.
4. Retain original precision in details; round only the display deliberately.
5. Resolve selection against the current snapshot. Never retain a stale object
   when a refresh changes or removes the selected item.
6. Do not aggregate overlapping classes, totals plus components, incompatible
   currencies, contract units, coin volumes or observation periods.

Examples: CFTC net position / open interest is a holding ratio, not money flow.
ECB rates against EUR have different currency units and should not be colored as
inflows. Kraken last-price deviation from rolling-24h VWAP can be an explicitly
labeled calculated ratio, but is not a 24h return. Base-coin volumes across BTC and
ETH are not a shared monetary scale. CVM fund net share transactions in BRL are
partial disclosed fund activity, not all Brazilian or foreign investment.

### Global entrypoint

`/markets` leads with the existing TIC monthly US-equity net-transaction layer,
not a fabricated worldwide market-flow total. `lib/tic/model.ts` owns its display
contract; `lib/tic/matrix.ts` projects a single validated period to region →
reported foreign residence; `TicMatrix` composes source controls with the common
renderer. `TicLayer` remains responsible for the existing source lifecycle,
country evidence, optional map and provenance. The projection does not fetch.
Geographic views and total history are code-split and mounted only on demand.

TIC color magnitude uses the full source period before filtering. Equal country
areas make zero observations visible and do not imply fund size. Palette choices
swap rendering colors only, without changing values or signs. Missing countries
get no invented tiles. Published issuer totals and their history stay separate
from country records; history is loaded only when expanded below the matrix.

`GeographicNavigator` is a secondary, read-only 249-entry directory. Opening it
never claims that 249 countries have financial observations. Direct country URLs,
keyboard/map search and local-market links remain available. A-share, TPEx, CVM
and ASEAN entry links keep their own units, periods, sources and acquisition gates.
The global page neither fetches them speculatively nor adds their values to TIC.

## 6. Cadence and persistence are source policies

Never use one global refresh interval or cache TTL for all assets. A UI refresh,
provider acquisition, report period, publication time and hard display expiry are
five different things. Current code has materially different policies:

| Source | Evidence | Acquisition/cache distinction |
| --- | --- | --- |
| A-share/Eastmoney | Provider-estimated participant-order net figures | 60-second evidence check; separate shared quiet/cooldown coordination; observations ephemeral |
| Sina | Provider industry quotes | Five-minute refresh; ephemeral evidence and independent coordination |
| Treasury TIC | Monthly residence-based US equity transactions | Read-through report discovery/history, separately persisted validated reports |
| ECB | Daily reference rates | One-hour success cooldown, seven-day acquired-cache expiry; shared validated D1 cache |
| Kraken | Online USD spot catalog and ticker/rolling-24h metrics | One-minute ticker check, fifteen-minute catalog refresh and acquired-cache expiry; metadata-only D1 gate |
| CFTC | Weekly selected-contract positions | Hourly check, daily acquired-cache expiry plus separate report-age limits |
| TPEx | Daily participant net share transactions | Hourly check, daily acquired-cache expiry plus separate report-age limits |
| ASEANstats | Annual net inward FDI | Daily check, seven-day acquired-cache expiry; annual observation is not real time |
| CVM | Monthly publicly disclosed fund share transactions | Daily check, seven-day acquired-cache expiry plus report-age limits; conservative M−2 selection |

The implementation and each `docs/source-*.md` are authoritative for exact limits.
The table is not a new scheduler or permission to acquire any source. Persist
market observations only where the source's existing rights and design permit it;
do not turn the metadata-only A-share/Kraken gates into payload caches by sharing
an implementation. No observations or runtime DB state enter Git.

## 7. Concrete debt and the safe reduction order

This audit found real duplication; it does not justify a framework rewrite.

1. **Pure matrix model and renderer boundary: now.** Types and layout/color helpers
   formerly lived in the React component, so pure source projections imported a
   UI module. Readable grids calculated an unused D3 treemap. The extracted
   `lib/matrix/model.ts` and renderer tests remove those dependencies without
   changing acquisition, schema, gates or stored evidence.
2. **Source-neutral runtime primitives: next isolated change.** Most source gates
   import `SourceGateError`, `GateD1`, `D1Result` and `strictJSON` from `lib/ashare`.
   Move these unchanged to a small `lib/source-runtime/` module, keep compatibility
   exports, and assert no cross-source imports remain. This is ownership repair,
   not a new source adapter framework. No SQL or migration change is needed.
3. **Client lifecycle: extract after characterization.** ASEAN, TPEx, futures,
   crypto and CVM duplicate abort controllers, single-flight fetch, permission
   stop, payload parsing, timeout, mounted/request identity, polling, visibility
   changes and cleanup. First parameterize the common test cases, then extract
   one `useEvidenceSnapshot` hook with an explicit source endpoint, decoder,
   cadence and visibility/expiry function. Keep source financial logic, filters
   and selection outside it. Preserve the distinct FX and A-share semantics until
   a shared hook can express them without source-name switches.
4. **Server lifecycle: separately characterized extraction.** TPEx, ASEAN, CFTC and
   CVM repeat retained refresh, gate settlement and snapshot publication. Extract
   only a small retained-operation helper first. `waitUntil` must accept lifetime
   before admission; request cancellation must not abandon an admitted D1 write;
   late settlement must remain retained; uncertain outcomes must fail closed.
   Do not merge all gate implementations first or reset existing busy/blocked
   rows. Shared caching versus metadata-only storage remains explicit.
5. **Source/page catalog: only after the contracts settle.** Navigation now has
   route/source entries in multiple places. A small typed catalog can own IDs,
   routes, labels, measure class and coverage copy. It must not eagerly import
   server adapters into client bundles or become a dependency-injection/plugin
   framework. Routes remain simple composition; adding a source includes tests,
   documentation and a matrix projection, not another chart fork.

No new service, queue, event bus, generic repository layer, global mutable data
store or class inheritance tree is warranted. Do not add an abstraction used by
only one provider. Keep files formatted and focused; minified one-line handlers
make ownership, cancellation and denial review harder.

## 8. Verification and release gates

Each refactor is a small, independently reviewable commit. Preserve source behavior
before extending it, and test the exact integrated head after merges:

- Pure parser/projection tests: units, precision, signed values, missing/zero,
  duplicates, partial coverage, fixed scale and non-comparable observations.
- Renderer tests: empty data, keyboard drilldown, current-selection refresh,
  narrow viewport, dense labels, scroll preservation and no fixture fallback.
- Client lifecycle: repeated clicks, overlapping refresh, unmount, permission
  loss, malformed payload, transient 5xx, hidden-tab expiry and late old response.
- Native workerd/D1: concurrent warm/cold workers, shared cooldown, bounded
  decompression, cancellation before/after admission, late DB settlement,
  permanent denials, expiry and original gate-state preservation.
- Full site test suite, TypeScript, ESLint and production build. Run Python tests
  when shared repository integration changes that application's path.
- Apply only append-only authorized migrations. Repository checks do not prove
  deployed source access; verify authenticated deployment separately. Never reset
  denied or uncertain source gates to make a demo appear populated.

Completion means the relevant asset has a truthful matrix, preserves its source
scope and failure state, passes the required checks and has verified deployment
when deployment is in scope. A generic empty canvas alone is not completion.
