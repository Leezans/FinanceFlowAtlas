"""Explicit local-archive CLI extension. No download, daemon, API, or deployment."""
import argparse
import json
import os
import tempfile
from pathlib import Path

from .source_cvm_daily import normalize


def refresh(*, registry_archive, daily_archives, output, registry_acquired_at=None,
            source_acquired_at=None, processed_at=None):
    """Prepare a new optional artifact atomically; preserve last good on failure."""
    payload = normalize(daily_archives, registry_archive=registry_archive,
                        registry_acquired_at=registry_acquired_at,
                        source_acquired_at=source_acquired_at, processed_at=processed_at)
    target = Path(output)
    if target.resolve() in {Path(p).resolve() for _, p in daily_archives} | {Path(registry_archive).resolve()}:
        raise ValueError('Output must not replace an input archive')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                         prefix='.cvm-daily-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return payload


def main():
    parser = argparse.ArgumentParser(description='Offline CVM daily fund-share preaggregation; not stock-market flows or a running service')
    parser.add_argument('--registry', required=True, help='Previously acquired official registry ZIP')
    parser.add_argument('--daily', action='append', nargs=2, metavar=('YYYY-MM', 'ZIP'), required=True,
                        help='One or two distinct monthly local ZIP inputs; no inferred latest period')
    parser.add_argument('--output', default='var/cvm-daily/snapshot.json', help='Optional local artifact; not read by the hosted Site')
    parser.add_argument('--registry-acquired-at', help='Known real acquisition timestamp, otherwise unknown')
    parser.add_argument('--source-acquired-at', help='Known shared acquisition timestamp for daily archives, otherwise unknown')
    args = parser.parse_args()
    try:
        payload = refresh(registry_archive=args.registry, daily_archives=args.daily, output=args.output,
                          registry_acquired_at=args.registry_acquired_at, source_acquired_at=args.source_acquired_at)
    except Exception:
        parser.exit(1, 'CVM offline preaggregation failed. No new artifact was published; check local archives, schema and limits.\n')
    print(f'Prepared {len(payload["records"])} provisional daily fund-share records locally; no download, schedule or Site integration enabled.')


if __name__ == '__main__':
    main()
