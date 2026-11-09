import { NEWS_SOURCES } from '@/lib/news/sources';
export const NEWS_NOW = '2026-11-09T10:00:00.000Z';
export const rssItem = (url = 'https://www.federalreserve.gov/newsevents/pressreleases/example.htm', date = 'Sun, 08 Nov 2026 13:30:00 GMT', title = 'Synthetic policy release') => `<item><title>${title}</title><link>${url.replaceAll('&', '&amp;')}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Fixture only, not real news.</p>]]></description></item>`;
export const rss = (items = rssItem()) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test only</title>${items}</channel></rss>`;
// Synthetic items preserve the reviewed feeds' timezone and channel-date shapes.
export const hkRss = () => rss(rssItem('https://www.info.gov.hk/gia/general/202611/09/Pfixture.htm', 'Mon, 09 Nov 2026 09:15:00 +0800', 'Synthetic Hong Kong government update')).replace('<title>Test only</title>', '<title>Test only</title><pubDate>Mon, 09 Nov 2026 02:00:00 GMT</pubDate>');
export const ecbRss = () => rss(rssItem('https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.fixture.en.html', 'Mon, 09 Nov 2026 09:00:00 +0100', 'Synthetic monetary policy release'));
export const atom = (date = '2026-11-08T10:30:00Z') => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Synthetic official statement</title><link rel="alternate" href="https://www.gov.uk/government/news/fixture"/><updated>${date}</updated><summary type="html">&lt;p&gt;Fixture only&lt;/p&gt;</summary></entry></feed>`;
export const vevent = (uid = 'event-a', start = 'DTSTART;TZID=US-Eastern:20261110T083000', extra = '') => `BEGIN:VEVENT\nUID:${uid}\nSUMMARY:Synthetic release ${uid}\n${start}\nSEQUENCE:1\n${extra}\nEND:VEVENT`;
export const calendar = (events = vevent()) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events}\nEND:VCALENDAR`;
export function sourceBody(url: string): string {
  const source = NEWS_SOURCES.find((entry) => entry.url === url)!;
  if (source.calendar) return calendar(vevent(source.id, 'DTSTART;VALUE=DATE:20261110'));
  if (source.format === 'ics') return calendar();
  if (source.format === 'atom') return atom();
  if (source.id === 'nist-news') return rss(rssItem('https://www.nist.gov/news-events/news/fixture'));
  if (source.id === 'hk-government') return hkRss();
  if (source.id === 'ecb-press') return ecbRss();
  if (source.id === 'taiwan-nstc') return rss(rssItem('https://www.nstc.gov.tw/folksonomy/detail/fixture', 'Mon, 09 Nov 2026 01:30:00 GMT', '合成科技政策公告'));
  if (source.id === 'japan-digital-agency') return rss(rssItem('https://www.digital.go.jp/en/news/fixture', 'Mon, 09 Nov 2026 10:30:00 +0900', 'Synthetic digital government update'));
  if (source.id === 'fed-press') return rss();
  throw new Error(`Missing synthetic fixture for ${source.id}`);
}
