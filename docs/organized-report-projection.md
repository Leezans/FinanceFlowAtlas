# Organized current-report evidence

`apps/site/lib/evidence/report-projection.ts` projects the actual retained Japan
MOF and TPEx institutional monetary snapshot fields into one read-only envelope.
`apps/site/lib/evidence/ashare-projection.ts` extends that envelope to the current
A-share industry or constituent snapshot, using the same preview and download.
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
  It contains no industry/instrument classification where the source has none.

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
authenticated API results. MOF/TPEx use their existing `visibleSnapshot` /
`visibleSummary` result; A-share uses the separate export selector described below.
It never calls a new
endpoint, retries a provider, reads a database, fetches `/snapshot` for export,
creates credentials or uploads/shares any data. No new public API is introduced.
The projection parses the source schema. MOF/TPEx and A-share top-level unknown
fields are rejected; A-share unknown row properties are omitted via the allowlist.

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

Downloading saves a data URL JSON file locally on the user's click; previously
saved files cannot be revoked automatically. No observations enter source control.

## Limits

This release covers the two monetary reports and A-share current-scope f62, not
other A-share normalized metrics, TPEx security shares,
CVM fund transactions, all historical snapshots, global identity reconciliation,
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
