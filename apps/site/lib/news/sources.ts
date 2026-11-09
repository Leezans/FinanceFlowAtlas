import type { NewsCategory } from './types';

export interface NewsSource {
  id: string;
  name: string;
  kind: 'news' | 'events';
  format: 'rss' | 'atom' | 'ics';
  url: string;
  websiteUrl: string;
  termsUrl: string;
  license: string;
  category: NewsCategory;
  regions: string[];
  relatedMarkets: string[];
  /** Only these exact HTTPS hosts are accepted for article/event links. */
  articleHosts: string[];
  attribution: string;
}

/**
 * Closed, reviewed allowlist. A query parameter, feed link, or user-supplied URL
 * can never add an upstream. No articles, images, scripts or enclosures are fetched.
 * Reuse review: ../../../../docs/source-global-news.md (2026-11-09).
 */
export const NEWS_SOURCES: readonly NewsSource[] = [
  {
    id: 'fed-press', name: 'Federal Reserve Board', kind: 'news', format: 'rss',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    websiteUrl: 'https://www.federalreserve.gov/feeds/feeds.htm',
    termsUrl: 'https://www.federalreserve.gov/disclaimer.htm',
    license: 'Public domain, except separately credited third-party material',
    category: 'finance', regions: ['USA'], relatedMarkets: ['fx', 'cftc'],
    articleHosts: ['www.federalreserve.gov', 'federalreserve.gov'],
    attribution: 'Source: Board of Governors of the Federal Reserve System. No endorsement implied.',
  },
  {
    id: 'nist-news', name: 'NIST', kind: 'news', format: 'rss',
    url: 'https://www.nist.gov/news-events/news/rss.xml',
    websiteUrl: 'https://www.nist.gov/coo/nist-rss-feeds',
    termsUrl: 'https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications',
    license: 'NIST non-SRD works: public domain in the US; royalty-free worldwide reuse under linked terms',
    category: 'technology', regions: ['USA'], relatedMarkets: [],
    articleHosts: ['www.nist.gov', 'nist.gov'],
    attribution: 'Source: National Institute of Standards and Technology (NIST). NIST employee works are not subject to US copyright and may be subject to foreign copyright. Provided AS IS without warranty. Feed text is shortened and formatting removed by FinanceFlowAtlas (2026-11-09). No endorsement implied.',
  },
  {
    id: 'fcdo-updates', name: 'UK Foreign, Commonwealth & Development Office', kind: 'news', format: 'atom',
    url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=foreign-commonwealth-development-office',
    websiteUrl: 'https://www.gov.uk/search/news-and-communications?organisations%5B%5D=foreign-commonwealth-development-office',
    termsUrl: 'https://www.gov.uk/help/terms-conditions',
    license: 'Open Government Licence v3.0, except separately credited material',
    category: 'geopolitics', regions: ['GBR'], relatedMarkets: [],
    articleHosts: ['www.gov.uk'],
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0. Source: UK Foreign, Commonwealth & Development Office. No endorsement implied.',
  },
  {
    id: 'bls-calendar', name: 'U.S. Bureau of Labor Statistics', kind: 'events', format: 'ics',
    url: 'https://www.bls.gov/schedule/news_release/bls.ics',
    websiteUrl: 'https://www.bls.gov/schedule/',
    termsUrl: 'https://www.bls.gov/opub/copyright-information.htm',
    license: 'Public domain; excludes copyrighted images and the BLS emblem',
    category: 'finance', regions: ['USA'], relatedMarkets: ['fx', 'cftc'],
    articleHosts: ['www.bls.gov', 'bls.gov'],
    attribution: 'Source: U.S. Bureau of Labor Statistics. Published release schedule, subject to change. No endorsement implied.',
  },
] as const;

export function assertAllowedSource(source: NewsSource): void {
  const reviewed = NEWS_SOURCES.find((candidate) => candidate.id === source.id);
  if (!reviewed || reviewed.url !== source.url || reviewed.format !== source.format) {
    throw new Error('Source is not in the reviewed allowlist');
  }
}
