# IMF PIP Equity adapter v0.2 evidence

Dataset: IMF.STA,PIP,5.0.0. Indicator P_F51_P_USD is **Equity**. It must not be labeled Equity and fund shares: in the structure, F5 aggregates equity and fund shares, F51 equity, F52 fund shares. Contract uses asset_class=equity.

Dimensions selected: accounting entry A; sector S1; counterpart sector S1; frequency S. COUNTRY is holder residence, COUNTERPART_COUNTRY is issuer residence. Reporting offices, exchange locations and nationalities are not interchangeable.

## USD unit gate
For this exact PIP flow, OBS_VALUE is already full USD although SCALE metadata is 6. It must not be multiplied by 1,000,000 again. Verification on 2026-11-04:
- IMF single-series response: USA.A.P_F51_P_USD.S1.S1.JPN.S, period 2025-S2.
- Independent US Treasury SLT table 2, Japan row for December 2025, us_lt_eqty_pos is explicitly denominated in millions of dollars.
- The Treasury value times 1,000,000 matches the IMF OBS_VALUE exactly for this comparison. This establishes unit scale for this adapter, not full-table reconciliation or universal IMF semantics.
- Additional Canada/UK comparisons were close but not identical; reasons were not resolved in this pass. Do not claim all-source equality.

Official sources:
https://api.imf.org/external/sdmx/2.1/dataflow/IMF.STA/PIP/latest?references=all
https://api.imf.org/external/sdmx/2.1/data/IMF.STA,PIP,5.0.0/USA.A.P_F51_P_USD.S1.S1.JPN.S?startPeriod=2025-S2&endPeriod=2025-S2&format=csvfile
https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table2.html

A new provider version, unit, SCALE or indicator must trigger renewed semantic review. CLI attestation is not an automatic proof. Full source responses are kept out of Git.

## Exclusions and gaps
Only ISO countries/territories become nodes; aggregate/special region codes are excluded and counted. Domestic edges, flagged records, missing observations and negative positions are excluded and counted. Negative positions may have legitimate source meaning; this first UI does not support signed holdings and therefore does not represent the full source aggregate. Do not replace negatives with absolute values or zero, and do not call displayed totals global all-equity wealth.
