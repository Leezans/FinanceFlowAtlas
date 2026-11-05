# Japan MOF weekly nonresident securities transactions

## Meaning and source

The Japanese market entry uses the **Portfolio Investment Liabilities** block
of the Ministry of Finance's [International Transactions in Securities](https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/index.htm).
It reports nonresident acquisitions, dispositions and net transactions in
Japanese-issued securities through designated major reporting institutions.
Positive means net acquisition; negative means net disposition. This is a
Japan-owned issuer-market statistic, not Japanese transactions in US securities.

Three nonoverlapping asset classes are shown: equity and investment-fund shares,
long-term debt, and short-term debt. The reported total is separate and does not
occupy a fourth matrix area. A source subtotal is validated but not repeated in
the display. All figures use the official **100 million JPY** units; matrix
areas convert to JPY explicitly. Rounded official nets/totals are preserved,
not replaced by arithmetic on already rounded acquisitions/dispositions.

The [MOF FAQ](https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/faq_its_english.html)
states that ITS is a major-institution sample rather than the complete
balance-of-payments portfolio-investment universe. Trades use execution dates;
bond dispositions include redemptions recorded on redemption dates. Currency
does not determine issuer residence. The series has no industry, company or
foreign-investor-origin breakdown. It is neither all Japanese domestic
investors nor JPX exchange-trading statistics. No stock-level or industry
allocations are invented.

## Verified acquisition and layout

Checked 2026-11-05 UTC. Two ordinary bounded reads of the fixed
[official historical weekly CSV](https://www.mof.go.jp/policy/international_policy/reference/itn_transactions_in_securities/week.csv)
succeeded; the second persisted bytes for offline parser verification after
the first inspection had not saved them. No alternate endpoint, identity or
retry following denial was used. The preserved sample returned HTTP 200,
`text/csv`, 257,078 bytes. SHA-256:
`4e2a602820c430073dd525aa20baf86076e0ff71b4c428ae454c074ee33eb88a`.
Raw historical observations remain outside source control and build output.

The file is CP932/Shift-JIS, with quoted commas and an embedded header newline.
It contains 1,159 parsed rows of 23 columns, including 1,138 complete seven-day
observations from January 2–8, 2005 through October 18–24, 2026. All observed
periods are continuous. Fullwidth punctuation, spaces and explicit ending years
on cross-year weeks must be handled. Never split physical lines as CSV records.

Column 0 is period. Zero-based columns 12–14 are equity/fund acquisitions,
dispositions and net; 15–17 are long-term debt; 18 is their subtotal net;
19–21 are short-term debt; 22 is total net. The adjacent block at columns 1–11
is outward investment and must not be mistaken for Japanese-issued securities.
The implemented parser validates English header anchors, the fixed bilingual layout, units, column order,
periods, signs and bounded rounding differences before selecting the latest
complete post-2014 observation. The January 2014 investment-fund classification
change is not silently bridged into a homogeneous historical series.

## Time, caching and safety

The retained sample's embedded file update is October 29, 2026 and its period
ends October 24. These are separate from acquisition timestamps and the HTTP
Last-Modified value. The [official release calendar](https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/schedule.htm)
sets weekly publication dates, with holiday adjustments. Its scheduled 08:50
JST release time is not proof of actual release time, so the API keeps
`source_released_at` null and separately exposes the file's `updated_date`.

Acquisition is on demand, shared across workers with a six-hour minimum check
interval. D1 stores one normalized last-good report and a persistent source
gate, not the full historical file. Schema or temporary transport failures
retain only still-valid evidence with stale status; expired evidence is hidden.
Report age over 14 days is stale, over 35 days is hidden; cache age over seven
days is hidden. Same-period corrections can replace prior values after
validation. Failed collection does not update successful acquisition time.

HTTP access refusals, rate limits, redirects and HTML challenges stop source
access persistently. Unknown gate state fails closed. Collection is bounded by
bytes and a whole-operation deadline. No background collection runs when the
page is closed. Public repository publication does not remove the Site's
existing owner-only authentication.

## Reuse and attribution

The [MOF copyright notice](https://www.mof.go.jp/english/about_mof/notice/index.html)
applies [Public Data License 1.0](https://www.digital.go.jp/en/resources/open_data/public_data_license_v1.0)
unless different rights are specified. It covers reproduction, modification
and public transmission, including commercial reuse; numerical data/simple
tables are freely usable. MOF's separately listed map restriction is not this
series. The Japanese licence text governs the reference English translation.

The UI cites MOF, the original file, the licence and methodological notes,
identifies extraction/visualization by this application, and does not imply
government authorship or endorsement. No credentials or paid agreement are
required by the tested download. No service-level guarantee is inferred from
two successful reads. [JPX remains a separate unenabled candidate](source-jp-jpx.md).

## Verification boundary

The official sample is parsed offline against the production parser. Unit,
runtime and UI tests use synthetic values only. Native Workers/D1 tests cover
encoding, shared cache, failure retention and durable denial. These checks do
not prove that a later authenticated production request can still reach MOF;
production deployment success and live source availability must be reported
separately.
