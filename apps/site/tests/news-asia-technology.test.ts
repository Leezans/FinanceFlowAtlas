import {describe, expect, it} from 'vitest';
import {NEWS_SOURCES} from '@/lib/news/sources';
import {parseNewsFeed} from '@/lib/news/xml';
import {canonicalUrl} from '@/lib/news/normalize';
import {rss, rssItem, sourceBody} from './news-ingestion-fixture';
const sources = NEWS_SOURCES.filter(s => ['taiwan-nstc', 'japan-digital-agency'].includes(s.id));
describe('reviewed Asia technology metadata', () => {
  it.each(sources)('preserves $id explicit source timezone without creating event times', source => {
    expect(parseNewsFeed(sourceBody(source.url), source).news[0]).toMatchObject({publishedAt: '2026-11-09T01:30:00.000Z', publicationTimeKind: 'published', occurredAt: null, category: 'technology', regions: source.regions, relatedMarkets: [], summary: null});
    expect(source.attribution).toContain('No endorsement implied');
    expect(source.attribution).toContain('shortened');
    expect(source.license).toContain('third-party');
  });
  it.each(sources)('does not infer $id relevance, geography or time from keywords/channel metadata', source => {
    const xml = rss(rssItem('https://' + source.articleHosts[0] + '/fixture', '', 'China inflation gold bitcoin')).replace('<title>Test only</title>', '<title>Test only</title><pubDate>Mon, 09 Nov 2026 10:30:00 GMT</pubDate>');
    expect(parseNewsFeed(xml, source).news[0]).toMatchObject({publishedAt: null, publishedDate: null, publicationTimeKind: 'unknown', summary: null, regions: source.regions, relatedMarkets: []});
  });
  it.each(sources)('accepts only $id exact HTTPS hosts, leaving enclosures inert', source => {
    const host = source.articleHosts[0];
    for (const link of [`http://${host}/a`, `https://${host}.evil.test/a`, `https://user@${host}/a`, `https://${host}:8443/a`, 'https://evil.test/a']) expect(canonicalUrl(link, source)).toBeNull();
    expect(parseNewsFeed(sourceBody(source.url).replace('</channel>', '<enclosure url="https://evil.test/image"/></channel>'), source).news).toHaveLength(1);
  });
});
