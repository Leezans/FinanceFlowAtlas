import { NEWS_SOURCES } from '@/lib/news/sources';
export const NEWS_NOW = '2026-11-09T10:00:00.000Z';
export const rssItem = (url = 'https://www.federalreserve.gov/newsevents/pressreleases/example.htm', date = 'Sun, 08 Nov 2026 13:30:00 GMT', title = 'Synthetic policy release') => `<item><title>${title}</title><link>${url.replaceAll('&', '&amp;')}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Fixture only, not real news.</p>]]></description></item>`;
export const rss = (items = rssItem()) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test only</title>${items}</channel></rss>`;
export const atom = (date = '2026-11-08T10:30:00Z') => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Synthetic official statement</title><link rel="alternate" href="https://www.gov.uk/government/news/fixture"/><updated>${date}</updated><summary type="html">&lt;p&gt;Fixture only&lt;/p&gt;</summary></entry></feed>`;
export const vevent = (uid = 'event-a', start = 'DTSTART;TZID=US-Eastern:20261110T083000', extra = '') => `BEGIN:VEVENT\nUID:${uid}\nSUMMARY:Synthetic release ${uid}\n${start}\nSEQUENCE:1\n${extra}\nEND:VEVENT`;
export const calendar = (events = vevent()) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events}\nEND:VCALENDAR`;
export function sourceBody(url: string): string {
  const source = NEWS_SOURCES.find((entry) => entry.url === url)!;
  if (source.format === 'ics') return calendar();
  if (source.format === 'atom') return atom();
  if (source.id === 'nist-news') return rss(rssItem('https://www.nist.gov/news-events/news/fixture'));
  return rss();
}
