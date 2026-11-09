import type { NewsSource } from './sources';
import type { ScheduledEvent } from './types';
import { canonicalUrl, contextTags, plainText, stableId, validDateOnly } from './normalize';
import { MAX_DOCUMENT_BYTES } from './xml';

interface Property { value: string; params: Record<string, string> }
type Properties = Map<string, Property>;
interface CalendarDate { instant: string | null; date: string; zone: string | null; allDay: boolean }
const TIMEZONE_ALIASES: Record<string, string> = {
  'US-Eastern': 'America/New_York', 'US/Eastern': 'America/New_York',
  'Eastern Standard Time': 'America/New_York', 'EST5EDT': 'America/New_York',
};
const decode = (value: string) => value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');

function property(line: string): { name: string; property: Property } | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (!quoted && line[i] === ':') { colon = i; break; }
  }
  if (colon < 1 || quoted) return null;
  const head = line.slice(0, colon).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const name = head.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const part of head) {
    const equals = part.indexOf('=');
    if (equals < 1) return null;
    params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, '');
  }
  return { name, property: { value: line.slice(colon + 1), params } };
}

function zonedParts(ms: number, zone: string): number[] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((key) => Number(parts.find((part) => part.type === key)?.value));
}

/** Convert with IANA DST rules; reject nonexistent or ambiguous civil times. */
export function parseCalendarDate(prop: Property | undefined): CalendarDate | null {
  if (!prop) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!validDateOnly(date)) return null;
  if (!match[4]) {
    if (prop.params.VALUE && prop.params.VALUE !== 'DATE') return null;
    return { instant: null, date, zone: null, allDay: true };
  }
  if (prop.params.VALUE === 'DATE') return null;
  const components = match.slice(1, 7).map(Number);
  if (components[3] > 23 || components[4] > 59 || components[5] > 59) return null;
  const utc = Date.UTC(components[0], components[1] - 1, components[2], components[3], components[4], components[5]);
  if (match[7]) return prop.params.TZID ? null : { instant: new Date(utc).toISOString(), date, zone: 'UTC', allDay: false };
  const rawZone = prop.params.TZID;
  // Floating time is not silently interpreted as UTC, Shanghai, or server local time.
  if (!rawZone) return null;
  const zone = TIMEZONE_ALIASES[rawZone] ?? rawZone;
  try {
    const offsets = new Set<number>();
    for (const sample of [utc - 86400000, utc, utc + 86400000]) {
      const p = zonedParts(sample, zone);
      offsets.add(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - sample);
    }
    const candidates = [...offsets].map((offset) => utc - offset)
      .filter((candidate) => zonedParts(candidate, zone).every((part, i) => part === components[i]));
    if (candidates.length !== 1) return null;
    return { instant: new Date(candidates[0]).toISOString(), date, zone, allDay: false };
  } catch { return null; }
}

export function parseCalendar(ics: string, source: NewsSource): { events: ScheduledEvent[]; warnings: string[] } {
  if (new TextEncoder().encode(ics).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Calendar exceeds size limit');
  const lines = ics.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  if (lines.length > 25000 || lines.some((line) => line.length > 32768)) throw new Error('Calendar complexity limit exceeded');
  const stack: string[] = [];
  const records: Properties[] = [];
  let current: Properties | null = null;
  let seenCalendar = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = property(line);
    if (!parsed) throw new Error('Malformed calendar property');
    const { name, property: prop } = parsed;
    if (name === 'BEGIN') {
      const component = prop.value.toUpperCase();
      if (!stack.length) {
        if (seenCalendar || component !== 'VCALENDAR') throw new Error('Unexpected calendar root');
        seenCalendar = true;
      }
      if (stack.length >= 8) throw new Error('Calendar nesting limit exceeded');
      if (component === 'VEVENT') {
        if (stack.length !== 1 || stack[0] !== 'VCALENDAR') throw new Error('Unexpected event nesting');
        current = new Map();
      }
      stack.push(component);
    } else if (name === 'END') {
      if (stack.pop() !== prop.value.toUpperCase()) throw new Error('Malformed calendar component');
      if (prop.value.toUpperCase() === 'VEVENT' && current) {
        records.push(current); current = null;
        if (records.length > 2000) throw new Error('Calendar event limit exceeded');
      }
    } else if (current && stack[stack.length - 1] === 'VEVENT') {
      if (current.has(name) && ['DTSTART', 'DTEND', 'UID', 'SUMMARY', 'STATUS', 'URL'].includes(name)) throw new Error('Ambiguous repeated calendar property');
      current.set(name, prop);
    } else if (!stack.length) throw new Error('Calendar content outside root');
  }
  if (!seenCalendar || stack.length || current) throw new Error('Incomplete calendar');
  const events: ScheduledEvent[] = [];
  let skipped = 0;
  let recurring = 0;
  const revisions = new Map<string, { sequence: number; stamp: number; event: ScheduledEvent }>();
  for (const record of records) {
    // Expanding RRULE or merging exception calendars requires a full recurrence engine.
    // Do not silently invent occurrences or display a superseded recurring master.
    if (record.has('RRULE') || record.has('RDATE') || record.has('RECURRENCE-ID') || record.has('EXDATE')) { recurring++; continue; }
    const title = plainText(decode(record.get('SUMMARY')?.value ?? ''), 240);
    const start = parseCalendarDate(record.get('DTSTART'));
    const endProp = record.get('DTEND');
    const end = parseCalendarDate(endProp);
    const rawUrl = record.get('URL')?.value;
    const url = rawUrl ? canonicalUrl(decode(rawUrl), source) : source.websiteUrl;
    if (!title || !start || !url || (endProp && !end) ||
      (end && (end.allDay !== start.allDay || (start.allDay ? end.date <= start.date : !end.instant || !start.instant || end.instant <= start.instant)))) { skipped++; continue; }
    const rawStatus = record.get('STATUS')?.value.toUpperCase();
    if (rawStatus && !['CONFIRMED', 'TENTATIVE', 'CANCELLED'].includes(rawStatus)) { skipped++; continue; }
    const sequenceText = record.get('SEQUENCE')?.value ?? '0';
    const sequence = Number(sequenceText);
    if (!/^\d+$/.test(sequenceText) || !Number.isSafeInteger(sequence)) { skipped++; continue; }
    const uid = record.get('UID')?.value || `${url}|${title}|${start.instant ?? start.date}`;
    const event: ScheduledEvent = {
      id: stableId(source.id, uid), title, url, sourceId: source.id, sourceName: source.name,
      category: source.category, ...contextTags(title, source),
      startsAt: start.instant, startDate: start.date, timeZone: start.zone, allDay: start.allDay,
      endsAt: end?.instant ?? null, endDate: end?.date ?? null,
      status: rawStatus === 'CANCELLED' ? 'cancelled' : rawStatus === 'TENTATIVE' ? 'tentative' : 'scheduled',
      // DTSTAMP is a transport/revision timestamp, not proof of original publication.
      publishedAt: null,
    };
    const stamp = Date.parse(parseCalendarDate(record.get('LAST-MODIFIED'))?.instant ?? parseCalendarDate(record.get('DTSTAMP'))?.instant ?? '') || 0;
    const previous = revisions.get(uid);
    if (!previous || sequence > previous.sequence || (sequence === previous.sequence && stamp >= previous.stamp)) {
      revisions.set(uid, { sequence, stamp, event });
    }
  }
  for (const revision of revisions.values()) events.push(revision.event);
  if (records.length && !events.length) throw new Error('No supported valid events in nonempty calendar');
  const warnings: string[] = [];
  if (skipped) warnings.push(`已跳过 ${skipped} 条缺少安全链接、有效日期或明确时区的日程。`);
  if (recurring) warnings.push(`未展开 ${recurring} 条循环/例外日程，不推算未来事件。`);
  return { events, warnings };
}

export function dateInZone(now: Date, zone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((key) => parts.find((part) => part.type === key)?.value ?? '').join('-');
}
