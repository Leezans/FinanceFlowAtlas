/** Source statements and published schedules, never independently corroborated news or forecasts. */
export type NewsCategory = 'technology' | 'geopolitics' | 'finance';

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  category: NewsCategory;
  /** Publisher/topic context, not an estimate of economic impact. */
  regions: string[];
  /** Existing FinanceFlowAtlas catalog keys; navigation context only. */
  relatedMarkets: string[];
  publishedAt: string | null;
  publishedDate: string | null;
  publicationTimeKind: 'published' | 'updated' | 'unknown';
  /** RSS publication is not proof of when the reported event happened. */
  occurredAt: null;
  summary: string | null;
}

export interface ScheduledEvent {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  category: NewsCategory;
  regions: string[];
  relatedMarkets: string[];
  startsAt: string | null;
  startDate: string;
  timeZone: string | null;
  allDay: boolean;
  endsAt: string | null;
  /** Exclusive end date for date-only ICS events. */
  endDate: string | null;
  status: 'scheduled' | 'cancelled' | 'tentative';
  publishedAt: string | null;
}

export interface NewsSourceStatus {
  id: string;
  name: string;
  kind: 'news' | 'events';
  url: string;
  websiteUrl: string;
  termsUrl: string;
  license: string;
  category: NewsCategory;
  status: 'ok' | 'stale' | 'error';
  /** Retrieval time, not source publication or event occurrence. */
  fetchedAt: string | null;
  lastAttemptAt: string;
  nextRefreshAt: string | null;
  halted: boolean;
  error: string | null;
  warnings: string[];
  itemCount: number;
  attribution: string;
}

export interface NewsSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  status: 'ok' | 'partial' | 'unavailable';
  news: NewsItem[];
  events: ScheduledEvent[];
  sources: NewsSourceStatus[];
  cacheTtlSeconds: number;
  maxStaleSeconds: number;
  dedup: { newsRemoved: number; eventsRemoved: number; method: string };
  disclaimer: string;
}
