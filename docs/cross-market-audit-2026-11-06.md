# Cross-market amount and direction audit

## Scope and result

Reviewed the source code for the hosted application at public main
`c7437e6da6bdaebe9a1ed8b9c6ca963d48523844`, source tree
`541cecdb5b9222e341b7c40286a3fb37d4dc54fe`, on 2026-11-06.
This is a code and synthetic-regression audit, not a live source-availability
check or a claim of complete market coverage.

No reproducible high-impact amount, direction or country-substitution error was
found in the reviewed hosted paths. The concrete defect was obsolete architecture
guidance: it described `/markets` as TIC-first, TIC as equal-area, A-share as a
separate treemap, legacy weights as geometry, and A-share/Kraken as metadata-only
storage. Those statements contradicted the current implementation. This change
corrects documentation only. It adds no source, runtime feature, test fixture,
schema, migration, data permission or deployment.

## Verified contracts

Paths below are relative to `apps/site`.

| Evidence | Amount geometry and unit | Color and scope | Implementation evidence |
| --- | --- | --- | --- |
| China A-share | Absolute provider `f62`, in CNY; zero/missing have no area | Signed `f62`, not `f3` price change; scope maximum stays fixed through filtering; provider order classification, not newly created market money | `components/ashare/matrix.ts`, `EvidenceHeatmap.tsx`, `model.ts` |
| U.S. own market | No connected own-market flow source, so no amount blocks | No inferred U.S. domestic flow | `components/markets/CountryWorkspace.tsx`, `model.ts` |
| Global country entry | Selects one country's independent workspace; no cross-currency/period total | China default; unconnected countries remain empty; Japan explicitly keeps its nonresident sample scope | `components/markets/Markets.tsx`, `CountryWorkspace.tsx` |
| U.S. TIC supplement | Country amounts are already USD, displayed in USD millions; absolute country net amounts determine area; published total is excluded from country rectangles | Sign means foreign-resident purchases/sales of U.S.-issued equity, not the residence country's own market; fixed full-period scale | `lib/tic/model.ts`, `matrix.ts`, `components/atlas/TicMatrix.tsx` |
| Taiwan TPEx amounts | Same-day participant TWD net amounts; total row excluded from area | Institutional participant net purchases/sales, not all Taiwan markets or global capital flow | `lib/national/tpex-summary.ts`, `tpex-summary-view.ts` |
| Taiwan industry/company detail | No monetary area because observations are shares | Net shares divided by buy + sell shares; fixed ±100%; no share-price multiplication | `components/tpex/matrix.ts`, `TpexInstitutional.tsx` |
| Japan MOF | Source 100 million JPY multiplied by 100,000,000 for monetary area; total excluded | Official signed nonresident acquisition/disposition net; Japanese issuer securities, not U.S.-based or whole-economy flow | `lib/japan/view.ts`, `components/markets/JapanMoney.tsx` |
| Brazil CVM | BRL cents divided by 100; industry area sums absolute security net amounts without cancellation | Industry number and color retain signed net; color is net / (buy + sell); public disclosed fund subset only | `components/cvm/matrix.ts`, `CvmFunds.tsx`, `lib/cvm/model.ts` |
| ASEAN FDI | USD millions multiplied by 1,000,000; one host/year; unspecified Z and overlapping Singapore N excluded from monetary area | Signed annual inward FDI, with Philippine equity-only exception; not equity-market trading flow | `components/asean/matrix.ts`, `FdiHeatmap.tsx` |
| World Bank/WFE equity context | Same indicator/year in current USD; other years remain missing; country detail does not combine capitalization and traded value | Nonnegative size palette, not gain/loss or inflow; aggregates such as WLD do not become country rows | `lib/equity/adapter.ts`, `matrix.ts`, `components/equity/EquityMatrix.tsx` |
| Cboe, ECB and Kraken quotes | No monetary area from security prices, exchange rates, base-coin volumes or trade counts | Cboe/ECB neutral; Kraken price-to-24h-VWAP deviation explicitly not daily return or flow | `lib/cboe/matrix.ts`, `components/forex/matrix.ts`, `venue-matrix.ts`, `components/crypto/matrix.ts` |
| Kraken executed-trade sample | Absolute USD buy-marked minus sell-marked notional over one declared interval; capped responses have no amount | Signed notional imbalance ratio; preserves subprecision sign; venue sample, not market-wide capital inflow | `components/crypto/trade-matrix.ts`, `KrakenTradeMatrix.tsx` |
| CFTC futures | No amount area from contract counts | Net position / open interest, fixed ±100%; positioning is not money flow | `components/futures/matrix.ts`, `FuturesPositioning.tsx` |
| Polymarket | Probability and unit-unverified volume have no monetary area; independent verified USDC open interest has amount area | Sequential magnitude, not directional flow; gross open interest is a stock, not net inflow | `components/polymarket/matrix.ts`, `Polymarket.tsx`, `OpenInterest.tsx` |

`lib/matrix/layout.ts` admits monetary geometry only for matching declared
currency/comparison keys with unique group/item identities. It uses absolute
amounts, normalizes by the maximum to avoid overflowing the sum, and introduces
no minimum weight or signed cancellation. `lib/matrix/model.ts` separates signed,
neutral and sequential colors. Palette changes do not change signs or values.

## Regression evidence

- Focused existing suites: 26 files, 196 tests passed. Coverage included amount
  ratios, group conservation, incompatible-unit rejection, zero/missing states,
  A-share direction and filtering, TIC units and fixed scales, annual equity
  years, country switching, U.S. empty-state protection, and zoom interactions.
- Complete hosted suite: `npm test`, 121 files / 1,936 tests passed. This also
  covered CFTC, TPEx monetary summaries and Polymarket open-interest contracts.
- `npx tsc --noEmit` and `npm run lint -- --max-warnings 0` passed.
- `npm run build` passed, including the postbuild verification of 61 client
  assets across both RSC manifests, 50 Vite entries and the client bootstrap.
  This is a local build check, not a production deployment or browser screenshot.

Existing reproducible test entrypoints include `tests/global-matrix.test.tsx`,
`tests/matrix-amount-layout.test.ts`, `tests/ashare-visual.test.tsx`,
`tests/tic-matrix.test.ts`, `tests/equity-matrix.test.ts`,
`tests/national-tpex-summary.test.ts`, `tests/japan-mof-view.test.ts`,
`tests/asean-monetary-matrix.test.ts`, `tests/cvm-ui.test.tsx`,
`tests/cftc-matrix.test.ts`, `tests/kraken-trade-matrix.test.tsx` and
`tests/polymarket-interest.test.ts`.

## Limits and publication

No live provider endpoint, authenticated production page, source-gate mutation,
cache reset, database migration or new login was used. Tests use synthetic data;
passing tests do not prove currently available quotes, an active collector, source
redistribution rights or complete domestic net-flow coverage. U.S. own-market
coverage remains absent; A-share remains a provider order-classification proxy.

Both changed files are public repository documentation outside `apps/site`.
Publishing them does not change or redeploy the private application. A later
runtime release must still verify its own integrated commit and permitted source
access; this audit does not authorize bypassing a prior denial.
