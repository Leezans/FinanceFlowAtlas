# FinanceFlowAtlas hosted application

This optional Sites/Vinext application lives alongside the Python API and Vite web app. It does not replace either. It renders the reviewed country treemap with a geographic-map alternative and a read-through Treasury TIC adapter backed by D1.

## Local setup and checks

Use Node.js 22.13 or newer. From `apps/site`:

```sh
npm run install:ci
npm test
npx tsc --noEmit
npm run build
npm run dev
```

`npm run lint` runs the starter and application ESLint rules. The build generates local worker configuration under `dist/server`; generated builds and runtime state are not source files. For a local database, apply `drizzle/0000_silly_ogun.sql` to the D1 binding `DB` using the local worker configuration before exercising cache-backed routes. Do not apply migrations to production as part of a local test.

## Deployment configuration

`.openai/hosting.json` declares `DB` and no R2 bucket. Project identifiers, credentials and provider runtime state are deliberately omitted. Configure a new deployment through supported Sites tooling, retaining the authentication boundary in `worker/index.ts` and `app/chatgpt-auth.ts`. Do not commit generated deployment identifiers or authentication tokens. Public source publication does not make an existing deployment public.

## Data semantics

The hosted adapter targets the fixed, previously verified **2026-08** TIC month. It does not infer the latest month or provide real-time prices. Foreign country means reported residence; the security issuer economy remains the United States. Signed monthly net transactions are distinct from holdings and from gross purchases or sales.

Treemap area is the absolute net amount divided by the sum of absolute net amounts of included reported countries, not market capitalization or the Treasury Grand Total. Zero rows are separate; missing rows have no area. No industry or individual-stock hierarchy is implied.

The IMF layer is explicitly unavailable in this hosted application. FX, futures and crypto are unconnected. A source failure preserves a last-good cached snapshot with stale status; no initial snapshot returns 503, never substitute data. Tests use synthetic fixtures only. No captured financial snapshots or private user data are bundled.

See [HOSTED_PROOF.md](HOSTED_PROOF.md) for cache validation and endpoint details, and [ATTRIBUTION.md](ATTRIBUTION.md) for separate geography and dependency licensing.

## Optional private A-share page

The separate `/ashare` page provides industry/stock provider evidence using bounded access to public Eastmoney endpoints. It does not replace TIC or assert general market-data redistribution rights. Source observation time, trading date and latency remain unknown; acquisition time is labeled separately. Provider order-classified main-net figures are estimates, not actual market-wide net money creation.

A-share payloads remain ephemeral in process memory. D1 stores only shared acquisition coordination and permanent denial metadata in `ashare_source_gate`; it never stores A-share market observations. Apply the additional `0001_wild_jigsaw.sql` migration through the deployment's supported migration workflow. Authentication remains owner-only. Denials/challenges stop acquisition persistently rather than triggering alternate-route retries. See HOSTED_PROOF.md for limitations; actual authenticated production source access is not claimed to have been verified.

### A-share exploration

The time panel separates the scheduled ordinary auction session (published 2026
exchange calendar, device clock in UTC+8), unknown source trading date/observation
time, and the timestamp/age of the most recent complete acquisition. It warns when
the displayed cache exceeds the 60-second check interval even while a background
tab is stale; a recent fetch never becomes a claim of real-time data. Calendar
coverage outside 2026 is explicitly unknown. See
[time semantics and calendar sources](../../docs/ashare-market-timing.md).

The treemap remains the primary view. Search and provider-net-direction filters apply to both the chart and its collapsed **数值明细** panel. The optional panel shows unscaled CNY amounts, deterministic magnitude/buy/sell/name sorting, and drilldown for zero/missing rows that have no treemap area. Missing amounts never become zero; area shares use only the absolute nonzero amounts in the current filter, not a whole-market denominator.

Same-scope refreshes preserve search, palette, filters, sorting, the expanded panel and selected stock evidence. If a selected stock changes direction, its detail updates even when it no longer matches the filter. Changing scope resets exploration; a denied/error response clears all displayed evidence. Tests use synthetic observations only. This UI increment neither changes acquisition permissions nor verifies live source access, and a repository commit does not deploy it.

### A-share heatmap readability

The A-share heatmap uses three equal-width positive and negative color bands anchored to the largest absolute reported `f62` value in the complete current scope. Search and direction filters change area shares but do not change this color scale; a new source snapshot can update it. The legend labels the signed range in CNY. No price-return or industry-aggregation estimate is used to produce a color.

Compact tiles retain signed amounts where they fit, and hover or keyboard focus shows unscaled net amounts, source-reported price change and the current area share. The chart lays out in measured CSS pixels, including on narrow screens, rather than shrinking a fixed 1000px canvas. Zero and missing values remain in the details panel without invented area. The view is still industry-to-constituent drilldown, not a whole-market nested hierarchy: verified, mutually exclusive constituent membership is not available in the current source contract. Tests and local visual fixtures use synthetic rows only; no test fixture is bundled in a production route.
