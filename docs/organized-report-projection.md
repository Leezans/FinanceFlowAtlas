# Organized current-report evidence (first data slice)

`apps/site/lib/evidence/report-projection.ts` projects the actual retained Japan
MOF and TPEx institutional monetary snapshot fields into one read-only envelope.
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
  value and actual native field path. The complete validated native snapshot
  is included alongside the organized rows for self-contained traceability. Zero is `reported`, never missing.
- The reported totals overlap components. Rows are tagged `reported_total` versus
  `component`; there is no aggregator or cross-source comparable total. MOF
  rounding differences are retained, not repaired by summing rounded components.
- Envelope preserves source schema, URLs, license and attribution, reporting
  period and calendar zone, country with role, acquisition/fetch clocks, source
  update date when retained, unknown publication time and absent raw hash as null.
  It contains no industry/instrument classification where the source has none.

## Privacy, access and lifecycle

The feature executes inside the existing source pages and receives only their
authenticated API results. It uses exactly their `visibleSnapshot` / `visibleSummary` result. It never calls a new
endpoint, retries a provider, reads a database, fetches `/snapshot` for export,
creates credentials or uploads/shares any data. No new public API is introduced.
The projection parses the exact source schema and rejects unknown extra fields.

Permission denial, invalid payload, provider denial and expiry remove the preview
and download together with the underlying matrix evidence. Retained temporary-
failure data keeps its original clocks and exports `presentation.stale: true`.
Downloading saves a data URL JSON file locally on the user's click; previously
saved files cannot be revoked automatically. No observations enter source control.

## Limits

This release covers only these two monetary reports, not TPEx security shares,
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
