import { describe, expect, it } from 'vitest';
import { parseNewsFeed } from '@/lib/news/xml';
import { parseCalendar, parseCalendarDate } from '@/lib/news/calendar';
import { canonicalUrl, plainText, publicationDate } from '@/lib/news/normalize';
import { NEWS_SOURCES, assertAllowedSource } from '@/lib/news/sources';
import { atom, calendar, rss, rssItem, vevent } from './news-ingestion-fixture';
const fed = NEWS_SOURCES[0];
const fcdo = NEWS_SOURCES[2];
const bls = NEWS_SOURCES[3];

describe('news RSS/Atom evidence contract', () => {
  it('separates publication, update and unknown occurrence; strips markup', () => {
    const item = parseNewsFeed(rss(), fed).news[0];
    expect(item.publishedAt).toBe('2026-11-08T13:30:00.000Z');
    expect(item.publicationTimeKind).toBe('published');
    expect(item.occurredAt).toBeNull();
    expect(item.summary).toBe('Fixture only, not real news.');
    const updated = parseNewsFeed(atom(), fcdo).news[0];
    expect(updated.publicationTimeKind).toBe('updated');
    expect(updated.summary).toBe('Fixture only');
  });
  it('does not infer publication from acquisition or floating local dates', () => {
    const item = parseNewsFeed(rss(rssItem(undefined, '2026-11-08T08:30:00')), fed).news[0];
    expect(item.publishedAt).toBeNull();
    expect(item.publicationTimeKind).toBe('unknown');
    expect(publicationDate('2026-11-08')).toEqual({ instant: null, date: '2026-11-08' });
    expect(publicationDate('2026-02-30T12:00:00Z').instant).toBeNull();
    expect(publicationDate('Mon, 30 Feb 2026 12:00:00 GMT').instant).toBeNull();
    expect(publicationDate('2026-11-08T24:00:00Z').instant).toBeNull();
  });
  it('parses namespace-qualified Dublin Core dates and CDATA titles', () => {
    const xml = rss(rssItem().replace('<pubDate>', '<dc:date>').replace('</pubDate>', '</dc:date>')).replace('<rss ', '<rss xmlns:dc="http://purl.org/dc/elements/1.1/" ');
    expect(parseNewsFeed(xml, fed).news[0].publishedAt).toBeTruthy();
    expect(parseNewsFeed(rss(rssItem(undefined, undefined, '<![CDATA[AI & standards]]>')), fed).news[0].title).toBe('AI & standards');
  });
  it('normalizes only tracking query fields and rejects hostile destinations', () => {
    expect(canonicalUrl('https://www.federalreserve.gov/item?b=2&utm_source=x&a=1#part', fed)).toBe('https://www.federalreserve.gov/item?a=1&b=2');
    for (const bad of ['javascript:alert(1)', 'http://www.federalreserve.gov/item', 'https://www.federalreserve.gov.evil.test/item', 'https://user:pw@www.federalreserve.gov/item', 'https://127.0.0.1/item', 'https://www.federalreserve.gov:444/item']) expect(canonicalUrl(bad, fed)).toBeNull();
    expect(() => assertAllowedSource({ ...fed, url: 'https://evil.test/feed' })).toThrow(/allowlist/);
  });
  it('does not admit third-party article links from a trusted feed', () => {
    const parsed = parseNewsFeed(rss(rssItem() + rssItem('https://evil.test/')), fed);
    expect(parsed.news).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
  });
  it('rejects DTD, external entities, malformed XML, wrong namespace and complexity attacks', () => {
    expect(() => parseNewsFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + rss(), fed)).toThrow(/DTD/);
    expect(() => parseNewsFeed(rss().replace('Synthetic', '&unknown;'), fed)).toThrow(/Malformed/);
    expect(() => parseNewsFeed('<rss><channel>', fed)).toThrow();
    expect(() => parseNewsFeed(atom().replace('http://www.w3.org/2005/Atom', 'https://evil.test'), fcdo)).toThrow(/format/);
    expect(() => parseNewsFeed('<x>'.repeat(33) + '</x>'.repeat(33), fed)).toThrow(/complexity/);
    expect(() => parseNewsFeed(' '.repeat(1_048_577), fed)).toThrow(/size/);
  });
  it('bounds inert summaries and accepts an honest empty feed', () => {
    expect(plainText('<script>bad()</script><p>Safe &amp; sound</p>')).toBe('Safe & sound');
    expect(plainText('a'.repeat(900))).toHaveLength(360);
    expect(parseNewsFeed(rss(''), fed).news).toEqual([]);
    expect(() => parseNewsFeed(rss('<item><title>No URL</title></item>'), fed)).toThrow(/No valid/);
  });
});

describe('official ICS schedules, not predictions', () => {
  it('supports actual BLS US-Eastern and DST without using DTSTAMP as publication', () => {
    const parsed = parseCalendar(calendar(vevent('winter', undefined, 'DTSTAMP:20261101T120000Z') + '\n' + vevent('summer', 'DTSTART;TZID=US-Eastern:20260710T083000')), bls);
    expect(parsed.events.map((event) => event.startsAt)).toEqual(['2026-11-10T13:30:00.000Z', '2026-07-10T12:30:00.000Z']);
    expect(parsed.events[0].timeZone).toBe('America/New_York');
    expect(parsed.events[0].publishedAt).toBeNull();
  });
  it('rejects ambiguous/nonexistent DST times, invalid days, missing and unsupported timezones', () => {
    for (const [value, params] of [
      ['20260308T023000', { TZID: 'America/New_York' }], ['20261101T013000', { TZID: 'America/New_York' }],
      ['20260230T083000Z', {}], ['20261110T083000', {}], ['20261110T083000', { TZID: 'Unknown/Zone' }], ['20261110T253000Z', {}],
    ] as const) expect(parseCalendarDate({ value, params })).toBeNull();
  });
  it('preserves date-only dates and exclusive end without inventing midnight instants', () => {
    const event = parseCalendar(calendar(vevent('all-day', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261112')), bls).events[0];
    expect(event).toMatchObject({ startsAt: null, startDate: '2026-11-10', endDate: '2026-11-12', timeZone: null, allDay: true });
  });
  it('retains distinct same-time calendar releases sharing one calendar URL', () => {
    const events = parseCalendar(calendar(vevent('a') + '\n' + vevent('b')), bls).events;
    expect(events).toHaveLength(2);
    expect(events[0].url).toBe(events[1].url);
    expect(events[0].id).not.toBe(events[1].id);
  });
  it('uses UID+sequence for changes and keeps cancellations visible', () => {
    const first = vevent('a');
    const cancelled = vevent('a', undefined, 'STATUS:CANCELLED').replace('SEQUENCE:1', 'SEQUENCE:2');
    const events = parseCalendar(calendar(cancelled + '\n' + first), bls).events;
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('cancelled');
  });
  it('rejects invalid sequence and skips unimplemented recurrence with a warning', () => {
    for (const sequence of ['-1', 'NaN', '1.5', 'Infinity']) {
      expect(() => parseCalendar(calendar(vevent().replace('SEQUENCE:1', `SEQUENCE:${sequence}`)), bls)).toThrow(/No supported/);
    }
    const parsed = parseCalendar(calendar(vevent('valid') + '\n' + vevent('rrule', undefined, 'RRULE:FREQ=MONTHLY')), bls);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.warnings[0]).toContain('循环');
  });
  it('handles folded lines and text escapes; never reads alarms or URL credentials', () => {
    const body = vevent().replace('Synthetic release event-a', 'Synthetic\\, release\n continued') + '\n' + vevent('bad', undefined, 'URL:https://user:secret@www.bls.gov/test');
    const parsed = parseCalendar(calendar(body), bls);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].title).toBe('Synthetic, releasecontinued');
    expect(parsed.warnings).toHaveLength(1);
  });
  it('rejects truncated calendars, duplicate critical fields and untrusted event URLs', () => {
    expect(() => parseCalendar(calendar().replace('END:VCALENDAR', ''), bls)).toThrow(/Incomplete/);
    expect(() => parseCalendar(calendar(vevent('a', undefined, 'DTSTART:20261111T120000Z')), bls)).toThrow(/Ambiguous/);
    expect(() => parseCalendar(calendar(vevent('a', undefined, 'URL:https://evil.test/event')), bls)).toThrow(/No supported/);
  });
});
