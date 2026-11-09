import { NEWS_SOURCES, assertAllowedSource, type NewsSource } from './sources';
import { parseNewsFeed, MAX_DOCUMENT_BYTES } from './xml';
import { dateInZone, parseCalendar } from './calendar';
import type { NewsItem, NewsSnapshot, NewsSourceStatus, ScheduledEvent } from './types';

export const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;
export const NEWS_MAX_STALE_MS = 24 * 60 * 60 * 1000;
export const NEWS_FETCH_TIMEOUT_MS = 8000;
const NEWS_LOOKBACK_MS = 30 * 86400000;
const EVENT_HORIZON_MS = 90 * 86400000;
const MAX_ITEMS_PER_SOURCE = 60;

interface SourceCache {
  news: NewsItem[];
  events: ScheduledEvent[];
  warnings: string[];
  fetchedAt: number | null;
  lastAttemptAt: number;
  nextAttemptAt: number | null;
  error: string | null;
  halted: boolean;
}
class SourceFailure extends Error {
  constructor(message: string, readonly halted = false, readonly retryAfterMs = 0) { super(message); }
}
function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) return Math.min(Number(value) * 1000, 8.64e15 - now - 1);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : 0;
}
function discardBody(response: Response): void {
  // A broken or hanging stream must not change a known denial into a retry.
  try { void response.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
}
async function readBounded(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_DOCUMENT_BYTES) { discardBody(response); throw new SourceFailure('来源响应超过 1 MiB 限制。'); }
  if (!response.body) throw new SourceFailure('来源返回空响应。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOCUMENT_BYTES) { void reader.cancel().catch(() => undefined); throw new SourceFailure('来源响应超过 1 MiB 限制。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { buffer.set(chunk, cursor); cursor += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new SourceFailure('来源不是有效 UTF-8 文本。'); }
}

/** Per-isolate cache only: not a deployment-wide gate, archive or background collector. */
export class NewsService {
  private readonly cache = new Map<string, SourceCache>();
  private readonly inflight = new Map<string, Promise<SourceCache>>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly clock: () => Date = () => new Date()) {}

  private async acquire(source: NewsSource, now: number): Promise<SourceCache> {
    assertAllowedSource(source);
    const previous = this.cache.get(source.id);
    if (previous && (previous.halted || (previous.nextAttemptAt !== null && now < previous.nextAttemptAt))) return previous;
    const pending = this.inflight.get(source.id);
    if (pending) return pending;
    const operation = this.refresh(source, now, previous);
    this.inflight.set(source.id, operation);
    try { return await operation; }
    finally { this.inflight.delete(source.id); }
  }

  private async refresh(source: NewsSource, now: number, previous: SourceCache | undefined): Promise<SourceCache> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SourceFailure('来源请求超时；未获取新的证据。'));
      }, NEWS_FETCH_TIMEOUT_MS);
    });
    try {
      const operation = (async () => {
        const response = await this.fetcher(source.url, {
          redirect: 'manual', signal: controller.signal, cache: 'no-store',
          headers: {
            Accept: source.format === 'ics' ? 'text/calendar' : 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            'User-Agent': 'FinanceFlowAtlas/1.0 (+https://github.com/Leezans/FinanceFlowAtlas)',
          },
        });
        if ([401, 403, 451].includes(response.status) || (response.status >= 300 && response.status < 400)) {
          discardBody(response);
          throw new SourceFailure(`来源拒绝访问或要求重定向（HTTP ${response.status}）；本运行实例已停止自动重试。`, true);
        }
        if (!response.ok) {
          const retry = response.status === 429 || response.status === 503 ? retryAfterMs(response.headers.get('retry-after'), now) : 0;
          discardBody(response);
          throw new SourceFailure(`来源暂时不可用（HTTP ${response.status}）。`, false, retry);
        }
        const body = await readBounded(response);
        const isHtml = /text\/html/i.test(response.headers.get('content-type') ?? '') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);
        if (isHtml && /(?:access denied|forbidden|captcha|verify (?:you|your)|checking your browser|just a moment|challenge-platform)/i.test(body)) {
          throw new SourceFailure('来源返回访问验证页面；本运行实例已停止自动重试，不绕过验证。', true);
        }
        if (isHtml) throw new SourceFailure('来源返回网页，未返回预期的 RSS/Atom/日历数据。');
        if (source.kind === 'events') {
          const parsed = parseCalendar(body, source);
          return { news: [], events: parsed.events, warnings: parsed.warnings };
        }
        const parsed = parseNewsFeed(body, source);
        return { news: parsed.news, events: [], warnings: parsed.warnings };
      })();
      const parsed = await Promise.race([operation, timeout]);
      const fetchedAt = this.clock().getTime();
      const state: SourceCache = { ...parsed, fetchedAt, lastAttemptAt: now, nextAttemptAt: fetchedAt + NEWS_CACHE_TTL_MS, error: null, halted: false };
      this.cache.set(source.id, state);
      return state;
    } catch (error) {
      const failure = error instanceof SourceFailure ? error : new SourceFailure(
        error instanceof Error && /(?:XML|RSS|feed|calendar|Calendar|Feed|Unexpected|DTD|event|entry|entries)/i.test(error.message)
          ? `来源格式校验失败：${error.message.slice(0, 140)}` : '来源连接失败；未获取新的证据。',
      );
      const reusable = previous && !failure.halted && previous.fetchedAt !== null && now - previous.fetchedAt <= NEWS_MAX_STALE_MS;
      const state: SourceCache = {
        news: reusable ? previous.news : [], events: reusable ? previous.events : [], warnings: reusable ? previous.warnings : [],
        fetchedAt: reusable ? previous.fetchedAt : null, lastAttemptAt: now,
        nextAttemptAt: failure.halted ? null : Math.min(8.64e15 - 1, now + Math.max(NEWS_CACHE_TTL_MS, failure.retryAfterMs)),
        error: failure.message, halted: failure.halted,
      };
      this.cache.set(source.id, state);
      return state;
    } finally { if (timer) clearTimeout(timer); }
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
      const usable = !state.halted && state.fetchedAt !== null && nowMs - state.fetchedAt <= NEWS_MAX_STALE_MS;
      const sourceNews = usable ? state.news.filter((item) => {
        const when = item.publishedAt ? Date.parse(item.publishedAt) : item.publishedDate ? Date.parse(`${item.publishedDate}T00:00:00Z`) : null;
        return when === null || (when >= nowMs - NEWS_LOOKBACK_MS && when <= nowMs);
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
        lastAttemptAt: new Date(state.lastAttemptAt).toISOString(),
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
      disclaimer: '仅汇集所列英美官方来源，非全球全面报道。官方表述不等于独立核实；同链接去重不等于多源证实。分类、地区及市场关联仅为检索导航，不构成因果判断、价格预测或投资建议。新闻时间是发布/更新日期，事件发生时间未知；日程来自官方日历并可能调整，不代表事件已发生。按请求更新，无后台采集或提醒。',
    };
  }
}
const newsService = new NewsService();
export function loadNewsSnapshot(): Promise<NewsSnapshot> { return newsService.snapshot(); }
