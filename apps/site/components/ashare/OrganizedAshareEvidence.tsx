'use client';

import React, {useEffect, useMemo, useState} from 'react';
import OrganizedEvidence from '@/components/evidence/OrganizedEvidence';
import {
  ashareExportExpiresAt,
  projectAshareReport,
  visibleAshareExportSnapshot,
} from '@/lib/evidence/ashare-projection';
import type {EvidenceState} from './client';
import type {Scope} from './model';

/** Purely local export lifecycle. Never changes the client, gate or polling schedule. */
export default function OrganizedAshareEvidence({state, scope}: {state: EvidenceState; scope: Scope}) {
  const [now, setNow] = useState<number | null>(null);
  const snapshot = state.snapshot;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      if (snapshot) {
        const expiry = ashareExportExpiresAt(snapshot);
        const fetched = Date.parse(snapshot.fetched_at);
        // Resample when a replacement snapshot is newer than the last local sample.
        const next = current < fetched ? fetched : expiry;
        if (next > current) timer = setTimeout(update, Math.min(next - current, 2_147_483_647));
      }
    };
    timer = setTimeout(update, 0);
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [snapshot]);

  // Recheck permission, scope and expiry every render, before reusing a report.
  const visible = visibleAshareExportSnapshot(state, scope, now);
  const stale = state.status === 'stale' || !!state.retainedAfterFailure || !!state.retainedDuringCollection;
  const report = useMemo(() => projectAshareReport(visible, stale), [visible, stale]);

  return (
    <OrganizedEvidence report={report} onDownload={event => {
      const current = Date.now();
      setNow(current);
      // A throttled expiry timer must not let a newly clicked stale export through.
      if (!visibleAshareExportSnapshot(state, scope, current)) event.preventDefault();
    }}/>
  );
}
