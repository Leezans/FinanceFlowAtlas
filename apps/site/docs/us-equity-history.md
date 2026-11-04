# US equity foreign-resident net transactions: bounded history

The hosted app adds an independent 12-month overview of the Treasury TIC SLT
Table 1 `for_lt_eqty_net` **published Grand Total**. It describes foreign residents'
net transactions in US equity, including fund shares. It is not overall US-market
inflows, individual-stock flows, gross trading volume, price movement, or a
change in holdings. No country-row sum replaces Grand Total.

## Scope

- Fixed calendar window: September 2025 through August 2026. This is not an
  automatic latest-period selection. The supported history is deliberately
  independent of the single-month view's selected or verified month.
- One source retrieval vintage covers every displayed month. Historical values
  can be revised. First-publication dates for individual months are not inferred.
- Source: https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt
- Field: `for_lt_eqty_net`; total code: `99996`; source units: USD millions;
  internal/API units: integer USD; display units: USD millions.
- Positive means net purchases; negative means net sales. Missing/blank/`n.a.`
  months stay null and leave chart gaps. Reported zero has a separate marker.
- A missing endpoint-month row, duplicate total, changed total code/name,
  malformed number, unsafe precision, unknown units, HTML or truncated response
  cannot replace the last validated snapshot. A source-declared missing endpoint
  value remains null. An all-missing window is unavailable.
- No cumulative total, extrapolation, interpolation, currency conversion, or
  pre-February-2023 series splice is performed. Treasury describes a transactions
  reporting break in February 2023 in its FAQ:
  https://home.treasury.gov/data/treasury-international-capital-tic-system-home-page/frequently-asked-questions-regarding/ticfaq2

## Endpoint and caching

`GET /api/v1/flows/tic/history` serves the separately validated history. The
existing D1 cache table uses a distinct fixed history key, without a migration.
It reuses the existing bounded source-request policy (10 MB, 12-second timeout,
no redirects, success cache 24 hours, failure backoff five minutes). Fetching
history can add one separate source check per cache interval; it is not combined
atomically with the country snapshot, and their retrieval vintages may differ.
The UI discloses this and never subtracts or joins their values.

No API key, user information, SEC contact identity, paid service, or account is
required. Only the existing fixed Treasury public URL is requested. No background
schedule is installed. A failed refresh preserves last-good server history with
a stale header and visible warning. Conditional ETags include stale state.
Without validated data the API returns 503; client schema/network errors clear
chart values rather than displaying unlabelled cached data or synthetic values.

## Verification

From `apps/site`:

```sh
npx tsc --noEmit --incremental false
npm test
npm run build
```

Tests are synthetic. They cover signs, unit conversion, zero versus missing,
contiguous calendar slots, total/country independence, revisions, parser
rejection, cache regression/recovery, 503 and stale ETags, accessible tables,
repeated refresh, aborts and unmount cleanup. No provider observations, raw
source files, databases or credentials are committed. This repository increment
alone does not deploy the hosted app.
