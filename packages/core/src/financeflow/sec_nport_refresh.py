"""Explicit, bounded SEC refresh. No account, inferred identity, or default network call."""
import argparse
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from .sec_nport_download import fetch
from .sec_nport_service import FundStore
from .source_sec_nport import normalize


def refresh(*, vintage, report_month, data_dir, user_agent=None, download=False):
    """Fetch one explicit vintage and publish one report-month cohort atomically.

    Caller must authorize sending the supplied real project/contact identity to
    SEC. Never infer an address from user profiles or fabricate one. Not a
    scheduler: source publication frequency is quarterly, not live.
    """
    if not download:
        raise ValueError('Network retrieval requires explicit --download opt-in')
    if not user_agent:
        raise ValueError('Set SEC_USER_AGENT to an authorized real project/contact identity')
    if not re.fullmatch(r'20\d{2}q[1-4]', vintage):
        raise ValueError('Expected bulk vintage YYYYqN')
    if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])', report_month):
        raise ValueError('Expected report month YYYY-MM')
    if '@' not in user_agent or '\n' in user_agent or '\r' in user_agent:
        raise ValueError('SEC User-Agent requires an authorized real contact email')
    store = FundStore(Path(data_dir) / 'sec-nport.sqlite')
    try:
        members, metadata = fetch(vintage, user_agent)
        retrieved_at = datetime.now(timezone.utc).isoformat()
        payload = normalize(members['SUBMISSION.tsv'], members['FUND_REPORTED_INFO.tsv'],
                            report_month=report_month, vintage=vintage, retrieved_at=retrieved_at,
                            source_last_modified=metadata.get('source_http_last_modified'))
        return store.save(payload)
    except Exception:
        store.fail(datetime.now(timezone.utc).isoformat())
        raise


def main():
    parser = argparse.ArgumentParser(description='Explicit bounded SEC fund-share refresh; not stock-market flows')
    parser.add_argument('--vintage', required=True, help='Explicit verified bulk vintage, e.g. 2026q3')
    parser.add_argument('--report-month', required=True, help='Explicit report cohort, e.g. 2026-06; latest may cover fewer funds')
    parser.add_argument('--data-dir', default=os.getenv('FFA_DATA_DIR', 'var'))
    parser.add_argument('--download', action='store_true', help='Authorize this SEC retrieval using configured real contact identity')
    args = parser.parse_args()
    try:
        snapshot = refresh(vintage=args.vintage, report_month=args.report_month, data_dir=args.data_dir,
                           download=args.download, user_agent=os.getenv('SEC_USER_AGENT'))
    except Exception:
        # Do not print upstream bodies, paths, or configured identity.
        parser.exit(1, 'SEC refresh did not publish a new snapshot. Check explicit download opt-in, authorized SEC_USER_AGENT, source availability and schema. Last good snapshot is retained.\n')
    print(f'SEC {snapshot.report_month}: {snapshot.fund_count} fund series; delayed fund-share flows, not a market total')


if __name__ == '__main__':
    main()
