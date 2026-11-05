# Market navigation and landing

The shared root layout exposes the independent `/ashare`, `/markets`, `/crypto`
and `/` pages. A-share is the first navigation destination. The homepage keeps
the existing TIC layer on `/`, now also addressable through `/#tic-view`, and
adds an A-share-first visual entry section above it.

Navigation and entry cards use ordinary same-origin anchors. They do not fetch,
prefetch, combine, or preview source observations. Route availability is not a
claim of live source availability. No authentication, source gate, cache, adapter,
database, or sharing behavior changes.

The A-share card describes industry-to-constituent drilldown and the provider's
order-classified main-net estimate. The global map card distinguishes geographic
navigation from observation coverage. Kraken remains selected BTC/USD and ETH/USD
spot pairs at one venue, and volume is not called capital inflow. FX is visibly
upcoming and noninteractive until its route is integrated. No fabricated preview
values or heatmap observations are added.

## Verification

- Unit coverage checks implemented destinations, exact active-route state,
  unknown routes, layout integration, no source fetching by the landing, source
  semantics, preservation of TIC, and the direct TIC anchor.
- Browser QA exercised homepage to A-share, global, crypto, Back, repeated return
  to homepage, and the TIC anchor. Desktop layout had no horizontal overflow.
- A temporary, untracked iframe harness exercised the real pages at 390 CSS
  pixels (375 usable pixels with its scrollbar). Homepage and A-share had no
  horizontal overflow, all four navigation links were visible with 44px touch
  height, and the A-share card opened its page. This is narrow browser viewport
  QA, not a physical mobile-device test. The harness was removed before commit.
- Preview source requests reported unavailable/uninitialized-storage states.
  These checks do not verify authenticated production source availability.
