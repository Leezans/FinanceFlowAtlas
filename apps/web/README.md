# Global equity atlas frontend

React + TypeScript + Vite with 177 bundled Natural Earth geometries and a 249-entry ISO geographic index. `npm ci`, `npm run dev` (loopback port 5173), `npm run build`, `npm test`. The development proxy expects the Python API at 127.0.0.1:8000. Production must serve `/api` on the same origin.

Polls snapshot/status endpoints every 60 seconds; this does not change the release frequency of source statistics. Displays verified positions only, never synthetic live flows. API failure clears displayed values and arcs. Source units must be verified. Region/country/direction/period filters preserve zero versus missing. Only the 150 largest drawable positive relationships render as static arcs; the evidence table shows the largest 100 matching positions. Global sums are sums of filtered reported positions, not a complete global market size.

The stock module supports country evidence. FX, futures, crypto, industry and individual-stock feeds explicitly remain unconnected. No paid service or key is required. Browser network use is limited to the same-origin API; map assets are bundled.

`tests/browser_smoke.py` is an optional Playwright smoke test against a running dev server. Its test fixture is not bundled. Browser launch was blocked by this execution environment's socket policy, so visual/browser QA is **not verified**. Unit and DOM-only tests are separate from visual QA.

See ATTRIBUTION.md for geography/data licenses. The enriched geography index is available under ODbL; financial observations remain subject to their upstream source terms.

Optional `VITE_API_BASE` overrides the same-origin API base at build time. The client sends `If-None-Match` after receiving an ETag and reuses 304 responses only while source status is ready/refreshing/stale; stale snapshots display an explicit overdue-source warning. New requests abort older ones and sequence IDs prevent stale responses from overwriting newer state. Requests time out after 20 seconds. The connected series is IMF F51 **equity**, not F5 equity and investment-fund shares. Excluded records are explicitly reported when present in metadata.
