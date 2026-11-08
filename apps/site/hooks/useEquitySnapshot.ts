'use client';
import {useReport} from '@/components/markets/useReport';
import {REFRESH_MS, replySchema, visibleSnapshot} from '@/lib/equity/model';

// A stable parser keeps view re-renders from restarting the shared lifecycle.
const parse = (value: unknown) => replySchema.parse(value);

/** Annual-equity display rules stay separate from browser request coordination.
 * Server source admission, daily cadence and durable denial are unchanged. */
export function useEquitySnapshot() {
  const {reply: data, loading, failure, now, refresh, nextDeadline, coolingDown} =
    useReport('/api/v1/equities/snapshot', parse, REFRESH_MS, 35_000);
  const snapshot = visibleSnapshot(data, now);
  const stale = !!snapshot && (failure === 'network' || data?.status.state === 'stale' || now - Date.parse(snapshot.fetched_at) > REFRESH_MS);
  return {data, snapshot, loading, failure, stale, denied: data?.status.state === 'denied', refresh, nextDeadline, coolingDown};
}
