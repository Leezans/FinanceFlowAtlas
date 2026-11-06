"""Synthetic offline coverage only. No provider records or network in tests."""
import csv
import io
import itertools
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from financeflow.cvm_daily_refresh import refresh
from financeflow.source_cvm_daily import normalize, CLASS_FIELDS, SUB_FIELDS, DAILY_FIELDS, MAX_RECORD

NOW = '2026-11-06T12:00:00Z'


def cls(cid='1', cnpj='00000000000001', **changes):
    return {'ID_Registro_Classe': cid, 'CNPJ_Classe': cnpj,
            'Tipo_Classe': 'Classes de Cotas de Fundos FIF', 'Classificacao': 'Ações',
            'Classe_Cotas': 'N', 'Permitido_Aplicacao_CemPorCento_Exterior': 'N', **changes}


def sub(sid='S1', cid='1', **changes):
    return {'ID_Subclasse': sid, 'ID_Registro_Classe': cid, 'Data_Inicio': '2026-01-01',
            'Situacao': 'Em Funcionamento Normal', 'Data_Inicio_Situacao': '2026-01-01', **changes}


def daily(cnpj='00000000000001', day='2026-11-03', sid='', **changes):
    return {'TP_FUNDO_CLASSE': 'CLASSES - FIF', 'CNPJ_FUNDO_CLASSE': cnpj,
            'ID_SUBCLASSE': sid, 'DT_COMPTC': day, 'CAPTC_DIA': '100.25', 'RESG_DIA': '40.00', **changes}


def csv_bytes(fields, rows):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fields, delimiter=';', lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode('latin-1')


class CvmDailyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.registry = self.root / 'registry.zip'
        self.month = self.root / 'daily.zip'

    def inputs(self, rows=None, classes=None, subclasses=None):
        with zipfile.ZipFile(self.registry, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('registro_classe.csv', csv_bytes(CLASS_FIELDS, classes if classes is not None else [cls()]))
            z.writestr('registro_subclasse.csv', csv_bytes(SUB_FIELDS, subclasses or []))
        with zipfile.ZipFile(self.month, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('inf_diario_fi_202611.csv', csv_bytes(DAILY_FIELDS, rows if rows is not None else [daily()]))

    def run_adapter(self, **kwargs):
        return normalize([('2026-11', self.month)], registry_archive=self.registry, processed_at=NOW, **kwargs)

    def test_sign_units_provenance_and_no_deployment_claim(self):
        self.inputs()
        result = self.run_adapter()
        row = result['records'][0]
        self.assertEqual(row['valid_reported_subset']['net_subscriptions_brl'], '60.25')
        self.assertEqual(result['unit'], 'BRL')
        self.assertEqual(result['license'], 'ODbL-1.0')
        self.assertEqual(result['frequency'], 'daily')
        self.assertEqual(result['execution'], 'offline_preaggregation_only_not_deployed')
        self.assertIsNone(result['classification']['acquired_at'])
        self.assertEqual(len(result['classification']['version_sha256']), 64)
        self.assertIsNone(result['source_publication_at'])
        self.assertFalse(result['is_live'])
        self.assertTrue(row['is_provisional'])
        self.assertEqual(row['completeness'], 'unknown')

    def test_exact_large_amount_and_negative_net(self):
        self.inputs(rows=[daily(CAPTC_DIA='999999999999999.99', RESG_DIA='0.01')])
        self.assertEqual(self.run_adapter()['records'][0]['valid_reported_subset']['net_subscriptions_brl'], '999999999999999.98')
        self.inputs(rows=[daily(CAPTC_DIA='0.00', RESG_DIA='0.01')])
        self.assertEqual(self.run_adapter()['records'][0]['valid_reported_subset']['net_subscriptions_brl'], '-0.01')

    def test_missing_and_invalid_amounts_never_become_zero(self):
        for value in ['', 'NaN', 'Infinity', '1e8', '-1.00', '1.001', '9' * 16]:
            with self.subTest(value=value):
                self.inputs(rows=[daily(CAPTC_DIA=value)])
                row = self.run_adapter()['records'][0]
                self.assertIsNone(row['valid_reported_subset'])
                self.assertEqual(row['quarantine_reasons']['missing_or_invalid_amount'], 1)

    def test_explicit_zero_is_retained_and_absent_days_not_created(self):
        self.inputs(rows=[daily(CAPTC_DIA='0', RESG_DIA='0')])
        records = self.run_adapter()['records']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['valid_reported_subset']['net_subscriptions_brl'], '0.00')

    def test_exact_classification_and_supported_fund_type_only(self):
        self.inputs(classes=[cls(Classificacao='Multimercado')])
        row = self.run_adapter()['records'][0]
        self.assertIsNone(row['valid_reported_subset'])
        self.assertEqual(row['diagnostics']['other_classification_rows'], 1)
        self.inputs(rows=[daily(TP_FUNDO_CLASSE='FI')])
        self.assertEqual(self.run_adapter()['records'][0]['diagnostics']['unsupported_fund_type_rows'], 1)

    def test_unknown_classification_not_guessed(self):
        self.inputs(rows=[daily(cnpj='00000000000002')])
        row = self.run_adapter()['records'][0]
        self.assertEqual(row['diagnostics']['unmatched_classification_rows'], 1)
        self.assertIsNone(row['valid_reported_subset'])

    def test_duplicate_observation_quarantines_whole_class_in_any_order(self):
        for rows in itertools.permutations([daily(), daily(CAPTC_DIA='200')]):
            self.inputs(rows=rows)
            row = self.run_adapter()['records'][0]
            self.assertEqual(row['quarantined_classes'], 1)
            self.assertEqual(row['diagnostics']['duplicate_observation_rows'], 1)
            self.assertIsNone(row['valid_reported_subset'])

    def test_equivalent_registry_duplicates_fold_before_join(self):
        self.inputs(classes=[cls(), cls()])
        result = self.run_adapter()
        self.assertEqual(result['classification']['eligible_class_count'], 1)
        self.assertEqual(result['classification']['diagnostics']['equivalent_classification_duplicates'], 1)
        self.assertEqual(result['records'][0]['valid_reported_subset']['net_subscriptions_brl'], '60.25')

    def test_conflicting_registry_id_or_cnpj_never_last_row_wins(self):
        for extra in [cls(Classificacao='Renda Fixa'), cls(cid='2')]:
            for classes in [[cls(), extra], [extra, cls()]]:
                self.inputs(classes=classes)
                row = self.run_adapter()['records'][0]
                self.assertEqual(row['diagnostics']['classification_conflict_rows'], 1)
                self.assertIsNone(row['valid_reported_subset'])

    def test_subclass_sum_once_and_mixed_levels_quarantined(self):
        children = [sub('S1'), sub('S2')]
        rows = [daily(sid='S1'), daily(sid='S2', CAPTC_DIA='30', RESG_DIA='50')]
        self.inputs(rows=rows, subclasses=children)
        row = self.run_adapter()['records'][0]
        self.assertEqual(row['reporting_classes'], 1)
        self.assertEqual(row['valid_reported_subset']['net_subscriptions_brl'], '40.25')
        self.inputs(rows=rows+[daily()], subclasses=children)
        row = self.run_adapter()['records'][0]
        self.assertIsNone(row['valid_reported_subset'])
        self.assertEqual(row['quarantine_reasons']['mixed_class_and_subclass_levels'], 1)

    def test_missing_subclass_set_and_unknown_mapping_quarantined(self):
        self.inputs(rows=[daily(sid='S1')], subclasses=[sub('S1'), sub('S2')])
        row = self.run_adapter()['records'][0]
        self.assertIsNone(row['valid_reported_subset'])
        self.assertEqual(row['quarantine_reasons']['subclass_set_not_verified_against_registry'], 1)
        self.inputs(rows=[daily(sid='S1')])
        self.assertEqual(self.run_adapter()['records'][0]['quarantine_reasons']['unmatched_or_conflicting_subclass'], 1)

    def test_conflicting_subclass_invalidates_parent(self):
        self.inputs(rows=[daily(sid='S1')], classes=[cls(), cls('2', '00000000000002')],
                    subclasses=[sub(), sub(cid='2')])
        self.assertEqual(self.run_adapter()['records'][0]['quarantine_reasons']['subclass_classification_conflict'], 1)

    def test_unknown_subclass_status_cannot_prove_complete_group(self):
        for status in ['', 'unknown', 'Fase Pré-Operacional']:
            self.inputs(rows=[daily(sid='S1')], subclasses=[sub(Situacao=status)])
            row = self.run_adapter()['records'][0]
            self.assertIsNone(row['valid_reported_subset'])
            self.assertEqual(row['quarantine_reasons']['subclass_set_not_verified_against_registry'], 1)

    def test_partial_coverage_is_reported_not_finalized(self):
        self.inputs(classes=[cls(), cls('2', '00000000000002')],
                    rows=[daily(), daily(cnpj='00000000000002'), daily(day='2026-11-04', CAPTC_DIA='0', RESG_DIA='0')])
        row = self.run_adapter()['records'][1]
        self.assertTrue(row['low_reporting_coverage'])
        self.assertEqual(row['reporting_ratio_to_recent_reference'], .5)
        self.assertEqual(row['completeness'], 'unknown')
        self.assertEqual(row['reporting_classes'], 1)

    def test_invalid_class_does_not_poison_valid_subset(self):
        self.inputs(classes=[cls(), cls('2', '00000000000002')],
                    rows=[daily(), daily(cnpj='00000000000002', CAPTC_DIA='')])
        row = self.run_adapter()['records'][0]
        self.assertEqual(row['quarantined_classes'], 1)
        self.assertEqual(row['included_valid_classes'], 1)
        self.assertEqual(row['valid_reported_subset']['net_subscriptions_brl'], '60.25')

    def test_fund_of_funds_and_foreign_flags_are_not_domestic_claims(self):
        self.inputs(classes=[cls(Classe_Cotas='S', Permitido_Aplicacao_CemPorCento_Exterior='S')])
        result = self.run_adapter()
        self.assertEqual(result['records'][0]['included_fund_of_funds_classes'], 1)
        self.assertEqual(result['records'][0]['included_full_foreign_permission_classes'], 1)
        self.assertEqual(result['country_basis'], 'Brazil_registered_funds_not_underlying_asset_location')

    def test_unknown_scope_flags_are_explicit_not_false(self):
        self.inputs(classes=[cls(Classe_Cotas='', Permitido_Aplicacao_CemPorCento_Exterior='?')])
        row = self.run_adapter()['records'][0]
        self.assertEqual(row['included_unknown_fund_of_funds_classes'], 1)
        self.assertEqual(row['included_unknown_foreign_permission_classes'], 1)

    def test_streams_without_whole_member_read_or_network(self):
        self.inputs()
        with (patch.object(zipfile.ZipFile, 'read', side_effect=AssertionError('Whole member read')),
              patch('urllib.request.urlopen', side_effect=AssertionError('Network'))):
            self.assertEqual(len(self.run_adapter()['records']), 1)

    def test_archive_schema_and_month_fail_closed(self):
        self.inputs(rows=[daily(day='2026-10-30')])
        with self.assertRaises(ValueError): self.run_adapter()

    def test_large_header_empty_columns_and_multiline_record_budget(self):
        header = csv_bytes(DAILY_FIELDS, [])
        for raw in [b';' * (MAX_RECORD + 1) + b'\n',
                    header + b';' * (MAX_RECORD + 1) + b'\n',
                    header + b'"' + (b'x\n' * MAX_RECORD) + b'"\n']:
            self.inputs()
            with zipfile.ZipFile(self.month, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr('inf_diario_fi_202611.csv', raw)
            with self.assertRaisesRegex(ValueError, 'record exceeds byte budget'):
                self.run_adapter()

    def test_zip_directory_bounded_before_zipfile_allocation(self):
        self.inputs()
        with zipfile.ZipFile(self.month, 'a') as z:
            for i in range(10):
                z.writestr(f'extra{i}.csv', b'x')
        # The registry is opened normally; the oversized daily directory must
        # stop before a ZipFile for that archive is instantiated.
        with self.assertRaisesRegex(ValueError, 'ZIP directory'):
            self.run_adapter()
        self.inputs()
        with zipfile.ZipFile(self.month, 'w') as z:
            z.writestr('inf_diario_fi_202611.csv', b'DT_COMPTC;CAPTC_DIA\n2026-11-03;1\n')
        with self.assertRaises(ValueError): self.run_adapter()
        self.inputs()
        with zipfile.ZipFile(self.month, 'a') as z:
            z.writestr('../unsafe.csv', b'x')
        with self.assertRaises(ValueError): self.run_adapter()

    def test_crc_failure_preserves_previous_artifact(self):
        self.inputs()
        output = self.root / 'out.json'
        output.write_text('last good')
        with zipfile.ZipFile(self.month, 'w', zipfile.ZIP_STORED) as z:
            z.writestr('inf_diario_fi_202611.csv', csv_bytes(DAILY_FIELDS, [daily()]))
        raw = self.month.read_bytes()
        self.month.write_bytes(raw.replace(b'100.25', b'900.25'))
        with self.assertRaises(zipfile.BadZipFile):
            refresh(registry_archive=self.registry, daily_archives=[('2026-11', self.month)], output=output, processed_at=NOW)
        self.assertEqual(output.read_text(), 'last good')

    def test_atomic_output_is_separate_and_valid_json(self):
        self.inputs()
        output = self.root / 'artifact' / 'snapshot.json'
        result = refresh(registry_archive=self.registry, daily_archives=[('2026-11', self.month)], output=output, processed_at=NOW)
        self.assertEqual(json.loads(output.read_text()), result)
        with self.assertRaises(ValueError):
            refresh(registry_archive=self.registry, daily_archives=[('2026-11', self.month)], output=self.registry, processed_at=NOW)

    def test_timestamps_do_not_fabricate_acquisition(self):
        self.inputs()
        with self.assertRaises(ValueError): self.run_adapter(registry_acquired_at='2026-11-06')
        with self.assertRaises(ValueError): self.run_adapter(source_acquired_at='2026-11-07T00:00:00Z')
        self.assertIsNone(self.run_adapter()['source_archives'][0]['acquired_at'])


if __name__ == '__main__':
    unittest.main()
