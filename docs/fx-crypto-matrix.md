# FX and crypto matrix presentation

The `/forex` and `/crypto` data views use the same shared `MatrixHeatmap` as other
instrument/category pages. Source handling, source gates, cache lifetimes and
access-denial behavior are unchanged. Pure typed presentation adapters live in
`apps/site/components/forex/matrix.ts` and
`apps/site/components/crypto/matrix.ts`; they consume only
validated visible snapshots and never fetch data or infer fund flows. Kraken
browser payload validation is isolated in `apps/site/components/crypto/client.ts`.

ECB reference currency tiles retain source decimal precision, equal area and
neutral color. Different currency denominations cannot be compared as market
size or strength, and this source snapshot has no previous-day observation from
which to calculate returns. Search filters only the observed currencies. The
same-reference-date conversion tool is available in a secondary disclosure.

Kraken retains two selected spot pairs and switches the matrix between last
price, rolling-24h VWAP, native-base volume and trade count. Equal tile area is
not market capitalization. Only the last-price view uses signed color: the
explicitly calculated `(last / rolling-24h VWAP - 1) × 100` deviation, scaled to
the validated snapshot's largest absolute deviation. It is not a 24h return,
net capital flow or a trading signal. Other views use neutral color and retain
native units; base-coin volumes are never combined. Missing, denied and expired
snapshots produce no observation tiles. Tests use synthetic evidence only.
