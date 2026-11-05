# Polymarket keyset contract evidence

Checked official documentation on 2026-11-05. No provider-data requests were used for this research.

Source: https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination

Relevant contract excerpts:
- “Maximum number of results to return (max 100)”
- “Opaque cursor token from a previous response's next_cursor”
- Offset: “Not allowed. Returns 422 if provided.”
- Response: “markets” is an array; “next_cursor” is a string.
- “Opaque cursor token for fetching the next page. Present only when the number of returned markets equals the effective limit. Omitted on the last page.”
- “keyset pagination is not configured” is the documented service-unavailable response.
- “When true, includes Tags relation on each market” describes include_tag.

The contract does not provide a total count or snapshot-isolation guarantee. The documented order parameter accepts JSON field names; ID ordering still requires verification through the normal gated production acquisition. closed=false is documented; active is not a documented keyset filter, so eligibility remains locally verified.

Source: https://docs.polymarket.com/api-reference/rate-limits

Gamma lists /markets at 300 requests per 10 seconds, general 4,000 per 10 seconds, and market/event listings combined at 900 per 10 seconds. Limits are IP-based, use sliding windows, and may delay/queue requests rather than immediately reject them. No separate keyset rate is specified. The app uses at most five requests per collection, with shared cooldown at least 30 seconds after release.

The eight-second page-start budget is inside the unchanged twelve-second acquisition deadline. Preflight inspection and exact-owner cleanup have their own bounded waits; this is not a twelve-second total HTTP response latency guarantee.

## Separate hot window (2026-11-05)

Official list contract: https://docs.polymarket.com/api-reference/markets/list-markets

The list API documents limit/offset, order/ascending, and nullable `volume24hr`.
The previous normal hosted acquisition demonstrated that a volume-ranked request
can return only 100 rows despite a requested limit of 200; the hot mode therefore
requests at most 100 and reports the actual count. It does not expand mutable
volume ranking through offsets or keyset cursors. Returned known volume values
are checked for descending order. Nullable `volume24hr` is not cumulative volume,
not event volume, not automatically `volume24hrClob`, and is not capital flow.
The retrieved field reference does not establish a unit or a price-observation
time, so those remain explicitly unverified rather than labeled USD or real-time.

The saved normal v35 hosted response contained 500 distinct newest-ID markets,
499 missing 24-hour volumes, one source-reported zero, and 241 markets assigned
to the source-derived Games display group. This proves newest-ID coverage is
not a substitute for useful volume-ranked discovery. These are observed sample
properties, not current whole-market counts, and are not bundled as app data.

Hot and newest are explicit independent request modes. Both retain the same
permission gate, timing bound, byte limits, source-denial behavior and cache age.
The UI defaults to the hot source window, not to relabeling newer-ID markets.
No additional provider requests were made during this implementation/research.
