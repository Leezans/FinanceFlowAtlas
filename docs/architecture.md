# FinanceFlowAtlas architecture

Financial display and country-entry contracts reviewed 2026-11-06 against main
`c7437e6da6bdaebe9a1ed8b9c6ca963d48523844` (private Site v59 source).
See [the cross-market audit](cross-market-audit-2026-11-06.md) for evidence and limits.
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
| Presentation contract | `lib/matrix/model.ts`, `lib/matrix/layout.ts` | Item/group types, declared amount comparability, scale classification, accessible labels, monetary geometry | Provider units, financial inference |
| Renderer | `components/matrix/MatrixHeatmap.tsx` | Layout, focus/hover, keyboard selection, readable density | Fetching, source conversion, data repair |
| Page/controller | `components/*/*Workspace.tsx`, source page components | Scope, filters, selected item, lifecycle composition | A new parser, gate or copy of chart logic |

The projection directory location is historical, not permission to depend on JSX.
Projection types now import the pure matrix model; compatibility re-exports keep
existing consumers working. New sources should use the pure import directly.

Current-report exports follow a separate [evidence presentation boundary](evidence-architecture.md):
source projections and typed views retain their meanings, an exhaustive dispatcher
only routes them, and the local Blob helper has no financial-model dependencies.

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

`MatrixItem` contains display values, independent color values and optional
source-declared `amount: {value, currency, comparisonKey}` metadata. A signed
amount retains its sign; the layout uses its absolute value. The legacy `weight`
field does not determine area. Rich evidence remains in the source model, selected
by stable IDs. The renderer never parses formatted text or derives money from a
price, return, volume or color value.

## 5. One matrix language, appropriate geometry

`MatrixHeatmap` is the common grouped-item renderer for A-share, futures, TPEx,
CVM, FX, crypto, TIC, Japan MOF, annual equity context and Polymarket evidence.
It supports:

- Amount-weighted treemaps when all entries declare the same currency and
  comparison key. Area is proportional to absolute monetary amounts without
  minimum sizes, padding, signed cancellation or top-N truncation.
- Readable information cards when comparable monetary amounts are absent.
  Card width does not assert financial size. A legacy `layout` prop cannot
  override the declared amount contract.
- Optional wheel zoom, drag/pan, keyboard controls and complete numeric details
  for monetary matrices. Zero and missing amounts receive no invented area and
  remain distinguishable in the details.
- Explicit color and area descriptions, a fixed scale when comparisons require
  one, and source-appropriate empty title/message/note.
- A shared selection/readout model independent of D3. Readable grids do not run
  a discarded treemap layout.

The ASEAN country × industry table preserves its two-dimensional coordinates.
Selecting one receiving country also enables a same-year monetary treemap for
its comparable specific industries, excluding overlapping/unspecified categories.
A-share now uses the shared monetary renderer while retaining its source-specific
industry-to-stock exploration and full numeric table. TIC uses the shared
monetary renderer with region/country navigation. A small family of renderers
sharing a presentation contract is preferable to a universal widget with dozens
of source-name conditionals.

Rules for any projection:

1. Declare the selected measure, unit, color meaning and area meaning.
2. Declare the color-scale universe. Full-source or fixed scales remain stable
   through filtering; a current-visible-sample scale must explicitly say so.
3. Declare comparable monetary amounts in their stated base currency unit before
   assigning area. Normalize source multipliers such as USD millions, BRL cents
   and 100 million JPY in the source adapter or projection, never in the renderer;
   do not convert values already normalized by the adapter a second time.
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

`/markets` selects a country's own market and defaults to China. Only the selected
country workspace mounts. Current independent entries are China A-share order
classification estimates, Taiwan TPEx institutional amounts, Japan MOF
nonresident Japanese-security transactions and Brazil CVM disclosed fund trades.
Each preserves its participant scope, observation period and currency. The Japan
entry is explicitly a cross-border sample, not all Japanese domestic investors.
The U.S. and other unconnected countries retain empty own-market matrices; no
TIC counterparty, price, volume or simulated value fills that gap.

TIC is available only in the separate U.S. cross-border supplement, mounted when
opened. `lib/tic/model.ts` owns its contract; `lib/tic/matrix.ts` projects a single
validated period to region → reported foreign residence. `TicLayer` owns its
source lifecycle, country evidence, optional map and provenance. The security
issuer remains the United States for every country row. The projection does not
fetch; the country entrypoint does not combine these values into a global total.

TIC color magnitude uses the full source period before filtering. Country area
uses the absolute net transaction amount in USD, and region area sums country
magnitudes without sign cancellation. Reported zero remains in details without
area; missing countries get no invented tiles. Palette choices change colors,
not values or signs. The published issuer total and its history stay separate
from country rectangles; history is loaded only when expanded below the matrix.

`GeographicNavigator` is a secondary, read-only 249-entry directory. Opening it
never claims that 249 countries have financial observations. Direct country URLs,
keyboard/map search and local-market links remain available. Country-specific
and independent asset pages keep their own units, periods, sources and gates.
The World Bank/WFE annual equity page is a separate market-size/liquidity context:
capitalization and traded value are never net-flow substitutes, mixed-year area
weights or a complete global total.

## 6. Cadence and persistence are source policies

Never use one global refresh interval or cache TTL for all assets. A UI refresh,
provider acquisition, report period, publication time and hard display expiry are
five different things. Current code has materially different policies:

| Source | Evidence | Acquisition/cache distinction |
| --- | --- | --- |
| A-share/Eastmoney | Provider-estimated participant-order net figures | Request-driven 60-second evidence checks; independent shared coordination and bounded owner-only D1 snapshots |
| Sina | Provider industry quotes | Five-minute refresh; ephemeral evidence and independent coordination |
| Treasury TIC | Monthly residence-based US equity transactions | Read-through report discovery/history, separately persisted validated reports |
| ECB | Daily reference rates | One-hour success cooldown, seven-day acquired-cache expiry; shared validated D1 cache |
| Kraken | Online USD spot catalog, rolling-24h metrics and selected trade windows | Visible-page minute checks, fifteen-minute catalog reuse/display expiry; bounded owner-only D1 evidence cache and independent gate |
| CFTC | Weekly selected-contract positions | Hourly check, daily acquired-cache expiry plus separate report-age limits |
| TPEx | Daily participant net share transactions | Hourly check, daily acquired-cache expiry plus separate report-age limits |
| ASEANstats | Annual net inward FDI | Daily check, seven-day acquired-cache expiry; annual observation is not real time |
| CVM | Monthly publicly disclosed fund share transactions | Daily check, seven-day acquired-cache expiry plus report-age limits; conservative M−2 selection |

The implementation and each `docs/source-*.md` are authoritative for exact limits.
The table is not a new scheduler or permission to acquire any source. Persist
market observations only where the source's existing rights and design permit it.
A-share and Kraken now have separate, explicitly bounded snapshot stores alongside
their admission gates. That does not authorize caching other providers or extending
retention. Page checks are access-driven, not an installed unattended collector.
No observations or runtime DB state enter Git.

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
