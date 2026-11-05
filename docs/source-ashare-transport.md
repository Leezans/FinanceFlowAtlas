# A-share source transport

The hosted `/ashare` view retrieves public Eastmoney industry and constituent
order-flow fields through bounded Cloudflare Workers native fetch. It needs no
Tushare account, source login, user identity, or API key. The source fields are
provider order-classified estimates, not market-wide newly created money.

## Native content decoding

Cloudflare's [Fetch documentation](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
describes automatic gzip/Brotli negotiation and decoding when the response body
is read. `Content-Encoding` can remain present on the decoded response. The
adapter therefore accepts an absent/identity, single gzip, or single br coding
and reads the native decoded stream. It does not decode the body a second time.
Unknown or chained encodings remain unsupported.

The four-megabyte acquisition budget counts **decoded** bytes across all pages
and the permitted official redirect, including responses with a smaller encoded
Content-Length. A declared length larger than the remaining budget is also
rejected. The existing request deadline, page/row limits, exact-target redirect
validation, unique IDs, stable totals, complete pagination, strict numeric
validation, and duplicate-key JSON rejection remain in force.

No new source host, proxy, account, retry route, or access method is introduced.
HTTP denials, challenges, and off-policy redirects still stop source acquisition
persistently. No denial gate is cleared by this change. Source payloads remain
ephemeral; the database stores only acquisition metadata.

## Diagnostics and verification

Failed acquisitions emit only an allowlisted `error_code` and scope kind in
production logs. The error API and client use bounded local explanations rather
than exposing provider bodies, exception strings, URLs, or credentials. This
allows a missing migration, busy coordination, unsupported encoding, malformed
source data, timeout, and source denial to be distinguished without loosening
validation or manufacturing a fallback snapshot.

Synthetic tests cover runtime-decoded gzip/br responses, the decoded byte limit
with a small encoded length, unsupported/chained encodings, and raw compressed
bytes that were not decoded by the runtime. These tests establish adapter
behavior, not live availability. A successful real production snapshot and
constituent drilldown must still be observed through the authenticated private
Site before claiming that the production source is working.

## Scope-specific quote units

Eastmoney's [board-index explanation](https://baike.eastmoney.com/item/%E6%9D%BF%E5%9D%97%E6%8C%87%E6%95%B0)
describes an index as a point level rather than a currency amount. `f2` is the
current quote of the requested object: an industry board
index level in an industry-rank response, or a stock price in a constituent
response. It is not a currency amount merely because `f62` in the same row is
CNY. Snapshot metadata now declares `field_units.f2 = index_points` for
`industry_rank`, and `CNY` for `industry_stocks`. `f62` remains CNY and `f3`
remains percent. No value is rescaled, and the monetary treemap still uses only
`f62`.

The visualization validates the combination of scope and quote unit, rejecting
old/mislabeled industry snapshots that claim a CNY index quote, stock snapshots
that claim index points, and unknown quote units. Source details also explain
the two meanings. Synthetic regression tests cover both valid scopes, incorrect
units in both directions, and null/missing quotes. This corrects the contract;
it does not establish the quote's observation time or live source availability.


### Deploying the unit correction

The cached acquisition stores raw rows and scope, not response `field_units`.
The response constructs corrected units each time, and its ETag covers those
units. A conditional request carrying the previous industry-CNY ETag therefore
receives HTTP 200 with corrected metadata and the same cached rows; subsequent
requests with the new ETag receive 304 without reacquiring the source.

Deploy the adapter and frontend validator together. An already-open browser
running the old strict validator does not accept `index_points` and must refresh
the page to load the updated client. Do not make the new validator accept the
incorrect old CNY industry label to hide a mixed-version deployment. Synthetic
regression coverage verifies this cache/ETag transition without live requests.
