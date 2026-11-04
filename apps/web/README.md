# Global equity atlas frontend

React + TypeScript + Vite with 177 bundled Natural Earth geometries and a 249-entry ISO geographic index. `npm ci`, `npm run dev` (loopback port 5173), `npm run build`, `npm test`. The development proxy expects the Python API at 127.0.0.1:8000. Production must serve `/api` on the same origin.

Polls snapshot/status endpoints every 60 seconds; this does not change the release frequency of source statistics. Displays verified positions only, never synthetic live flows. API failure clears displayed values and arcs. Source units must be verified. Region/country/direction/period filters preserve zero versus missing. Only the 150 largest drawable positive relationships render as static arcs; the evidence table shows the largest 100 matching positions. Global sums are sums of filtered reported positions, not a complete global market size.

The stock module supports country evidence. FX, futures, crypto, industry and individual-stock feeds explicitly remain unconnected. No paid service or key is required. Browser network use is limited to the same-origin API; map assets are bundled.

`tests/browser_smoke.py` is an optional Playwright smoke test against a running dev server. Its test fixture is not bundled. Browser launch was blocked by this execution environment's socket policy, so visual/browser QA is **not verified**. Unit and DOM-only tests are separate from visual QA.

See ATTRIBUTION.md for geography/data licenses. The enriched geography index is available under ODbL; financial observations remain subject to their upstream source terms.

Optional `VITE_API_BASE` overrides the same-origin API base at build time. The client sends `If-None-Match` after receiving an ETag and reuses 304 responses only while source status is ready/refreshing/stale; stale snapshots display an explicit overdue-source warning. New requests abort older ones and sequence IDs prevent stale responses from overwriting newer state. Requests time out after 20 seconds. The connected series is IMF F51 **equity**, not F5 equity and investment-fund shares. Excluded records are explicitly reported when present in metadata.

## TIC transaction layer

The stock module now has separate IMF holdings and TIC monthly net-transaction layers. TIC uses only `/api/v1/flows/tic` and `/api/v1/flows/tic/status` from the reviewed TIC backend. This frontend copy does not include or alter that backend; integrate the changed frontend files into the TIC-enabled checkout.

TIC net foreign purchases of U.S. corporate equity (including fund shares) remain signed. Positive means net purchases, negative net sales; the reported foreign-residence identity and fixed U.S. issuer identity never swap. Static green/solid and coral/dashed connections are transaction relationships, not live movement animations. Reported zero has no arc; missing data is not zero.

Source values are USD millions; backend values are USD. Display divides the normalized values by one million exactly once. Official Grand Total is shown independently and is never derived from summing the non-exhaustive country rows. Country detail provides record/source identity and explicitly states that sector, single-security and ultimate-owner drilldowns are unavailable.

The API serves a single active observation month. The month control can inspect another requested month, but explicitly shows unavailable and clears every value/edge for that month; it neither invents historical observations nor changes the backend's active month. Source-check freshness is separate from observation month and release lag. A stale check retains the verified snapshot with a warning; failed/unavailable API requests clear TIC values only. IMF and TIC provenance never share a financial total or chart.

TIC has its own abortable 60-second poll, 20-second timeout, request sequencing, and ETag/304 cache. Switching away unmounts the layer and cancels its requests. No upstream refresh or external mutation is triggered by UI polling.

Verification for this increment: TypeScript and production build passed; 17 unit/DOM tests passed, including all 9 prior IMF tests, signed values, exact unit conversion, missing/zero distinction, month selection, independent layer switching, country details, 304, stale warnings and failure invalidation. No direct Chromium/browser launch was attempted in this increment. Visual review remains separate and must use the supported preview channel.
