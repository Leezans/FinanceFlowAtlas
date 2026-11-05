# A-share session and snapshot time

The private `/ashare` page presents three independent facts:

1. The **scheduled regular auction session**, calculated using the device clock
   in Asia/Shanghai (UTC+8), the published exchange hours and the verified 2026
   SSE holiday calendar. This is not an exchange-status feed. Temporary closures,
   individual stock suspensions and after-hours trading are not covered.
2. The **source observation time, trading date and delay**, which the current
   Eastmoney contract does not supply. They remain unknown. Neither today's date,
   the most recent scheduled trading day nor successful collection can fill them.
3. The **complete acquisition timestamp** (`fetched_at`) and cache age. A fetch
   less than 60 seconds old is only a recent acquisition, never a claim of live
   observations. Source refresh failure, a server stale flag and a displayed
   acquisition older than the application's 60-second check interval are separate
   states. A device clock before the acquisition makes age unknown, not zero.

## Calendar provenance and boundaries

- [Official SSE 2026 holiday notice, published 2025-12-22](https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml)
- [Official SSE auction schedule](https://english.sse.com.cn/start/trading/schedule/)
- [2026 trading rules, effective 2026-07-06, sections 2.4.1–2.4.2](https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml)

The English schedule page's holiday list is outdated; only its session hours are
used. Holiday closures are inclusive date ranges from the Chinese 2026 notice.
All weekends remain closed, including government make-up working weekends. The
calendar has explicit coverage of 2026 only; outside this year the app reports
unknown and does not invent a next-open countdown. Session intervals are
start-inclusive and end-exclusive, including the opening-auction gap, lunch and
closing auction. This is regular A-share auction timing, not all market activity.

The display clock updates every 15 seconds and upon focus or return to a visible
tab. It does not start an additional network request or change source gates,
collection pacing, cache permissions, schema fields, or source timestamps. SSR
starts with an unknown clock to avoid a guessed session or hydration mismatch.

## Verification

Synthetic unit tests cover each session boundary, every closure date, make-up
weekends, UTC/Shanghai rollover, calendar coverage, missing/future clocks, stale
and error precedence, and the 60-second cache boundary. Component tests cover
background-tab return, cache aging without requests, replacement snapshots,
unavailable/cleared source state, SSR and timer cleanup. These are application
semantics tests; they do not establish current production source availability.
