import {describe, expect, it} from 'vitest';
import {parseNewsFeed} from '@/lib/news/xml';
import {canonicalUrl} from '@/lib/news/normalize';
import {NEWS_SOURCES} from '@/lib/news/sources';
import {ecbRss, hkRss, rssItem} from './news-ingestion-fixture';
const hk = NEWS_SOURCES.find(source => source.id === 'hk-government')!;
const ecb = NEWS_SOURCES.find(source => source.id === 'ecb-press')!;

describe('Hong Kong and ECB source contracts', () => {
  it('uses Hong Kong item time, never the channel GMT time, and preserves source scope', () => {
    const item = parseNewsFeed(hkRss(), hk).news[0];
    expect(item).toMatchObject({publishedAt: '2026-11-09T01:15:00.000Z', publicationTimeKind: 'published', occurredAt: null, category: 'official', regions: ['HKG'], relatedMarkets: []});
    expect(item.summary).toBe('Fixture only, not real news.');
    const missing = hkRss().replace('<pubDate>Mon, 09 Nov 2026 09:15:00 +0800</pubDate>', '');
    expect(parseNewsFeed(missing, hk).news[0]).toMatchObject({publishedAt: null, publishedDate: null, publicationTimeKind: 'unknown'});
  });
  it('normalizes ECB source offsets without inferring an event time or market effect', () => {
    const item = parseNewsFeed(ecbRss(), ecb).news[0];
    expect(item).toMatchObject({publishedAt: '2026-11-09T08:00:00.000Z', publicationTimeKind: 'published', occurredAt: null, category: 'finance', regions: ['EU'], relatedMarkets: ['fx']});
    expect(item.summary).toBeNull();
  });
  it('limits the new sources to reviewed hosts and publication sections', () => {
    expect(canonicalUrl('https://www.info.gov.hk/gia/general/202611/09/Pfixture.htm', hk)).toBeTruthy();
    expect(canonicalUrl('/gia/general/202611/09/Pfixture.htm', hk)).toBe('https://www.info.gov.hk/gia/general/202611/09/Pfixture.htm');
    expect(canonicalUrl('../general/202611/09/Pfixture.htm', hk)).toBe('https://www.info.gov.hk/gia/general/202611/09/Pfixture.htm');
    expect(canonicalUrl('https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.fixture.en.html', ecb)).toBeTruthy();
    for (const url of ['https://www.ecb.europa.eu/pub/pdf/scpwps/ecb.fixture.en.pdf', 'https://www.ecb.europa.eu/press/key/date/2026/html/ecb.fixture.en.html', 'https://www.ecb.europa.eu.evil.test/press/pr/fake']) expect(canonicalUrl(url, ecb)).toBeNull();
    for (const url of ['https://www.info.gov.hk/gia/other/fixture', 'http://www.info.gov.hk/gia/general/fixture', 'https://www.info.gov.hk.evil.test/gia/general/fixture', '//data.gov.hk/gia/general/fixture']) expect(canonicalUrl(url, hk)).toBeNull();
    const parsed = parseNewsFeed(ecbRss().replace('</channel>', `${rssItem('https://www.ecb.europa.eu/pub/paper')}<enclosure url="https://evil.test/image.jpg"/></channel>`), ecb);
    expect(parsed.news).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
  });
});
