# Organized current-report evidence

`apps/site/lib/evidence/report-projection.ts` projects the actual retained Japan
MOF and TPEx institutional monetary snapshot fields into one read-only envelope.
`apps/site/lib/evidence/ashare-projection.ts` extends that envelope to the current
A-share industry or constituent snapshot, using the same preview and download.
`apps/site/lib/evidence/tpex-share-projection.ts` adds the current TPEx company,
official industry and institutional-participant share snapshot.
`apps/site/lib/evidence/cvm-projection.ts` adds the current Brazil CVM disclosed
fund-equity transaction snapshot, preserving its native integer-cent amounts.
`OrganizedEvidence` consumes that envelope for both a collapsed preview table and
an actual local JSON download. It is not an unused schema or a source directory.
The original heatmaps, adapters, stored payloads, APIs and source gates are unchanged.

## Included data

- Japan MOF: three asset classes × acquisitions/dispositions/net, plus the
  official report total. Native unit remains `JPY_100_million`; multiplier is
  metadata only, never an implicit conversion. The retained schema contains
  only total net. Total acquisitions/dispositions therefore have null values,
  `not_in_retained_snapshot` state and no invented native locator.
- TPEx monetary institutional report: foreign investors excluding dealers,
  investment trusts, dealers and reported total × buy/sell/net. Native unit TWD.
- TPEx company institutional report: every company × all four participant
  categories × buy/sell/net. Native unit is `shares`, with currency and monetary
  multiplier both null. This is separate from the TPEx TWD report.
- CVM: every catalog security × buy/sell/net from the existing display snapshot.
  Native unit remains `BRL_cents`, with `currency: BRL` and multiplier `0.01`
  declared only as metadata. No additional totals or currency conversion.
- Every reported observation has its source-scoped dimension, metric ID, original
  value and actual native field path. The validated native snapshot is included
  alongside the organized rows for self-contained traceability, with the A-share
  row allowlist described below. Zero is `reported`, never missing.
- The reported totals overlap components. Rows are tagged `reported_total` versus
  `component`; there is no aggregator or cross-source comparable total. MOF
  rounding differences are retained, not repaired by summing rounded components.
- Envelope preserves source schema, URLs, license and attribution, reporting
  period and calendar zone, country with role, acquisition/fetch clocks, source
  update date when retained, unknown publication time and absent raw hash as null.
  CVM retains its two existing CDA/FCA archive SHA-256 hashes instead of null.
  It contains no industry/instrument classification where the source has none.

### CVM disclosed fund equity transactions

- The panel below the Brazil heatmap projects its exact `visibleSnapshot` result.
  Industry drilldown and security selection do not narrow the file. Projection
  is memoized by snapshot and stale state, not ordinary clock ticks or filters.
- Security identity uses `CVM.FCA.Codigo_Negociacao`; industry identity uses the
  exact Portuguese `CVM.FCA.Setor_Atividade` string. Display translations never
  merge source identities. No company/fund identifier, contact record, raw
  archive row, guessed exchange MIC or cross-source classification is added.
- Observation month and its calendar start/end remain separate from acquisition
  start, successful retrieval and classification acquisition date. The source
  does not retain an observation timezone, so it remains null rather than being
  inferred from the UTC retention clock. `classification_point_in_time: false`
  is explicit both in report metadata and row industry metadata: FCA joins use
  the version available at acquisition, not a historical classification snapshot.
- Buy and sell are the original adapter's sums of eligible public CDA transaction
  rows. Net is its buy-minus-sell difference, not a separate source-reported net
  flow. `value_origin` and source field names distinguish these origins without
  recalculating values. All amounts and their native paths retain integer cents;
  the preview never presents `2001 BRL_cents` as `2001 BRL`.
- A null flow produces three `source_aggregate_unavailable` rows. The native
  locator points to the actual null `rows[i].flow`; `expected_metric_locator`
  identifies the schema field that is not present. Null can mean no eligible
  record, an incomplete amount or duplicate quarantine. The per-security cause
  is not retained and is not invented. An aggregate zero remains `reported`.
  Source-row counts and their native locators are preserved for each security.
- No industry or market total is added, so exported rows are components only
  and `total_overlaps_components` is false within this file. The existing
  heatmap's industry subtotals overlap those securities and cannot be added to
  them. Public and confidential fund counts can overlap as well; all original
  matched/unmatched/ambiguous/null/duplicate/confidential counts stay separate.
  Confidential amounts are never assigned to a security or industry. The scope
  remains public disclosed fund transactions, with `net_capital_flow: null`,
  not all institutions, new cash into companies or whole-market capital flow.
- Provenance includes both retained deterministic archive URLs, their official
  catalog pages, the two actual archive hashes, ODbL-1.0 and existing attribution.
  Hash scope is explicitly source archives, not a hash of the organized JSON.
  Strict native schema validation at every level rejects extra properties
  instead of copying potentially private data into the file.
- Preview is limited to 120 rows. The local Blob JSON retains all allowed 3,000
  securities × 3 metrics = 9,000 rows and the validated native snapshot. It uses
  the same preparation, replacement, failure and cleanup behavior as TPEx shares.
  JSON generation still scales with the full snapshot even though DOM work is
  bounded; it is not streaming acquisition or a new historical-data service.

### TPEx company, industry and participant share evidence

- `source_id: tpex-shares` remains distinct from `tpex-money`. The panel is below
  the existing company/industry heatmap and projects its exact `visibleSnapshot`
  result. Industry drilldown, company selection and participant filters never
  remove records from the export. The projection is memoized by snapshot and
  stale state, so filters and unchanged clock ticks do not rebuild the file.
- Each row's primary `dimension` identifies the company in `TPEx.security_code`.
  `industry` preserves its `TPEx.industry_code`, official classification date,
  label and native code locator. `participant` identifies total, foreign, trust
  or dealer in `TPEx.institutional_participant`. Identical labels never merge
  codes. Unknown industry names stay explicitly unverified. No global taxonomy,
  exchange MIC, historical classification or industry aggregate is invented.
- The source's matched company count, missing company count, total company
  roster count, source security count and excluded unmatched security count stay
  separate. The source market is TPEx OTC listed companies, not TWSE or a whole
  Taiwan equity-market total. Both official datasets, their endpoints, the
  government open-data license and the industry-code reference are linked in
  the export. The code-table reference is not a license for a separate quote feed.
- `participant_total` overlaps the three components for the same company and
  metric. The existing adapter computes total buy/sell from the three participant
  values, while total net is source-reported. `value_origin` distinguishes
  `adapter_sum_of_participants` from `source_reported`; the projection never
  recalculates them. Foreign excludes foreign dealers, who are included in dealer.
  The UI does not call these share totals amounts or label calculated buys/sells
  as officially reported totals.
- A missing company flow produces twelve null metric rows with
  `state: source_record_missing`, distinct from a reported zero. `native_locator`
  points to the actual `rows[i].flow` null. `expected_metric_locator` is the schema
  path for that participant/metric; for missing flow it does not claim that a
  nested field exists. Every reported metric's native locator resolves exactly
  to the value in the native snapshot. Identity locators resolve to source codes.
- The native snapshot is parsed through the existing strict schema, including
  each company, participant collection and buy/sell/net object. Unknown fields
  are rejected rather than exported. This is a validated snapshot copy, not raw
  upstream JSON or a raw hash. Report and classification dates, null publication
  time, acquisition start and fetch time are preserved without substitutions.
- A maximum of 120 rows is previewed, explicitly labeled against the full count.
  The local JSON file contains all validated rows, up to 3,000 companies × 12
  metrics = 36,000 rows, plus the native snapshot. A Blob URL avoids embedding a
  very large data URI. File preparation is local; the link is not offered until
  that exact report is ready. Old URLs are revoked on replacement, withdrawal
  and unmount, and pending preparation is canceled. Downloaded copies cannot be
  recalled. JSON generation still scales with the complete source snapshot.

### A-share industry and constituent evidence

- The current complete provider scope, not only the searched or direction-filtered
  rows, is projected below the existing A-share heatmap. Only `f62` is normalized:
  native CNY, provider-estimated large/extra-large order net buying or selling.
  No calculation re-derives it or labels it whole-market/new-money capital flow.
- Industry identity is `Eastmoney.industry_board`; constituent identity is
  `Eastmoney.security_code`, with no guessed exchange MIC. The source `fs`, scope
  kind, and classification level remain exact. The UI currently requests level 1
  and selected board constituents; the source validator also recognizes distinct
  level 2 and level 3 rank scopes without treating them as equivalent.
- Industry membership exclusivity remains `not_established`. There is no total,
  inferred parent-child amount, taxonomy crosswalk, or addition across industry
  levels, boards and their stocks, different scopes, acquisition windows or sources.
- Native `f62` missing tokens (`null`, `-`, `--`, empty string) stay unchanged at
  their native locator. Their normalized value is null with `source_missing_marker`,
  distinct from a reported zero and from MOF fields absent from the retained schema.
- The native copy explicitly retains `f12`, `f14` and the model's twelve known
  numeric fields. The UI row schema permits unknown provider properties; those
  properties are omitted from export, with this omission declared in
  `native_retention`. Top-level schema fields are still validated strictly.
  This is a validated field copy, not the raw upstream response or a content hash.
- Other numeric fields stay only in the native copy. Known `field_units` remain
  unchanged: `f2` is industry index points or constituent CNY, `f3` is percent,
  and `f62` is CNY. The envelope unit applies to normalized f62 rows, not to every
  retained native field. No units are invented for the remaining unnormalized fields.
- Observation-period start/end, source observation time and trade date stay null.
  Acquisition-start is null when not retained; fetch/completion time does not
  replace it. The market calendar timezone is metadata, not an observation clock.
  The filename includes the source scope and explicitly labeled acquisition time.
- Source metadata links the existing public methodology reference. License URL
  and raw hash remain null; this feature asserts no redistribution permission.

## Privacy, access and lifecycle

The feature executes inside the existing source pages and receives only their
authenticated API results. MOF/TPEx/CVM use their existing `visibleSnapshot` /
`visibleSummary` result; A-share uses the separate export selector described below.
It never calls a new
endpoint, retries a provider, reads a database, fetches `/snapshot` for export,
creates credentials or uploads/shares any data. No new public API is introduced.
The projection parses the source schema. MOF/TPEx and A-share top-level unknown
fields are rejected; TPEx share and CVM nested unknown fields are also rejected. A-share
unknown row properties are omitted via the allowlist.

Permission denial, invalid payload and provider denial remove the preview and
download. MOF/TPEx expiry follows the matrix visibility policy; A-share expiry
withdraws the export independently and does not change the retained heatmap.
Retained temporary-
failure data keeps its original clocks and exports `presentation.stale: true`.
A-share export additionally verifies the requested scope during render, so the
previous industry cannot leak into a new scope before its load effect runs. Only
ready/stale, non-stopped evidence can export. Its dedicated local lifecycle
reuses `SNAPSHOT_MAX_AGE_MS` (24 hours), measured from the earlier of retained
collection-start and fetch time, and rejects future acquisition times. This is
acquisition retention, not a validated market freshness or trading-date policy.
Expiry is enforced by a timer, focus/pageshow/visibility resampling and a final
click-time check; none triggers another request or changes the client's existing
retained heatmap behavior. A 304 does not extend the original expiry.

TPEx shares keep the existing inclusive 24-hour fetched-cache and 14-day report
age bounds, including the report's Asia/Taipei day boundary. The existing page
timer/visibility handling withdraws both the matrix and its export. A final
download click rechecks that same `visibleSnapshot` policy and the existing
permission-stop flag, preventing an expired download when a suspended tab has
not delivered its timer yet. No global lifecycle, gate, API or polling changes
are introduced. A temporary network failure retains only eligible evidence,
marks the export stale and does not renew its original clocks.

CVM retains its inclusive seven-day fetched-cache and 180-day report-age limits,
including the existing UTC report-age calculation and future-fetch rejection.
The page's existing hidden-tab clock withdraws both matrix and export. A final
download click resamples that same selector and withdraws expired evidence even
if a suspended tab has not delivered the timer. No changes to the shared request
hook, polling, source gates, API, parser, authentication or storage are made.
Permission/source denial, invalid data and unavailable snapshots remove the
preview and revoke the Blob. Temporary failure retains eligible evidence with
its original clocks/hashes and stale flag. The existing CVM hook treats a 304
as a redirect/permission stop; this feature does not change that policy.

Downloading saves a JSON file locally on the user's click (a Blob URL for TPEx
shares and CVM, existing data URLs for the earlier sources); previously saved files
cannot be revoked automatically. No observations enter source control.

## Limits

This release covers the two monetary reports, A-share current-scope f62 and TPEx
company institutional shares and CVM disclosed monthly fund-equity transactions,
not other A-share normalized metrics, CVM daily fund subscriptions/redemptions,
all historical snapshots, global identity reconciliation,
or a common server database. Country/industry links do not imply compatible
numeric measurements. The projection is a current evidence export, not a claim
that every source has been normalized or a new live feed exists.

## Verification

`tests/organized-report.test.tsx` checks all native paths against source fields,
negative and zero values, missing fields, official rounding, separate units,
source-schema rejection, actual downloadable JSON and no additional acquisition.
It exercises both page lifecycles for denial, permission loss, invalid replies,
expiry and temporary failure. All fixtures use synthetic observations.

`tests/organized-ashare-projection.test.ts` verifies native locators, exact missing
tokens and zeros, scope namespaces, null source dates, native-field allowlisting,
known quote units, validation and retention boundaries.
`tests/organized-ashare-lifecycle.test.tsx` verifies the real download, no extra
fetches, timer and suspended-tab expiry, late click rejection, first-render scope
changes, permission/source denial, invalid responses, temporary failure and 304
retention, snapshot replacement, cleanup and workspace integration.

`tests/organized-tpex-projection.test.ts` verifies all participant/metric locators,
company and dated industry identities, absent records versus zero, total
provenance and overlap, source/coverage metadata, strict nested validation,
maximum source size and unchanged inclusive visibility bounds.
`tests/organized-tpex-lifecycle.test.tsx` checks integration below the heatmap,
filter-independent complete Blob exports, bounded preview, stable URLs across
ordinary rerenders, replacement/withdrawal/unmount revocation, canceled
preparation, honest preparation failure, denial/invalid/unavailable states,
hidden-tab expiry, both late-click age bounds and retained-failure clocks.

`tests/organized-cvm-projection.test.ts` checks all native/identity/count locators,
integer cents and metadata-only scale, negative/zero/null values, original
adapter sums versus differences, non-point-in-time classification, observation
month, archive provenance, count overlap, strict nested privacy validation,
maximum 9,000-row export and unchanged inclusive age limits.
`tests/organized-cvm-lifecycle.test.tsx` checks below-heatmap integration, complete
filter-independent Blob export, bounded preview, stable ordinary rerenders,
replacement/withdrawal/unmount revocation, canceled and failed preparation,
permission/source denial, invalid/private-extra replies, unavailable/future
snapshots, hidden-tab expiry, both late-click age bounds and retained-failure
clocks. Existing MOF, TPEx and A-share regression tests remain applicable.
