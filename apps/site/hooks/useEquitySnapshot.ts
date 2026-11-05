'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {REFRESH_MS, replySchema, visibleSnapshot, type EquityReply} from '@/lib/equity/model';

/** Source lifetime and permission handling stay outside the matrix projection. */
export function useEquitySnapshot() {
  const [data, setData] = useState<EquityReply | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<'network' | 'permission' | 'invalid' | null>(null);
  const [now, setNow] = useState(0);
  const active = useRef<AbortController | null>(null), mounted = useRef(false), blocked = useRef(false);
  const refresh = useCallback(async () => {
    if (active.current || blocked.current) return;
    const controller = new AbortController();
    active.current = controller; setLoading(true);
    const timeout = setTimeout(() => controller.abort(), 35_000);
    const current = () => mounted.current && active.current === controller;
    try {
      const response = await fetch('/api/v1/equities/snapshot', {credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: controller.signal});
      if (response.status === 401 || response.status === 403 || response.type === 'opaqueredirect' || response.redirected || response.status >= 300 && response.status < 400) {
        if (current()) {blocked.current = true; setData(null); setFailure('permission');}
        return;
      }
      let payload: unknown;
      try {payload = await response.json();}
      catch {
        if (response.status >= 500) throw new Error('temporary_response');
        if (current()) {setData(null); setFailure('invalid');}
        return;
      }
      const result = replySchema.safeParse(payload);
      if (!result.success || ![200, 503].includes(response.status)) {
        if (current()) {setData(null); setFailure('invalid');}
        return;
      }
      if (current()) {
        blocked.current = result.data.status.state === 'denied';
        setData(result.data); setFailure(null); setNow(Date.now());
      }
    } catch {
      if (current()) {setFailure('network'); setNow(Date.now());}
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {active.current = null; if (mounted.current) setLoading(false);}
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const start = setTimeout(() => {setNow(Date.now()); void refresh();}, 0);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(() => {if (document.visibilityState === 'visible') void refresh();}, REFRESH_MS);
    const visible = () => {setNow(Date.now()); if (document.visibilityState === 'visible') void refresh();};
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false; clearTimeout(start); clearInterval(tick); clearInterval(poll);
      document.removeEventListener('visibilitychange', visible); active.current?.abort(); active.current = null;
    };
  }, [refresh]);
  const snapshot = visibleSnapshot(data, now);
  const stale = !!snapshot && (failure === 'network' || data?.status.state === 'stale' || now - Date.parse(snapshot.fetched_at) > REFRESH_MS);
  return {data, snapshot, loading, failure, stale, denied: data?.status.state === 'denied', refresh};
}
