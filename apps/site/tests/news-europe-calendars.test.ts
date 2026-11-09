import {describe, expect, it} from 'vitest';
import {parseCalendar, dateInZone} from '@/lib/news/calendar';
import {isUpcoming} from '@/components/news/presentation';
import {NEWS_SOURCES} from '@/lib/news/sources';
import {calendar, vevent} from './news-ingestion-fixture';
const euro = NEWS_SOURCES.find(s => s.id === 'eurostat-euroindicators')!;
const tech = NEWS_SOURCES.find(s => s.id === 'eurostat-technology')!;
const eu = NEWS_SOURCES.find(s => s.id === 'eu-events')!;
describe('reviewed European calendar semantics', () => {
  it.each([euro, tech])('preserves $id dates without inventing times or confirmed status', source => {
    const result = parseCalendar(calendar(vevent('a', 'DTSTART;VALUE=DATE:20261110')), source);
    expect(result.events[0]).toMatchObject({startsAt: null, startDate: '2026-11-10', timeZone: 'Europe/Luxembourg', status: 'tentative', url: source.websiteUrl, regions: ['EU'], relatedMarkets: []});
    expect(source.calendar!.notice).toContain('按暂定展示');
    expect(dateInZone(new Date('2026-11-09T23:30:00Z'), result.events[0].timeZone)).toBe('2026-11-10');
  });
  it('preserves explicit cancellation and confirmation, with no inferred publication', () => {
    for (const [raw, status] of [['CANCELLED', 'cancelled'], ['CONFIRMED', 'scheduled']]) {
      expect(parseCalendar(calendar(vevent('a', 'DTSTART;VALUE=DATE:20261110', `STATUS:${raw}`)), euro).events[0]).toMatchObject({status, publishedAt: null});
    }
  });
  it('does not expose unreviewed links or infer market series from calendar titles', () => {
    const text = calendar(vevent('a', 'DTSTART;VALUE=DATE:20261110', 'URL:https://evil.test/')).replace('Synthetic release', 'China inflation gold bitcoin');
    const event = parseCalendar(text, tech).events[0];
    expect(event).toMatchObject({url: tech.websiteUrl, category: 'technology', regions: ['EU'], relatedMarkets: []});
  });
  it('preserves EU timestamp boundaries without inventing local dates or session times', () => {
    const result = parseCalendar(calendar(vevent('a', 'DTSTART:20261110T230000Z', 'DTEND:20261112T230000Z\nURL:https://other.europa.eu/event\nSTATUS:CONFIRMED')), eu);
    expect(result.events[0]).toMatchObject({startsAt: '2026-11-10T23:00:00.000Z', startDate: '2026-11-10', timeZone: 'UTC', endsAt: '2026-11-12T23:00:00.000Z', endDate: '2026-11-12', url: eu.websiteUrl, status: 'scheduled'});
    expect(eu.calendar!.notice).toContain('不视为实际开场时间');
  });
  it('keeps multi-day source ranges visible through the exclusive end boundary', () => {
    const event = parseCalendar(calendar(vevent('cop', 'DTSTART:20261108T230000Z', 'DTEND:20261119T230000Z')), eu).events[0];
    expect(isUpcoming(event, Date.parse('2026-11-09T12:00:00Z'))).toBe(true);
    expect(isUpcoming(event, Date.parse('2026-11-19T23:00:00Z'))).toBe(false);
  });
  it('keeps DATE ranges until the exclusive end in calendar context without timestamp conversion', () => {
    const event = parseCalendar(calendar(vevent('dates', 'DTSTART;VALUE=DATE:20261108', 'DTEND;VALUE=DATE:20261111')), euro).events[0];
    expect(event).toMatchObject({startsAt: null, endsAt: null, startDate: '2026-11-08', endDate: '2026-11-11', timeZone: 'Europe/Luxembourg'});
    expect(isUpcoming(event, Date.parse('2026-11-10T22:59:59Z'))).toBe(true);
    expect(isUpcoming(event, Date.parse('2026-11-10T23:00:00Z'))).toBe(false);
  });
  it('retains strict malformed, recurrence and reversed-date rejection', () => {
    for (const extra of ['DTEND;VALUE=DATE:20261109', 'RRULE:FREQ=DAILY', 'STATUS:MADE-UP']) {
      expect(() => parseCalendar(calendar(vevent('a', 'DTSTART;VALUE=DATE:20261110', extra)), euro)).toThrow();
    }
  });
});
