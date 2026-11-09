import {describe, expect, it} from 'vitest';
import {parseNewsSnapshot} from '../components/news/client';
import {calendarDate, eventTimeLabel, formatTime, isRecentPublication, isUpcoming, NEWS_LOOKBACK_MS, publicationLabel, visibleSnapshot} from '../components/news/presentation';
import {NEWS_UI_NOW, newsUiEvent, newsUiItem, newsUiSnapshot} from './news-ui-fixture';

describe('news response boundary', () => {
  it('accepts the shared contract without silently changing timestamps', () => {
    const snapshot = newsUiSnapshot(); expect(parseNewsSnapshot(snapshot)).toBe(snapshot);
  });
  it.each(['warnings', 'halted', 'nextRefreshAt'])('rejects missing source %s read by the UI', field => {
    const snapshot = newsUiSnapshot(); delete (snapshot.sources[0] as unknown as Record<string, unknown>)[field]; expect(parseNewsSnapshot(snapshot)).toBeNull();
  });
  it.each(['dedup', 'cacheTtlSeconds', 'maxStaleSeconds'])('rejects missing top-level %s read by the UI', field => {
    const snapshot = newsUiSnapshot(); delete (snapshot as unknown as Record<string, unknown>)[field]; expect(parseNewsSnapshot(snapshot)).toBeNull();
  });
  it.each(['javascript:alert(1)', 'http://example.invalid/story', 'https://name:password@example.invalid/story'])('rejects unsafe source link %s', url => {
    const snapshot = newsUiSnapshot(); snapshot.news[0].url = url; expect(parseNewsSnapshot(snapshot)).toBeNull();
  });
  it('rejects rollover dates, source-less rows and duplicate ids', () => {
    const snapshot = newsUiSnapshot(); snapshot.events[0].startDate = '2026-02-30'; expect(parseNewsSnapshot(snapshot)).toBeNull();
    const rollover = newsUiSnapshot(); rollover.news[0].publishedAt = '2026-02-30T12:00:00Z'; expect(parseNewsSnapshot(rollover)).toBeNull();
    const sourceLess = newsUiSnapshot(); sourceLess.news[0].sourceId = 'missing'; expect(parseNewsSnapshot(sourceLess)).toBeNull();
    const duplicate = newsUiSnapshot(); duplicate.news.push({...duplicate.news[0]}); expect(parseNewsSnapshot(duplicate)).toBeNull();
  });
  it('rejects invalid status data and missing timezone on a timestamp', () => {
    const snapshot = newsUiSnapshot(); snapshot.status = 'unavailable'; expect(parseNewsSnapshot(snapshot)).toBeNull();
    const local = newsUiSnapshot(); local.news[0].publishedAt = '2026-11-09T12:30:00'; expect(parseNewsSnapshot(local)).toBeNull();
  });
});

describe('honest news and schedule time presentation', () => {
  it('converts instants to Shanghai, preserves original dates and distinguishes update time', () => {
    expect(formatTime('2026-11-08T23:30:00Z')).toBe('2026/11/09 07:30');
    expect(formatTime(null)).toBe('未知');
    expect(publicationLabel(newsUiItem({publishedAt: null, publishedDate: '2026-11-08'}))).toBe('来源发布时间：2026-11-08（仅日期，时刻 / 时区未提供）');
    expect(publicationLabel(newsUiItem({publicationTimeKind: 'updated'}))).toContain('来源更新时间');
    expect(eventTimeLabel(newsUiEvent({startsAt: null, startDate: '2026-11-10', allDay: true}))).toBe('2026-11-10（来源日期 · 全天）');
  });
  it('filters instants and day-only schedules using the source timezone, not guessed Shanghai dates', () => {
    const midnightShanghai = Date.parse('2026-11-09T17:00:00Z');
    expect(calendarDate(midnightShanghai)).toBe('2026-11-10');
    expect(isUpcoming(newsUiEvent({startsAt: '2026-11-09T16:00:00Z'}), midnightShanghai)).toBe(false);
    expect(isUpcoming(newsUiEvent({startsAt: null, startDate: '2026-11-09', timeZone: 'America/New_York'}), midnightShanghai)).toBe(true);
    expect(isUpcoming(newsUiEvent({startsAt: null, startDate: '2026-11-09', timeZone: null}), midnightShanghai)).toBe(true);
  });
  it('uses an exact inclusive 30-day window for known publication and update instants', () => {
    const itemAt = (when: number) => newsUiItem({publishedAt: new Date(when).toISOString()});
    expect(isRecentPublication(itemAt(NEWS_UI_NOW - NEWS_LOOKBACK_MS), NEWS_UI_NOW)).toBe(true);
    expect(isRecentPublication(itemAt(NEWS_UI_NOW - NEWS_LOOKBACK_MS - 1), NEWS_UI_NOW)).toBe(false);
    expect(isRecentPublication(itemAt(NEWS_UI_NOW), NEWS_UI_NOW)).toBe(true);
    expect(isRecentPublication(itemAt(NEWS_UI_NOW + 1), NEWS_UI_NOW)).toBe(false);
    expect(isRecentPublication(newsUiItem({publicationTimeKind: 'updated', publishedAt: new Date(NEWS_UI_NOW - NEWS_LOOKBACK_MS - 1).toISOString()}), NEWS_UI_NOW)).toBe(false);
  });
  it('keeps date-only precision and rolls the 30-day window by UTC calendar date', () => {
    const lateUtc = Date.parse('2026-11-09T23:59:59Z'); // Already November 10 in Shanghai.
    const dated = (publishedDate: string) => newsUiItem({publishedAt: null, publishedDate});
    expect(isRecentPublication(dated('2026-10-10'), lateUtc)).toBe(true);
    expect(isRecentPublication(dated('2026-10-09'), lateUtc)).toBe(false);
    expect(isRecentPublication(dated('2026-11-09'), lateUtc)).toBe(true);
    expect(isRecentPublication(dated('2026-11-10'), lateUtc)).toBe(false);
    expect(isRecentPublication(dated('2026-10-10'), lateUtc + 1000)).toBe(false);
    expect(isRecentPublication(dated('2026-11-10'), lateUtc + 1000)).toBe(true);
    expect(publicationLabel(dated('2026-10-10'))).toBe('来源发布时间：2026-10-10（仅日期，时刻 / 时区未提供）');
  });
  it('retains explicitly unknown publication dates while hiding aged or future instants', () => {
    const snapshot = newsUiSnapshot();
    snapshot.news[0].publishedAt = new Date(NEWS_UI_NOW - NEWS_LOOKBACK_MS - 1).toISOString();
    snapshot.news[2].publishedAt = new Date(NEWS_UI_NOW + 1).toISOString();
    const visible = visibleSnapshot(snapshot, NEWS_UI_NOW);
    expect(visible.news.map(item => item.id)).toEqual(['geo-1']);
    expect(publicationLabel(visible.news[0])).toBe('来源发布时间：未知');
    expect(snapshot.sources[0].fetchedAt).toBe(new Date(NEWS_UI_NOW).toISOString());
  });
  it('enforces original source expiry, shorter server retention and source denial', () => {
    const snapshot = newsUiSnapshot(); snapshot.maxStaleSeconds = 60;
    expect(visibleSnapshot(snapshot, NEWS_UI_NOW + 60_001).news).toHaveLength(0);
    snapshot.generatedAt = new Date(NEWS_UI_NOW + 60_001).toISOString();
    expect(visibleSnapshot(snapshot, NEWS_UI_NOW + 60_001).news).toHaveLength(0);
    snapshot.sources[0].halted = true; expect(visibleSnapshot(snapshot, NEWS_UI_NOW).news).toHaveLength(2);
  });
});
