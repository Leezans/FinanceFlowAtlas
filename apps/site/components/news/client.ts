import type {NewsSnapshot} from '@/lib/news/types';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown) => value === null || text(value);
const timestamp = (value: unknown) => value === null || (text(value) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && date(value.slice(0, 10)));
const date = (value: unknown) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const texts = (value: unknown) => Array.isArray(value) && value.every(text);
const category = (value: unknown) => ['technology', 'geopolitics', 'finance', 'official'].includes(value as string);
const webUrl = (value: unknown) => {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
const commonItem = (value: Record<string, unknown>) => text(value.id) && text(value.title) && webUrl(value.url) && text(value.sourceId) && text(value.sourceName) && category(value.category) && texts(value.regions) && texts(value.relatedMarkets);

/** Reject malformed or unsafe success responses before putting them in the reading view. */
export function parseNewsSnapshot(value: unknown): NewsSnapshot | null {
  if (!object(value) || value.schemaVersion !== 1 || !timestamp(value.generatedAt) || value.generatedAt === null || !['ok', 'partial', 'unavailable'].includes(value.status as string) || !text(value.disclaimer) || !Array.isArray(value.sources) || !Array.isArray(value.news) || !Array.isArray(value.events)) return null;
  if (typeof value.cacheTtlSeconds !== 'number' || !Number.isFinite(value.cacheTtlSeconds) || value.cacheTtlSeconds < 60 || typeof value.maxStaleSeconds !== 'number' || !Number.isFinite(value.maxStaleSeconds) || value.maxStaleSeconds <= 0 || !object(value.dedup) || !Number.isInteger(value.dedup.newsRemoved) || Number(value.dedup.newsRemoved) < 0 || !Number.isInteger(value.dedup.eventsRemoved) || Number(value.dedup.eventsRemoved) < 0 || !text(value.dedup.method)) return null;
  if (value.status === 'unavailable' && (value.news.length || value.events.length)) return null;
  if (value.news.length > 2000 || value.events.length > 2000 || value.sources.length > 100) return null;
  if (!value.sources.every(source => object(source) && text(source.id) && text(source.name) && ['news', 'events'].includes(source.kind as string) && webUrl(source.url) && webUrl(source.websiteUrl) && webUrl(source.termsUrl) && text(source.license) && category(source.category) && ['ok', 'stale', 'error'].includes(source.status as string) && timestamp(source.fetchedAt) && timestamp(source.lastAttemptAt) && timestamp(source.nextRefreshAt) && typeof source.halted === 'boolean' && texts(source.warnings) && nullableText(source.error) && typeof source.itemCount === 'number' && Number.isInteger(source.itemCount) && source.itemCount >= 0 && text(source.attribution))) return null;
  const sourceIds = new Set(value.sources.map(source => source.id));
  if (sourceIds.size !== value.sources.length || new Set(value.news.map(item => object(item) ? item.id : null)).size !== value.news.length || new Set(value.events.map(item => object(item) ? item.id : null)).size !== value.events.length) return null;
  if (!value.news.every(item => object(item) && commonItem(item) && sourceIds.has(item.sourceId) && timestamp(item.publishedAt) && (item.publishedDate === null || date(item.publishedDate)) && ['published', 'updated', 'unknown'].includes(item.publicationTimeKind as string) && item.occurredAt === null && nullableText(item.summary))) return null;
  if (!value.events.every(item => object(item) && commonItem(item) && sourceIds.has(item.sourceId) && timestamp(item.startsAt) && date(item.startDate) && nullableText(item.timeZone) && typeof item.allDay === 'boolean' && timestamp(item.endsAt) && (item.endDate === null || date(item.endDate)) && ['scheduled', 'cancelled', 'tentative'].includes(item.status as string) && timestamp(item.publishedAt))) return null;
  return value as unknown as NewsSnapshot;
}
