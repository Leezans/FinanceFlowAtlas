# Optional CVM daily fund-share preaggregation

## Execution status and intended consumer

This is an **optional offline Python data-processing extension**, following the
separate source-module/explicit-CLI pattern in `packages/core`. It consumes
already-acquired local archives and prepares a reviewable JSON artifact. It does
not download data, run a service, schedule collection, publish an API, update D1,
or connect to the hosted `/brazil` page. No production connection is implied by
this code, a successful command, or an offline test.

The hosted page continues to use the independent **monthly CDA disclosed stock
transactions** adapter. This daily dataset measures **fund-share subscriptions
minus redemptions**, a different economic event. It must not replace the monthly
industry/security matrix or be represented as a more timely version of its data.

There is currently no verified deployed Python runner or supported publication
bridge from this artifact to the Site. That is a production blocker. The
repository's optional A-share scheduler is not a general Python scheduler and is
not enabled by this change. The Site hosting manifest contains D1, not a Python
runtime or an artifact upload mechanism. Installed hosting CPU quotas have not
been verified. Do not use this offline adapter as evidence that daily ingestion
or unattended updates are operating.

## Authoritative source and permission

- [CVM daily reports](https://dados.cvm.gov.br/dataset/fi-doc-inf_diario):
  `CAPTC_DIA` is reported daily subscriptions and `RESG_DIA` redemptions.
- [CVM registry](https://dados.cvm.gov.br/dataset/fi-cad): class/subclass keys and
  investment classification.
- [Daily XML specification](https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/PadroesXML/PadraoXMLInfoDiarioNetV4.asp):
  class/subclass reporting and monetary precision.
- [Historical monetary unit clarification](https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/PadroesXML/PadraoXMLInfoDiarioNet.asp):
  monetary fields are reais (R$1), not thousands of reais.
- [Portal terms](https://dados.cvm.gov.br/about) require CVM attribution and
  non-misleading use and permit the provider to restrict automated concurrency.

Both catalogs identify ODbL. Output retains attribution, ODbL-1.0 and its link.
Any later public use must satisfy the applicable attribution/share-alike and
derived-database availability requirements. Application code's Apache license
does not replace the data license. Keep source archives, financial observations
and generated artifacts outside Git; tests construct synthetic archives only.

The provider updates current/prior-month daily files and periodically revises
older files. That is daily regulatory reporting, not intraday streaming. Future
acquisition requires an independent, permission-aware, cached transport. It must
respect source cache headers, denials and retry limits, never change hosts to
bypass a restriction, and never reset an existing source gate.

## Scope, identity and partial coverage

The adapter accepts only `TP_FUNDO_CLASSE = CLASSES - FIF`, matched unambiguously
to registry `Tipo_Classe = Classes de Cotas de Fundos FIF` and
`Classificacao = Ações`. It identifies **Brazil-registered equity funds**, not
where their underlying assets are invested. It does not infer classification
from names. Legacy FI, FAPI and other categories are counted as excluded.

The economic scope is not investor nationality, cross-border flows, issuer cash,
individual-stock purchases, or the entire Brazilian stock market. Fund-of-funds
and funds permitted to invest fully abroad remain in scope and are explicitly
counted. Unknown flags have separate counts. Fund-to-fund transactions are not
consolidated. A foreign-permission flag of N does not prove all holdings domestic.

- Registry semantic duplicates are collapsed before joins. Conflicting class
  IDs, reused CNPJs or conflicting child mappings are quarantined; no last-row
  wins rule. Custodian-only differences do not duplicate a classification.
- `(observation date, class ID, subclass ID)` identifies a report. A repeated
  report, including an identical repeat, quarantines the affected class/day.
- Class totals and subclass rows cannot both be added. Subclass groups must
  agree with the supplied registry sibling set; unknown status/dates or a
  missing/unmapped sibling quarantine the class/day. These conservative checks
  are against this snapshot only, not proof of historical completeness.
- Missing, malformed, negative gross amounts or excess precision quarantine the
  class/day. Monetary arithmetic uses integer cents; JSON amounts are decimal
  strings. No floating-point financial arithmetic or missing-to-zero conversion.
- `valid_reported_subset` aggregates only included valid classes. It is null
  when none can be included. It is never a complete-market total. Quarantined
  class counts/reasons and excluded source-row counts accompany every date.
- No absent calendar dates or unreported classes receive synthetic zero rows.
  A genuine reported zero is preserved, even if only one class has reported.
- Every date is provisional and has `completeness = unknown`. The maximum
  reporting count over the preceding five observed nonempty dates is merely a
  reference. A count below 95% is flagged `low_reporting_coverage`; passing is
  not official completeness and does not select a publishable headline.

Current registry membership is not point-in-time historical membership. Each
artifact records its registry SHA-256 version, exact input archive hashes and
explicit months. Acquisition timestamps are optional and stay null if unknown.
Processing time is distinct and never becomes a source publication timestamp.

## Offline command and budgets

From the repository root, with the normal Python dependencies installed:

```sh
PYTHONPATH=packages/core/src python -m financeflow.cvm_daily_refresh \
  --registry /path/to/registro_fundo_classe.zip \
  --daily 2026-10 /path/to/inf_diario_fi_202610.zip \
  --daily 2026-11 /path/to/inf_diario_fi_202611.zip \
  --output var/cvm-daily/snapshot.json
```

Use one or two distinct explicit months. Optional `--registry-acquired-at` and
`--source-acquired-at` accept known timezone-aware acquisition timestamps; omit
them rather than infer them from file modification or processing time. The
second option applies to all supplied daily archives, so omit it if their
individual acquisition times differ or are unknown.

Selected ZIP members stream through CRC-checked `zipfile` readers and Latin-1
CSV parsing. A temporary SQLite ledger holds monthly report identities and
amounts on disk; only one bounded subclass group is aggregated at a time.
No complete decoded member or monthly list of Python row objects is created.
Inputs are hashed on the same open file handle before and after processing.

Budgets: 32 MiB compressed per archive, 96 MiB per decoded member, at most ten
unique safe-name CSV members, 100,000 rows per registry member, 1,000,000 rows
per monthly member, 128 columns, 16,384 characters per field, 64 KiB per logical
record **before CSV field allocation**, and 2,048 reports per class/day.
Encrypted, ZIP64 and unsupported compression are rejected. No archive member
is extracted to a source-controlled directory. Output replacement is atomic;
parse/validation failure leaves the previous artifact intact.

## Offline feasibility evidence, not production proof

At baseline `80ff4bec`, the existing hosted `CsvZip` reader has a 400,000-row
limit. Using already-downloaded official samples, November's 47,306 rows fit,
but October's 537,408 rows stop at that limit. A Node-only run measured roughly
0.33 seconds CPU for November and 2.4 seconds before October's rejection. These
are not workerd CPU measurements or installed-plan verification. The existing
monthly adapter has its own separate native-runtime validation; neither result
proves a new daily adapter will work within production quotas.

The Python adapter processed the downloaded October/November reports plus the
registry offline at approximately 7.3 seconds CPU and 68 MiB peak process RSS
in the research environment. Reproduce measurements on the intended runner
before capacity planning. This demonstrates an offline processing path only.

Next steps for an actual deployment, explicitly **not implemented here**:
verify an authorized persistent runner and publication mechanism, add bounded
conditional acquisition and revision handling, preserve independent source
stops, define authenticated delivery and retention, test installed runtime
limits, and separately design a fund-share-flow UI with partial-coverage labels.
Do not feed this artifact to the existing monthly equity-transaction endpoint.

## Verification

```sh
PYTHONPATH=packages/core/src python -m unittest discover -s tests -p 'test_cvm_daily.py' -v
PYTHONPATH=packages/core/src python -m unittest discover -s tests -v
```

Tests are offline and synthetic. They cover precision, unknown amounts/flags,
classification conflicts, duplicate reports, class/subclass overlap and missing
siblings, coverage drops, CRC failures, pre-parse CSV limits, provenance and
atomic replacement. They do not call CVM or any other provider.
