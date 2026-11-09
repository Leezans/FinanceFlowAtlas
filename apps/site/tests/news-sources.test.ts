import {describe, expect, it} from 'vitest';
import {NEWS_SOURCES, assertAllowedSource} from '@/lib/news/sources';
import {evidenceSources} from '@/lib/catalog/sources';

describe('reviewed six-source coverage', () => {
  it('enables only the six reviewed sources, with one calendar and no unresolved candidate', () => {
    expect(NEWS_SOURCES.map(source => source.id)).toEqual(['fed-press', 'nist-news', 'fcdo-updates', 'bls-calendar', 'hk-government', 'ecb-press']);
    expect(NEWS_SOURCES.filter(source => source.kind === 'events').map(source => source.id)).toEqual(['bls-calendar']);
    for (const source of NEWS_SOURCES) {
      expect(() => assertAllowedSource(source)).not.toThrow();
      expect(source.termsUrl).toMatch(/^https:\/\//);
      expect(source.attribution.length).toBeGreaterThan(20);
      expect(source.relatedMarkets.every(id => evidenceSources.some(market => market.id === id))).toBe(true);
    }
  });
  it('identifies Hong Kong government statements without implying mainland or pan-Asian coverage', () => {
    const source = NEWS_SOURCES.find(source => source.id === 'hk-government')!;
    expect(source).toMatchObject({category: 'official', regions: ['HKG'], relatedMarkets: [], format: 'rss', url: 'https://www.info.gov.hk/gia/rss/general_en.xml'});
    expect(source.attribution).toContain('Government of the Hong Kong Special Administrative Region / Information Services Department');
    expect(source.attribution).toContain('Intellectual property rights');
    expect(source.attribution).toContain('DATA.GOV.HK');
    expect(source.license).toContain('commercial and non-commercial');
  });
  it('keeps ECB attribution, modification and free-source notices visible in source metadata', () => {
    const source = NEWS_SOURCES.find(source => source.id === 'ecb-press')!;
    expect(source).toMatchObject({category: 'finance', regions: ['EU'], relatedMarkets: ['fx'], format: 'rss', articlePathPrefixes: ['/press/pr/'], includeSummary: false});
    expect(source.attribution).toContain('European Central Bank');
    expect(source.attribution).toContain('available free of charge');
    expect(source.attribution).toContain('shortened and formatting is removed');
    expect(source.attribution).toContain('feed descriptions are not reproduced');
    expect(source.license).toContain('excludes separately authored papers');
  });
});
