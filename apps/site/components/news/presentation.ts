import {evidenceSources} from '@/lib/catalog/sources';
import type {NewsCategory, NewsItem, NewsSnapshot, ScheduledEvent} from '@/lib/news/types';

export const categoryLabels: Record<NewsCategory, string> = {
  technology: '科技', geopolitics: '地缘政治', finance: '金融', official: '政务综合',
};
export const DISPLAY_TIME_ZONE = 'Asia/Shanghai';
export const NEWS_REFRESH_MS = 5 * 60 * 1000;
export const BROWSER_RETENTION_MS = 24 * 60 * 60 * 1000;
export const NEWS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export function formatTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

export function calendarDate(now: number, timeZone: string | null = DISPLAY_TIME_ZONE): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {timeZone: timeZone || DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now));
  } catch {
    return calendarDate(now, 'UTC');
  }
}

export function isUpcoming(event: ScheduledEvent, now: number): boolean {
  if (event.startsAt) return Date.parse(event.startsAt) >= now;
  return event.startDate >= calendarDate(now, event.timeZone || 'UTC');
}

/** Reapply the reading window even when the browser only has a retained snapshot. */
export function isRecentPublication(item: NewsItem, now: number): boolean {
  if (item.publishedAt) {
    const published = Date.parse(item.publishedAt);
    return Number.isFinite(published) && published >= now - NEWS_LOOKBACK_MS && published <= now;
  }
  if (item.publishedDate) {
    // A date-only source does not establish an instant or a timezone. Compare
    // calendar dates in UTC, matching the API's disclosed day-level policy.
    return item.publishedDate >= calendarDate(now - NEWS_LOOKBACK_MS, 'UTC') && item.publishedDate <= calendarDate(now, 'UTC');
  }
  return true;
}

export function publicationLabel(item: NewsItem): string {
  const label = item.publicationTimeKind === 'updated' ? '来源更新时间' : '来源发布时间';
  if (item.publishedAt) return `${label}：${formatTime(item.publishedAt)}（北京时间）`;
  if (item.publishedDate) return `${label}：${item.publishedDate}（仅日期，时刻 / 时区未提供）`;
  return '来源发布时间：未知';
}

export function eventTimeLabel(event: ScheduledEvent): string {
  if (event.startsAt) return `${formatTime(event.startsAt)}（北京时间）`;
  return `${event.startDate}（来源日期${event.allDay ? ' · 全天' : ' · 具体时刻未提供'}）`;
}

export function relatedMarketLinks(ids: string[]) {
  return evidenceSources.filter(source => ids.includes(source.id));
}

/** Expiry follows original source acquisition, never the latest browser request. */
export function visibleSnapshot(snapshot: NewsSnapshot, now: number) {
  const retention = Math.min(BROWSER_RETENTION_MS, snapshot.maxStaleSeconds * 1000);
  const available = new Set(snapshot.sources.filter(source => source.status !== 'error' && !source.halted && source.fetchedAt && now - Date.parse(source.fetchedAt) <= retention).map(source => source.id));
  return {
    news: snapshot.news.filter(item => available.has(item.sourceId) && isRecentPublication(item, now)),
    events: snapshot.events.filter(item => available.has(item.sourceId) && isUpcoming(item, now)),
  };
}
