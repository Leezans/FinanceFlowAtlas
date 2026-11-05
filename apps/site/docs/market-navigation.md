# Market navigation and country selection

The shared layout links all implemented independent market pages. The homepage
opens the A-share industry matrix and retains the U.S. TIC disclosure at
`/#tic-view`. The homepage navigation link is labeled “首页 / A 股”, not TIC.
Ordinary anchors do not prefetch other sources.

`/markets` now selects each country's own market evidence. `?country=CHN`,
`?country=TWN`, and `?country=BRA` open their independent sources. Other known
country codes display an empty local industry-money-flow matrix, not their U.S.
TIC counterpart activity. The map and country selector share URL state and
Back/Forward behavior. No initial default-country source is mounted before the
URL has been read.

The 249-country geography is an index, not an observation count. Three local
source entries do not imply three currently working feeds. Actual observations,
frequency, units and denial/failure states are shown by the selected source.
TIC loads only inside the explicit `#us-tic-supplement` disclosure. It remains
monthly U.S.-issuer cross-border activity and is never counted as local-market
coverage for every foreign residence.

Source-specific workspaces are reused. Only the selected market is mounted;
changing country removes its prior panel and cancels its browser request.
Taiwan money and company share-count panels are independent, and Brazil remains
explicitly monthly. No money is manufactured for unsupported industry drilldown.

Tests cover exact routes, no source fetch from static navigation, country URL
selection, map synchronization, Back/Forward, source unmounting, missing
countries and TIC opt-in. Existing page-level tests cover individual sources.
Release QA exercised the actual components with synthetic responses at desktop
and 390px widths: country/search/map/history, empty unsupported markets, optional
TIC, participant selection and status variants passed with no horizontal overflow.
No external provider calls were made by this fixture. This does not establish
live source availability or physical mobile-device behavior.

See [country-owned evidence contract](global-own-market.md).
