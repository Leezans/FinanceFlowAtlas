# Evidence relationships and discovery

The shared hosted-app registry is `apps/site/lib/catalog/sources.ts`. It connects
existing heatmaps without combining their observations. Asset navigation and
homepage entry URLs consume this registry; source pages show their hierarchy,
metric, native units, frequency and provider. Country workspaces retain their
existing primary heatmaps and expose other evidence for that country underneath.
No extra directory replaces the primary visualization.

## Relationship rules

- Global → asset class → explicit geographic role / venue → source-supported
  industry, product or instrument breakdown. If a source lacks industries or
  individual instruments, the hierarchy stops. There is no fabricated allocation.
- Geography has a role: issuer market (TIC, MOF), local market (TPEx), investment
  destination (ASEAN), or reporting venue (CFTC). A TIC investor residence is not
  evidence for that country's own equity market. Crypto and FX are not assigned
  countries from exchange addresses or currencies.
- Country and asset links mean related evidence, not additivity. Taiwan connects
  TPEx shares, TPEx institutional TWD, TAIFEX futures notional and TAIFEX option
  premiums. None is a monetary child of another. CFTC contract counts cannot be
  added across contract units or presented as cash flow.
- Eastmoney, TPEx, CVM and ASEAN retain separate industry taxonomies. CVM's
  classification is not a historical point-in-time classification. No taxonomy
  crosswalk or investment-flow reconciliation is asserted.
- Static metadata records the observation frequency, not a fresh observation
  date. Actual period, source-as-of, retrieval time, stale/denied/missing state
  and provenance remain owned by each validated source snapshot and its matrix.
  Registry presence never grants acquisition permission or proves availability.
- No new provider requests, endpoints, jobs, credentials or database changes.
  Links are ordinary anchors; discovery does not prefetch gated source pages.

## Current boundary and next step

This is a discovery/relationship layer, not a universal financial fact table.
The existing source-specific models still validate units, exact timestamps,
classification, denominators and missing values independently. Offline CVM
fund-share and SSE margin parsers are not advertised as live hosted feeds.
The remaining deeper work is explicit instrument identity mappings and licensed
industry crosswalks with evidence and effective dates, not label matching or
summing whatever happens to use the same currency.

## Verification

`tests/evidence-catalog.test.tsx` checks route existence, identity uniqueness,
country roles, exact route selection, unit/metric boundaries, changing-country
links and no discovery fetches. Existing navigation and country matrix tests
continue to protect primary heatmaps and unavailable-country states.

Known discovery limits: multi-country ASEAN and World Bank entries are accessible
by asset but not yet linked to every country selection. Country relationships
do not assert complete coverage. Query-backed MOF/TPEx/TIC context listens to
country selection, hash changes and Back/Forward; TIC is selected only when its
explicit US supplement anchor is selected, not merely from a USA country selection.
