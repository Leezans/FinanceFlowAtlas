import { NEWS_SOURCES, assertAllowedSource, type NewsSource } from './sources';
import { parseNewsFeed, MAX_DOCUMENT_BYTES } from './xml';
import { dateInZone, parseCalendar } from './calendar';
import type { NewsItem, NewsSnapshot, NewsSourceStatus, ScheduledEvent } from './types';
import { SourceGateError } from '../ashare/source-gate';
import { D1NewsGate, NEWS_REFRESH_MS, NEWS_MAX_STALE_MS as MAX_STALE_MS, type NewsGate, type NewsGateState, type NewsLease, type NewsOutcome } from './source-gate';

export const NEWS_CACHE_TTL_MS = NEWS_REFRESH_MS;
export const NEWS_MAX_STALE_MS = MAX_STALE_MS;
export const NEWS_FETCH_TIMEOUT_MS = 8000;
const NEWS_LOOKBACK_MS = 30 * 86400000;
const EVENT_HORIZON_MS = 90 * 86400000;
const MAX_ITEMS_PER_SOURCE = 60;

interface SourceCache {
  observedAt: number;
  news: NewsItem[];
  events: ScheduledEvent[];
  warnings: string[];
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  error: string | null;
  halted: boolean;
}
class SourceFailure extends Error {
  constructor(message: string, readonly halted = false, readonly retryAfterMs = 0, readonly retryAtMs = 0) { super(message); }
}
function retryAfter(value: string | null): { retryAfterMs: number; retryAtMs: number } {
  if (!value) return { retryAfterMs: 0, retryAtMs: 0 };
  if (/^\d+$/.test(value.trim())) return { retryAfterMs: Math.min(Number(value) * 1000, 8.64e15 - 1), retryAtMs: 0 };
  const parsed = Date.parse(value);
  return { retryAfterMs: 0, retryAtMs: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 };
}
function discardBody(response: Response): void {
  // A broken or hanging stream must not change a known denial into a retry.
  try { void response.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
}
async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) { discardBody(response); throw new SourceFailure('来源请求超时。'); }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_DOCUMENT_BYTES) { discardBody(response); throw new SourceFailure('来源响应超过 1 MiB 限制。'); }
  if (!response.body) throw new SourceFailure('来源返回空响应。');
  const reader = response.body.getReader();
  const cancel = () => { try { void reader.cancel().catch(() => undefined); } catch { /* best effort */ } };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new SourceFailure('来源响应超时。');
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOCUMENT_BYTES) { void reader.cancel().catch(() => undefined); throw new SourceFailure('来源响应超过 1 MiB 限制。'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const buffer = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { buffer.set(chunk, cursor); cursor += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new SourceFailure('来源不是有效 UTF-8 文本。'); }
}

/** Shared primary-D1 admission is mandatory, including before serving cached data. */
export class NewsService {
  private readonly inflight = new Map<string, Promise<SourceCache>>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly clock: () => Date = () => new Date(),
    private readonly gate: NewsGate = new D1NewsGate(undefined)) {}

  private unavailable(now: number, error: string, halted = false, attemptedAt: number | null = null): SourceCache {
    return { observedAt: now, news: [], events: [], warnings: [], fetchedAt: null, lastAttemptAt: attemptedAt, nextAttemptAt: null, error, halted };
  }
  private decodeState(source: NewsSource, state: NewsGateState): SourceCache {
    if (state.state === 'blocked') return this.unavailable(state.nowMs, state.error ?? '来源已停止；共享许可状态禁止自动重试。', true, state.attemptedAt || null);
    if (state.state === 'busy') return this.unavailable(state.nowMs, '共享来源请求进行中或结果未确认；不接管请求，也不展示旧数据。', false, state.attemptedAt || null);
    const parsed = state.snapshot ? source.kind === 'events'
      ? { news: [], ...parseCalendar(state.snapshot.document, source) }
      : { events: [], ...parseNewsFeed(state.snapshot.document, source) }
      : { news: [], events: [], warnings: [] };
    return { ...parsed, observedAt: state.nowMs, fetchedAt: state.snapshot?.fetchedAt ?? null, lastAttemptAt: state.attemptedAt || null,
      nextAttemptAt: state.retryAt, error: state.error, halted: false };
  }
  private async acquire(source: NewsSource, now: number): Promise<SourceCache> {
    assertAllowedSource(source);
    const pending = this.inflight.get(source.id);
    if (pending) return pending;
    const operation = this.acquireShared(source, now);
    this.inflight.set(source.id, operation);
    try { return await operation; }
    finally { this.inflight.delete(source.id); }
  }
  private async acquireShared(source: NewsSource, now: number): Promise<SourceCache> {
    try {
      // Always inspect shared state, even when a previous request populated cache.
      // A bad persisted document is unknown permission/data state, not a reason to fetch.
      const shared = await this.gate.inspect(source);
      const cached = this.decodeState(source, shared);
      if (shared.state !== 'idle' || shared.retryAt > shared.nowMs) return cached;
      let lease: NewsLease;
      try { lease = await this.gate.acquire(source); }
      catch (error) {
        if (error instanceof SourceGateError && error.code === 'source_denied') return this.unavailable(now, '来源已停止；共享许可状态禁止自动重试。', true);
        if (error instanceof SourceGateError && error.code === 'source_busy') return this.unavailable(now, '共享来源请求进行中或结果未确认；不接管请求，也不展示旧数据。');
        if (error instanceof SourceGateError && error.code === 'source_cooldown') return this.decodeState(source, await this.gate.inspect(source));
        // Uncertain acquisition is never retried; it may already hold a durable lease.
        throw error;
      }
      return await this.refresh(source, lease);
    } catch {
      return this.unavailable(now, '共享来源许可或缓存状态不可用；未请求上游，也不展示旧数据。请检查 DB 与新闻迁移。');
    }
  }

  private async refresh(source: NewsSource, lease: NewsLease): Promise<SourceCache> {
    const now = this.clock().getTime();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new SourceFailure('来源请求超时；未获取新的证据。'));
      }, NEWS_FETCH_TIMEOUT_MS);
    });
    let outcome: NewsOutcome;
    try {
      const operation = (async () => {
        const response = await this.fetcher(source.url, {
          redirect: 'manual', signal: controller.signal, cache: 'no-store',
          headers: {
            Accept: source.format === 'ics' ? 'text/calendar' : 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            'User-Agent': 'FinanceFlowAtlas/1.0 (+https://github.com/Leezans/FinanceFlowAtlas)',
          },
        });
        if (timedOut) { discardBody(response); throw new SourceFailure('来源请求超时；共享请求保持未确认。'); }
        if ([401, 403, 451].includes(response.status) || (response.status >= 300 && response.status < 400)) {
          discardBody(response);
          throw new SourceFailure(`来源拒绝访问或要求重定向（HTTP ${response.status}）；已停止自动重试并提交共享许可状态。`, true);
        }
        if (!response.ok) {
          const retry = response.status === 429 || response.status === 503 ? retryAfter(response.headers.get('retry-after')) : { retryAfterMs: 0, retryAtMs: 0 };
          discardBody(response);
          throw new SourceFailure(`来源暂时不可用（HTTP ${response.status}）。`, false, retry.retryAfterMs, retry.retryAtMs);
        }
        const body = await readBounded(response, controller.signal);
        if (timedOut) throw new SourceFailure('来源响应超时；共享请求保持未确认。');
        const isHtml = /text\/html/i.test(response.headers.get('content-type') ?? '') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);
        if (isHtml && /(?:access denied|forbidden|captcha|verify (?:you|your)|checking your browser|just a moment|challenge-platform)/i.test(body)) {
          throw new SourceFailure('来源返回访问验证页面；已停止自动重试并提交共享许可状态，不绕过验证。', true);
        }
        if (isHtml) throw new SourceFailure('来源返回网页，未返回预期的 RSS/Atom/日历数据。');
        if (source.kind === 'events') {
          const parsed = parseCalendar(body, source);
          void parsed;
          return body;
        }
        const parsed = parseNewsFeed(body, source);
        void parsed;
        return body;
      })();
      const document = await Promise.race([operation, timeout]);
      // The confirmed atomic release publishes cache and next deadline together.
      // Do not include this write in the catch that classifies upstream failures.
      outcome = { kind: 'success', document };
    } catch (error) {
      const failure = error instanceof SourceFailure ? error : new SourceFailure(
        error instanceof Error && /(?:XML|RSS|feed|calendar|Calendar|Feed|Unexpected|DTD|event|entry|entries)/i.test(error.message)
          ? `来源格式校验失败：${error.message.slice(0, 140)}` : '来源连接失败；未获取新的证据。',
      );
      outcome = failure.halted ? { kind: 'denied', error: failure.message }
        : { kind: 'temporary_failure', error: failure.message, retryAfterMs: failure.retryAfterMs, retryAtMs: failure.retryAtMs };
    } finally { if (timer) clearTimeout(timer); }
    // Abort is not proof that a fetch/body has stopped. Never reopen admission
    // while a late response could still reveal denial or continue consuming data.
    if (timedOut) return this.unavailable(now, '来源请求超时；共享请求保持未确认，不自动接管或重试。');
    // A failed/uncertain release leaves the durable lease busy. Never attempt a
    // second release, resume fetching, or publish unconfirmed data from memory.
    try { return this.decodeState(source, await this.gate.release(source, lease, outcome)); }
    catch { return this.unavailable(now, '共享来源完成状态未确认；不会重试写入、重取上游或展示未确认数据。'); }
  }

  async snapshot(): Promise<NewsSnapshot> {
    const states = await Promise.all(NEWS_SOURCES.map((source) => this.acquire(source, this.clock().getTime())));
    const now = this.clock();
    const nowMs = now.getTime();
    const horizon = new Date(nowMs + EVENT_HORIZON_MS);
    const news: NewsItem[] = [];
    const events: ScheduledEvent[] = [];
    const sources: NewsSourceStatus[] = [];
    const seenNews = new Set<string>();
    const seenEvents = new Set<string>();
    let newsRemoved = 0;
    let eventsRemoved = 0;
    for (let i = 0; i < NEWS_SOURCES.length; i++) {
      const source = NEWS_SOURCES[i];
      const state = states[i];
      const usable = !state.halted && state.fetchedAt !== null && state.observedAt - state.fetchedAt <= NEWS_MAX_STALE_MS;
      const sourceNews = usable ? state.news.filter((item) => {
        if (item.publishedAt) {
          const when = Date.parse(item.publishedAt);
          return when >= nowMs - NEWS_LOOKBACK_MS && when <= nowMs;
        }
        // Keep date-only precision; use an inclusive UTC calendar window.
        return !item.publishedDate || (item.publishedDate >= new Date(nowMs - NEWS_LOOKBACK_MS).toISOString().slice(0, 10) && item.publishedDate <= now.toISOString().slice(0, 10));
      }).sort((a, b) => (b.publishedAt ?? b.publishedDate ?? '').localeCompare(a.publishedAt ?? a.publishedDate ?? '')) : [];
      const sourceEvents = usable ? state.events.filter((event) => {
        if (event.startsAt) return Date.parse(event.startsAt) >= nowMs && Date.parse(event.startsAt) <= horizon.getTime();
        return event.allDay && event.startDate >= dateInZone(now, event.timeZone) && event.startDate <= dateInZone(horizon, event.timeZone);
      }).sort((a, b) => (a.startsAt ?? a.startDate).localeCompare(b.startsAt ?? b.startDate)) : [];
      let accepted = 0;
      for (const item of sourceNews) {
        if (seenNews.has(item.url)) { newsRemoved++; continue; }
        if (accepted >= MAX_ITEMS_PER_SOURCE) break;
        seenNews.add(item.url); news.push(item); accepted++;
      }
      for (const event of sourceEvents) {
        const identity = `${event.url}|${event.id}|${event.startsAt ?? event.startDate}`;
        if (seenEvents.has(identity)) { eventsRemoved++; continue; }
        if (accepted >= MAX_ITEMS_PER_SOURCE) break;
        seenEvents.add(identity); events.push(event); accepted++;
      }
      sources.push({
        id: source.id, name: source.name, kind: source.kind, url: source.url, websiteUrl: source.websiteUrl,
        termsUrl: source.termsUrl, license: source.license, category: source.category, attribution: source.attribution,
        status: usable ? (state.error ? 'stale' : 'ok') : 'error',
        fetchedAt: state.fetchedAt === null ? null : new Date(state.fetchedAt).toISOString(),
        lastAttemptAt: state.lastAttemptAt === null ? null : new Date(state.lastAttemptAt).toISOString(),
        nextRefreshAt: state.nextAttemptAt === null ? null : new Date(state.nextAttemptAt).toISOString(),
        error: state.error ?? (usable ? null : '缓存已过期，等待下一次允许的来源请求。'),
        halted: state.halted, warnings: state.warnings, itemCount: accepted,
      });
    }
    news.sort((a, b) => (b.publishedAt ?? b.publishedDate ?? '').localeCompare(a.publishedAt ?? a.publishedDate ?? '') || a.id.localeCompare(b.id));
    events.sort((a, b) => (a.startsAt ?? a.startDate).localeCompare(b.startsAt ?? b.startDate) || a.id.localeCompare(b.id));
    return {
      schemaVersion: 1, generatedAt: now.toISOString(),
      status: sources.every((source) => source.status === 'error') ? 'unavailable' : sources.some((source) => source.status !== 'ok' || source.warnings.length) ? 'partial' : 'ok',
      news, events, sources, cacheTtlSeconds: NEWS_CACHE_TTL_MS / 1000, maxStaleSeconds: NEWS_MAX_STALE_MS / 1000,
      dedup: { newsRemoved, eventsRemoved, method: 'canonical-url; events additionally use identity and start' },
      disclaimer: '仅接入美国、英国、中国香港及欧洲央行的六个精选官方来源，非全球全面报道。香港政务综合含日常发布，不代表中国内地或亚洲全面覆盖，也不自动判断事件重要性。官方表述不等于独立核实；同链接去重不等于多源证实。分类、地区及市场关联仅为检索导航，不构成因果判断、价格预测或投资建议。新闻时间是发布/更新日期，事件发生时间未知；日程来自官方日历并可能调整，不代表事件已发生。按请求更新，无后台采集或提醒。',
    };
  }
}
