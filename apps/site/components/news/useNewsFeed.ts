'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {NewsSnapshot} from '@/lib/news/types';
import {parseNewsSnapshot} from './client';
import {NEWS_REFRESH_MS} from './presentation';

export const NEWS_REQUEST_TIMEOUT_MS = 25_000;
type FeedState = {
  snapshot: NewsSnapshot | null;
  pending: boolean;
  error: string | null;
  browserStale: boolean;
  blocked: boolean;
  lastCheckedAt: string | null;
  newCount: number;
};

export function useNewsFeed() {
  const [state, setState] = useState<FeedState>({snapshot: null, pending: true, error: null, browserStale: false, blocked: false, lastCheckedAt: null, newCount: 0});
  const [notifications, setNotificationsState] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const notifyRef = useRef(false);
  const refresh = useCallback(() => refreshRef.current(), []);
  const setNotifications = useCallback((enabled: boolean) => {
    notifyRef.current = enabled;
    setNotificationsState(enabled);
    setState(previous => ({...previous, newCount: 0}));
  }, []);
  const dismissNew = useCallback(() => setState(previous => ({...previous, newCount: 0})), []);

  useEffect(() => {
    let disposed = false;
    let inflight: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let lastAttempt = 0;
    let blocked = false;
    let initialized = false;
    const knownIds = new Set<string>();

    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (!disposed && !blocked) timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        else schedule();
      }, NEWS_REFRESH_MS);
    };
    const load = async () => {
      if (disposed || inflight || blocked) return;
      if (timer) clearTimeout(timer);
      const controller = new AbortController();
      inflight = controller;
      lastAttempt = Date.now();
      setNow(lastAttempt);
      setState(previous => ({...previous, pending: true}));
      try {
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, NEWS_REQUEST_TIMEOUT_MS);
        });
        const response = await Promise.race([
          fetch('/api/news', {signal: controller.signal, cache: 'no-store', redirect: 'manual'}), deadline,
        ]);
        if (disposed) return;
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400) || response.status === 401 || response.status === 403 || response.status === 451 || response.redirected) {
          blocked = true;
          setState(previous => ({...previous, snapshot: null, error: '访问受限或登录状态已失效，自动检查已停止。请确认访问权限后刷新页面。', pending: false, browserStale: false, blocked: true, newCount: 0}));
          return;
        }
        if (!response.ok && response.status !== 503) throw new Error('network');
        let payload: unknown;
        try { payload = await Promise.race([response.json(), deadline]); } catch (error) {
          if (!response.ok || !(error instanceof SyntaxError)) throw error;
          payload = null;
        }
        if (disposed) return;
        const snapshot = parseNewsSnapshot(payload);
        if (!snapshot) {
          setState(previous => ({...previous, snapshot: null, pending: false, error: '响应未通过校验，未展示无法核验的内容。请稍后重试。', browserStale: false, newCount: 0}));
          return;
        }
        const ids = [...snapshot.news, ...snapshot.events].map(item => item.id);
        const arrivals = initialized && notifyRef.current ? ids.filter(id => !knownIds.has(id)).length : 0;
        ids.forEach(id => knownIds.add(id));
        while (knownIds.size > 10_000) knownIds.delete(knownIds.values().next().value!);
        initialized = true;
        setState(previous => ({snapshot, pending: false, error: null, browserStale: false, blocked: false, lastCheckedAt: new Date().toISOString(), newCount: previous.newCount + arrivals}));
      } catch {
        if (!disposed) setState(previous => ({...previous, pending: false, error: '本次检查失败。请检查网络或稍后重试。', browserStale: !!previous.snapshot}));
      } finally {
        if (timeout) clearTimeout(timeout);
        inflight = null;
        if (!disposed) schedule();
      }
    };
    const onVisibility = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible' && Date.now() - lastAttempt >= NEWS_REFRESH_MS) void load();
    };
    refreshRef.current = () => { void load(); };
    // Defer mount work so the initial HTML and first browser render match.
    timer = setTimeout(() => { if (document.visibilityState === 'visible') void load(); else schedule(); }, 0);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      inflight?.abort();
      if (timer) clearTimeout(timer);
      if (timeout) clearTimeout(timeout);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisibility);
      refreshRef.current = () => {};
    };
  }, []);

  return {...state, now, notifications, setNotifications, refresh, dismissNew};
}
