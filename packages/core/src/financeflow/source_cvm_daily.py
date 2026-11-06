"""Offline, bounded CVM daily fund-share aggregation. Never equity-market flows.

ZIP members are streamed; a temporary SQLite ledger keeps monthly observations
and duplicate detection off the Python heap. No network or hosting side effects.
"""
import csv
import hashlib
import io
import itertools
import os
import re
import sqlite3
import struct
import tempfile
import zipfile
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

SOURCE_ID = 'br-cvm-daily-equity-fund-share-flows'
ADAPTER_VERSION = 'cvm-daily-offline-v1'
SOURCE_PAGE = 'https://dados.cvm.gov.br/dataset/fi-doc-inf_diario'
REGISTRY_URL = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip'
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_MEMBER = 96 * 1024 * 1024
MAX_ROWS = 1_000_000
MAX_RECORD = 64 * 1024
CLASS_FIELDS = ('ID_Registro_Classe', 'CNPJ_Classe', 'Tipo_Classe', 'Classificacao',
                'Classe_Cotas', 'Permitido_Aplicacao_CemPorCento_Exterior')
SUB_FIELDS = ('ID_Subclasse', 'ID_Registro_Classe', 'Data_Inicio', 'Situacao', 'Data_Inicio_Situacao')
DAILY_FIELDS = ('TP_FUNDO_CLASSE', 'CNPJ_FUNDO_CLASSE', 'ID_SUBCLASSE', 'DT_COMPTC', 'CAPTC_DIA', 'RESG_DIA')


def _timestamp(value):
    if value is None:
        return None
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timestamp requires timezone')
    return result.astimezone(timezone.utc).isoformat()


def _date(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Invalid observation date')
    return date.fromisoformat(value).isoformat()


def _cnpj(value):
    if not re.fullmatch(r'(?:\d{14}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', value):
        raise ValueError('Invalid CNPJ format')
    return re.sub(r'\D', '', value)


def _cents(value):
    # CVM numeric(17,2); strings avoid SQLite/JSON floating-point rounding.
    if not re.fullmatch(r'\d{1,15}(?:\.\d{1,2})?', value):
        return None
    whole, _, fraction = value.partition('.')
    return int(whole) * 100 + int(fraction.ljust(2, '0') or '0')


def _money(cents):
    return f'{"-" if cents < 0 else ""}{abs(cents) // 100}.{abs(cents) % 100:02d}'


def _check_directory(raw, size):
    # Bound central-directory allocation before constructing ZipFile. Its own
    # parser otherwise materializes every entry before our member-count check.
    raw.seek(max(0, size - 65557))
    tail = raw.read(65557)
    offset = tail.rfind(b'PK\x05\x06')
    if offset < 0 or len(tail) - offset < 22:
        raise ValueError('Missing ZIP directory')
    _, disk, central_disk, disk_count, count, length, start, comment = struct.unpack_from('<4s4H2IH', tail, offset)
    absolute = size - len(tail) + offset
    if (disk or central_disk or disk_count != count or not 1 <= count <= 10
            or length > 65536 or start + length != absolute
            or offset + 22 + comment != len(tail)):
        raise ValueError('Unsupported or oversized ZIP directory')
    raw.seek(0)


@contextmanager
def _archive(path):
    with Path(path).open('rb') as raw:
        size = os.fstat(raw.fileno()).st_size
        if not 22 <= size <= MAX_ARCHIVE:
            raise ValueError('Archive exceeds size budget')
        _check_directory(raw, size)
        digest = hashlib.file_digest(raw, 'sha256').hexdigest()
        raw.seek(0)
        with zipfile.ZipFile(raw) as archive:
            members = archive.infolist()
            if not 1 <= len(members) <= 10 or len({m.filename for m in members}) != len(members):
                raise ValueError('Missing or duplicate ZIP members')
            for member in members:
                if (not re.fullmatch(r'[A-Za-z0-9_.-]+\.csv', member.filename)
                        or member.file_size > MAX_MEMBER or member.compress_size > MAX_ARCHIVE
                        or member.flag_bits & 1 or member.extract_version >= 45
                        or member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                    raise ValueError('Unsupported or oversized ZIP member')
            yield archive, {'sha256': digest, 'compressed_bytes': size}
            raw.seek(0)
            if hashlib.file_digest(raw, 'sha256').hexdigest() != digest:
                raise ValueError('Archive changed during processing')


class _RecordLines:
    """Bound each logical CSV record before csv allocates fields (including empties)."""
    def __init__(self, stream):
        self.stream = stream
        self.used = 0

    def __iter__(self):
        return self

    def __next__(self):
        line = self.stream.readline(MAX_RECORD + 1)
        if not line:
            raise StopIteration
        self.used += len(line)
        if self.used > MAX_RECORD:
            raise ValueError('CSV record exceeds byte budget')
        return line


def _rows(archive, member, required, max_rows=MAX_ROWS):
    # zipfile validates local headers/CRC while the selected member reaches EOF.
    # No extract(), read(member), full decoded CSV, or list of observations.
    with archive.open(member) as raw, io.TextIOWrapper(raw, encoding='latin-1', newline='') as stream:
        lines = _RecordLines(stream)
        reader = csv.DictReader(lines, delimiter=';', strict=True)
        fields = reader.fieldnames or []
        if (len(fields) > 128 or len(set(fields)) != len(fields)
                or not set(required).issubset(fields)):
            raise ValueError('Missing or duplicate CSV columns')
        lines.used = 0
        for count, row in enumerate(reader, 1):
            if count > max_rows or None in row or any(v is None or len(v) > 16384 for v in row.values()):
                raise ValueError('Malformed or oversized CSV record')
            yield row
            lines.used = 0


def _registry(archive):
    variants = defaultdict(set)
    cnpj_ids = defaultdict(set)
    counts = Counter()
    for row in _rows(archive, 'registro_classe.csv', CLASS_FIELDS, 100_000):
        cid = row['ID_Registro_Classe']
        if not re.fullmatch(r'\d{1,19}', cid):
            raise ValueError('Invalid class identifier')
        values = tuple(row[k] for k in CLASS_FIELDS)
        cnpj = _cnpj(values[1])
        if values in variants[cid]:
            counts['equivalent_classification_duplicates'] += 1
        variants[cid].add(values)
        cnpj_ids[cnpj].add(cid)
    conflicts = {cid for cid, values in variants.items() if len(values) != 1}
    conflicts.update(cid for ids in cnpj_ids.values() if len(ids) != 1 for cid in ids)
    classes = {cid: dict(zip(CLASS_FIELDS, next(iter(values))))
               for cid, values in variants.items() if cid not in conflicts}
    by_cnpj = {_cnpj(c['CNPJ_Classe']): cid for cid, c in classes.items()}
    conflict_cnpjs = {cnpj for cnpj, ids in cnpj_ids.items() if ids & conflicts}
    sub_variants = defaultdict(set)
    for row in _rows(archive, 'registro_subclasse.csv', SUB_FIELDS, 100_000):
        sid = row['ID_Subclasse']
        if not re.fullmatch(r'[A-Za-z0-9]{1,15}', sid):
            raise ValueError('Invalid subclass identifier')
        value = tuple(row[k] for k in SUB_FIELDS)
        if value in sub_variants[sid]:
            counts['equivalent_subclass_duplicates'] += 1
        sub_variants[sid].add(value)
    sub_conflicts = {sid for sid, values in sub_variants.items() if len(values) != 1}
    # A conflicting child invalidates every affected parent, not just that row.
    bad_parents = {v[1] for sid in sub_conflicts for v in sub_variants[sid]}
    subclasses = {}
    children = defaultdict(dict)
    for sid, values in sub_variants.items():
        if sid in sub_conflicts:
            continue
        item = dict(zip(SUB_FIELDS, next(iter(values))))
        for key in ('Data_Inicio', 'Data_Inicio_Situacao'):
            if item[key]:
                _date(item[key])
        subclasses[sid] = item
        children[item['ID_Registro_Classe']][sid] = item
    counts.update(classification_conflict_classes=len(conflicts),
                  subclass_conflicts=len(sub_conflicts))
    return classes, by_cnpj, conflict_cnpjs, subclasses, children, bad_parents, counts


def normalize(daily_archives, *, registry_archive, processed_at=None,
              registry_acquired_at=None, source_acquired_at=None):
    """Aggregate 1-2 explicit local (YYYY-MM, ZIP path) inputs, without downloading.

    All output is provisional valid-reported-subset evidence. Neither registry
    membership nor recent reporting counts establish official completeness.
    """
    if not 1 <= len(daily_archives) <= 2 or len({m for m, _ in daily_archives}) != len(daily_archives):
        raise ValueError('Supply one or two distinct explicit report months')
    processed_at = _timestamp(processed_at or datetime.now(timezone.utc).isoformat())
    registry_acquired_at = _timestamp(registry_acquired_at)
    source_acquired_at = _timestamp(source_acquired_at)
    if any(t and t > processed_at for t in (registry_acquired_at, source_acquired_at)):
        raise ValueError('Acquisition cannot follow processing')
    with _archive(registry_archive) as (archive, registry_meta):
        classes, by_cnpj, conflict_cnpjs, subclasses, children, bad_parents, registry_counts = _registry(archive)
    eligible = {cid for cid, c in classes.items()
                if c['Tipo_Classe'] == 'Classes de Cotas de Fundos FIF' and c['Classificacao'] == 'Ações'}
    archives = []
    diagnostics = defaultdict(Counter)
    with tempfile.TemporaryDirectory(prefix='ffa-cvm-daily-') as temporary:
        with sqlite3.connect(str(Path(temporary) / 'ledger.sqlite')) as db:
            db.execute('PRAGMA cache_size=-4096')
            db.execute('CREATE TABLE reports(day TEXT, cls TEXT, sub TEXT, buy TEXT, sell TEXT, PRIMARY KEY(day,cls,sub))')
            db.execute('CREATE TABLE blocked(day TEXT, cls TEXT, reason TEXT, PRIMARY KEY(day,cls,reason))')
            def block(day, cid, reason):
                db.execute('INSERT OR IGNORE INTO blocked VALUES(?,?,?)', (day, cid, reason))
            for month, path in sorted(daily_archives):
                if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])', month):
                    raise ValueError('Expected explicit month YYYY-MM')
                member = f'inf_diario_fi_{month.replace("-", "")}.csv'
                with _archive(path) as (archive, archive_meta):
                    for row in _rows(archive, member, DAILY_FIELDS):
                        day = _date(row['DT_COMPTC'])
                        if not day.startswith(month + '-') or day > processed_at[:10]:
                            raise ValueError('Observation outside source month or in future')
                        quality = diagnostics[day]
                        quality['source_rows'] += 1
                        if row['TP_FUNDO_CLASSE'] != 'CLASSES - FIF':
                            quality['unsupported_fund_type_rows'] += 1
                            continue
                        cnpj = _cnpj(row['CNPJ_FUNDO_CLASSE'])
                        cid = by_cnpj.get(cnpj)
                        if cnpj in conflict_cnpjs:
                            quality['classification_conflict_rows'] += 1
                            continue
                        if cid is None:
                            quality['unmatched_classification_rows'] += 1
                            continue
                        if cid not in eligible:
                            quality['other_classification_rows'] += 1
                            continue
                        sid = row['ID_SUBCLASSE']
                        quality['eligible_report_rows'] += 1
                        if cid in bad_parents:
                            block(day, cid, 'subclass_classification_conflict')
                        if sid and (sid not in subclasses or subclasses[sid]['ID_Registro_Classe'] != cid):
                            block(day, cid, 'unmatched_or_conflicting_subclass')
                        buy, sell = _cents(row['CAPTC_DIA']), _cents(row['RESG_DIA'])
                        if buy is None or sell is None:
                            block(day, cid, 'missing_or_invalid_amount')
                        try:
                            db.execute('INSERT INTO reports VALUES(?,?,?,?,?)',
                                       (day, cid, sid, None if buy is None else str(buy), None if sell is None else str(sell)))
                        except sqlite3.IntegrityError:
                            block(day, cid, 'duplicate_observation')
                            quality['duplicate_observation_rows'] += 1
                archives.append({'report_month': month,
                    'source_url': f'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/{member[:-4]}.zip',
                    **archive_meta,
                    'acquired_at': source_acquired_at})
            db.commit()
            records = []
            history = []
            for day in sorted(diagnostics):
                buys = sells = included = reported = fof = foreign = unknown_fof = unknown_foreign = 0
                reasons = Counter()
                cursor = db.execute('SELECT cls,sub,buy,sell FROM reports WHERE day=? ORDER BY cls,sub', (day,))
                # Only one class's small subclass group is retained at a time.
                for cid, group in itertools.groupby(cursor, key=lambda r: r[0]):
                    rows = list(itertools.islice(group, 2049))
                    if len(rows) > 2048:
                        raise ValueError('Subclass group exceeds budget')
                    reported += 1
                    group_reasons = {r[0] for r in db.execute('SELECT reason FROM blocked WHERE day=? AND cls=?', (day, cid))}
                    ids = {r[1] for r in rows}
                    if '' in ids and len(ids) > 1:
                        group_reasons.add('mixed_class_and_subclass_levels')
                    if '' not in ids:
                        expected = set()
                        uncertain = False
                        for child, info in children[cid].items():
                            start, changed = info['Data_Inicio'], info['Data_Inicio_Situacao']
                            if (not start or not changed
                                    or info['Situacao'] not in ('Em Funcionamento Normal', 'Em Liquidação', 'Cancelado')):
                                uncertain = True
                            elif start <= day and not (info['Situacao'] == 'Cancelado' and changed <= day):
                                expected.add(child)
                        if uncertain or ids != expected:
                            group_reasons.add('subclass_set_not_verified_against_registry')
                    if group_reasons:
                        reasons.update(group_reasons)
                        continue
                    included += 1
                    buys += sum(int(r[2]) for r in rows)
                    sells += sum(int(r[3]) for r in rows)
                    fof += classes[cid]['Classe_Cotas'] == 'S'
                    foreign += classes[cid]['Permitido_Aplicacao_CemPorCento_Exterior'] == 'S'
                    unknown_fof += classes[cid]['Classe_Cotas'] not in ('S', 'N')
                    unknown_foreign += classes[cid]['Permitido_Aplicacao_CemPorCento_Exterior'] not in ('S', 'N')
                reference = max(history[-5:]) if history else None
                ratio = None if not reference else round(reported / reference, 6)
                low = reference is not None and reported < reference * .95
                valid = None if not included else {'subscriptions_brl': _money(buys),
                    'redemptions_brl': _money(sells), 'net_subscriptions_brl': _money(buys - sells)}
                records.append({'observation_date': day, 'is_provisional': True,
                    'completeness': 'unknown', 'reporting_classes': reported,
                    'included_valid_classes': included, 'quarantined_classes': reported - included,
                    'quarantine_reasons': dict(sorted(reasons.items())),
                    'included_fund_of_funds_classes': fof, 'included_full_foreign_permission_classes': foreign,
                    'included_unknown_fund_of_funds_classes': unknown_fof,
                    'included_unknown_foreign_permission_classes': unknown_foreign,
                    'recent_observed_reference_classes': reference,
                    'reporting_ratio_to_recent_reference': ratio, 'low_reporting_coverage': low,
                    'valid_reported_subset': valid, 'diagnostics': dict(sorted(diagnostics[day].items()))})
                if reported:
                    history.append(reported)
    return {'source_id': SOURCE_ID, 'adapter_version': ADAPTER_VERSION,
        'concept': 'reported_equity_fund_share_subscriptions_minus_redemptions',
        'country_basis': 'Brazil_registered_funds_not_underlying_asset_location',
        'unit': 'BRL', 'frequency': 'daily', 'is_live': False,
        'execution': 'offline_preaggregation_only_not_deployed', 'processed_at': processed_at,
        'source_publication_at': None, 'source_url': SOURCE_PAGE, 'source_archives': archives,
        'classification': {'source_url': REGISTRY_URL, 'version_sha256': registry_meta['sha256'],
            'acquired_at': registry_acquired_at, 'basis': 'provided_registry_snapshot_not_historical_membership',
            'eligible_class_count': len(eligible), 'diagnostics': dict(sorted(registry_counts.items()))},
        'license': 'ODbL-1.0', 'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
        'attribution': 'Source: Comissão de Valores Mobiliários (CVM), accessed through Portal Dados Abertos da CVM, https://dados.cvm.gov.br/.',
        'records': records,
        'limitations': ['Valid reported fund-share subscriptions/redemptions only; not stock trades, whole-market or cross-border capital flows.',
            'Includes fund-of-funds and potentially foreign investments. Inter-fund transactions are not consolidated.',
            'Missing reports are not zero; absent days are not created. Source revisions and late filings can change all aggregates.',
            'Classification and sibling checks use the supplied registry snapshot, not proven historical membership.',
            'Recent-count coverage is a heuristic, never an official completeness test. No record is marked complete.',
            'ODbL attribution and applicable share-alike obligations apply to public use of this derived database.']}
