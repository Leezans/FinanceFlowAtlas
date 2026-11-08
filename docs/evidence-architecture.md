# Current-report evidence architecture

This guide covers the hosted app's read-only evidence panels in `apps/site`.
[Source semantics, export scope and retention rules](organized-report-projection.md)
remain the contract. A common row shape does not make the sources financially
comparable.

## Responsibilities and dependency direction

1. **Existing page/controller:** obtain and validate the source response, apply
   its permission, scope and age policies, and select the visible snapshot.
   Preserve each source's current click-time guard. Pass null when evidence is
   no longer allowed. The export does not make another source request.
2. **Source projection in `lib/evidence/*-projection.ts`:** organize that selected
   snapshot using its own report contract, native locators, units, missing states,
   classification and clocks. Keep source-specific validation and provenance here.
   Do not add cross-source calculations or a universal optional-field report.
3. **`components/evidence/OrganizedEvidence.tsx`:** dispatch only, by the report's
   `source_id`. It forwards the exact report object and click handler to a typed
   source view. An exhaustive switch makes an unhandled new report a type error.
   It does not inspect rows, choose columns, serialize JSON or acquire data.
4. **Source view:** own the source's wording, column order, value-state labels,
   preview limit and filename. Render the already permitted report without
   changing its financial values or lifecycle.
5. **`BlobEvidenceDownload.tsx`:** prepare a local file, keep it associated with
   the exact report object, and clean up its URL. It knows no financial model,
   source identifier, period, unit, permission or age policy.

The shared `EvidenceRow` type lives in `lib/evidence/types.ts`. This file has no
runtime implementation or source imports. Projections that use the shared row
shape import it directly. `report-projection.ts` re-exports the same type for
compatibility, but its Japan/TPEx implementation is not the shared type boundary.
Source-specific row extensions remain in their own projection modules. Sources
with different value types, such as exact decimal strings, keep those types.

## Source views

All names below are under `components/evidence/`:

- `OrganizedMonetaryEvidence.tsx`: the original Japan MOF and TPEx monetary view.
  This small historical pair keeps its JPY/TWD units and weekly/daily labels
  distinct. It is not a default renderer for unrelated sources.
- `OrganizedAshareReportEvidence.tsx`: current-scope f62 evidence and missing
  markers. The similarly named `components/ashare/OrganizedAshareEvidence.tsx`
  remains the controller for A-share scope, expiry and click-time checks.
- `OrganizedTpexShareEvidence.tsx`: companies, dated official industries,
  participants, overlapping participant totals and original share counts.
- `OrganizedCvmEvidence.tsx`: securities, acquisition-time classifications,
  integer-cent values, unavailable aggregates and their original value origins.
- `OrganizedCftcEvidence.tsx`: contract markets, application navigation categories,
  contract specifications and current/previous position observations.
- Existing `OrganizedDeribitEvidence`, `OrganizedKrakenTradeEvidence`,
  `OrganizedPolymarketEvidence` and `OrganizedPolymarketInterestEvidence` retain
  their independent source contracts and renderers.

Preview-limit constants belong to their source views. The dispatcher re-exports
existing constants so imports outside the component remain compatible. TPEx
shares, CVM and CFTC still preview at most 120 rows while exporting every row.
A-share and the original monetary pair retain their existing full previews.
The monetary pair still uses synchronous data URLs. A-share uses the shared
Blob helper and a memoized projection, as described below.

Some panel structure and wording deliberately repeats. Sharing local file
mechanics is useful; hiding incompatible source meanings behind a configuration
object or a table with optional source-dependent columns is not. Source views
should be readable without following another source's branches or guessing a
row's identity from property presence.

## A-share report identity and visibility

`components/ashare/OrganizedAshareEvidence.tsx` still checks current scope,
permission and acquisition age on every render. Only the projection is memoized,
by the resulting visible snapshot identity and the combined retained-stale flag
(`status`, `retainedAfterFailure`, `retainedDuringCollection`). Clock samples,
equivalent scope objects, successful unchanged 304 responses and unrelated state
messages therefore reuse the report and local file. New snapshot identities or
changes in the combined stale flag replace them; no deep comparison is used.

The existing oldest-acquisition 24-hour boundary, focus/pageshow/visibility
resampling and final click-time visibility check remain in the wrapper. A
mismatched scope or denied/expired report becomes null before the view renders,
so memoization cannot preserve its link. The shared Blob lifecycle cancels pending
serialization or revokes the file on withdrawal and replacement. It does not
extend retention or make another source request.

The A-share view no longer serializes or URI-encodes the report during render.
It shows the shared preparation/failure messages in the download slot, then
offers a Blob containing exactly `JSON.stringify(report, null, 2)` as before.
The native field allowlist, complete scope, zero/missing distinctions, full table,
filename and financial wording are unchanged. Full-table rendering is not
memoized or virtualized, and Blob serialization still runs on the main thread
after the deferred timer. This does not introduce a background worker.

## Local Blob contract and lifecycle

The helper takes a JSON-serializable object, a filename and an optional anchor
click handler. The caller owns validation and supplies a stable, immutable report
object. Identity, not deep equality, determines whether a file must be replaced:

- Preparation is deferred with a cancellable timer, not performed during render.
- An ordinary rerender with the same report keeps the file. Filename and click
  handler changes take effect without rebuilding it.
- A new report identity immediately hides the previous download, even before the
  new file is ready. Effect cleanup revokes the old URL and cancels its pending
  preparation. Only a resource associated with the current object is displayed.
- Unmount or report withdrawal revokes the prepared URL and cancels pending work.
  Replacement followed by failed preparation cannot leave the old link available.
- Serialization, Blob construction or URL creation failure shows the existing
  failure message and no link. A serializer returning undefined is also a failure,
  not a downloadable file containing non-JSON text.
- The supplied click guard remains on the actual anchor. Only the page/controller
  knows whether that source is still permitted and unexpired at click time.

There is no upload, new endpoint, source request, storage, worker, permission gate,
TTL or financial conversion in this helper. Files already saved by the user
cannot be revoked. Mutating an existing report object in place is unsupported;
replace its identity when the permitted report changes.

## Verification and future changes

- `tests/evidence-architecture.test.ts` checks routing all current source IDs,
  exact prop forwarding, source-specific report contracts, neutral type imports,
  compatibility and the file helper's lack of financial dependencies.
- `tests/organized-evidence-view-regression.test.tsx` and its synthetic fixture
  `tests/fixtures/organized-evidence-views.json` preserve pre-extraction DOM and
  JSON digests captured at `28b13ba`. They cover all six extracted source IDs,
  ready/stale states, A-share industry/constituents, large TPEx/CVM previews and
  both CFTC schemas. DOM digests include labels, cell order, attributes and
  filenames, with layout whitespace normalized and a fixed synthetic Blob URL.
  For A-share only, the later Blob migration's pending slot and ready href are
  asserted separately, then mapped back to the legacy link for DOM comparison.
  No original fixture digest was replaced for that migration.
  The JSON check uses exact exported bytes. These are not provider observations.
  A deliberate UI or export change requires reviewing the corresponding baseline,
  not blindly accepting a digest mismatch.
- `tests/blob-evidence-download.test.tsx` isolates deferred preparation, identity
  stability, repeated replacement, cleanup, cancellation, StrictMode, failed
  serialization/URL creation, recovery and current click handlers.
- `tests/organized-ashare-performance.test.tsx` checks operation counts rather
  than timing thresholds. Before the migration, two ordinary rerenders and three
  resume events caused five projections, five report serializations and five URI
  encodings. The regression now requires zero of each for unchanged evidence,
  while changed reports still rebuild. It also checks deferred serialization and
  exact JSON bytes. The A-share lifecycle suite checks cancellation before file
  preparation, repeated allowed clicks, replacement and all withdrawal paths.
- Existing `organized-*-projection`, `organized-*-lifecycle` and
  `organized-report` suites remain the source semantics and page-integration
  checks. The architecture tests do not replace permission/expiry regressions.

When adding a source, first establish its validated snapshot and visibility
policy. Add its own projection and view, route its discriminant explicitly, and
exercise both data fidelity and interrupted lifecycle behavior. The Blob helper
must not need a new financial import just because another source uses it.
