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
  /** When set, keep links within reviewed publication sections. */
  articlePathPrefixes?: string[];
  /** Metadata-only sources never reproduce feed descriptions. */
  includeSummary?: boolean;
  attribution: string;
  /** Reviewed calendar semantics, never inferred from titles. */
  calendar?: { dateZone: string; tentativeByDefault?: boolean; notice: string };
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
  {
    id: 'hk-government', name: 'Hong Kong SAR Government / Information Services Department', kind: 'news', format: 'rss',
    url: 'https://www.info.gov.hk/gia/rss/general_en.xml',
    websiteUrl: 'https://data.gov.hk/en-data/dataset/hk-isd-gnmis-gnmis/resource/751b5a45-5c70-4ccb-9aff-d18fdcf2750e',
    termsUrl: 'https://data.gov.hk/en/terms-and-conditions',
    license: 'DATA.GOV.HK terms permit commercial and non-commercial reuse with source and intellectual-property acknowledgment; third-party material excluded',
    category: 'official', regions: ['HKG'], relatedMarkets: [],
    articleHosts: ['www.info.gov.hk'], articlePathPrefixes: ['/gia/general/'],
    attribution: 'Source: The Government of the Hong Kong Special Administrative Region / Information Services Department. Intellectual property rights belong to the Government and relevant owners. Data made available through DATA.GOV.HK. Feed text is shortened and formatting removed by FinanceFlowAtlas (2026-11-09). No endorsement implied.',
  },
  {
    id: 'ecb-press', name: 'European Central Bank', kind: 'news', format: 'rss',
    url: 'https://www.ecb.europa.eu/rss/press.html',
    websiteUrl: 'https://www.ecb.europa.eu/home/html/rss.en.html',
    termsUrl: 'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',
    license: 'Accurate attributed reuse under ECB terms; excludes separately authored papers and third-party material',
    category: 'finance', regions: ['EU'], relatedMarkets: ['fx'],
    articleHosts: ['www.ecb.europa.eu'], articlePathPrefixes: ['/press/pr/'], includeSummary: false,
    attribution: 'Source: European Central Bank. ECB information is available free of charge on its website. Headlines may be shortened and formatting is removed by FinanceFlowAtlas (2026-11-09); feed descriptions are not reproduced. No endorsement implied.',
  },
  {
    id: 'eurostat-euroindicators', name: 'Eurostat Euro indicators', kind: 'events', format: 'ics',
    url: 'https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=2',
    websiteUrl: 'https://ec.europa.eu/eurostat/web/products-eurostat-news/w/wdn-20260105-1',
    termsUrl: 'https://ec.europa.eu/eurostat/help/copyright-notice',
    license: 'European Commission reuse policy; attribution required, third-party material excluded',
    category: 'finance', regions: ['EU'], relatedMarkets: [],
    articleHosts: ['ec.europa.eu'], includeSummary: false,
    calendar: { dateZone: 'Europe/Luxembourg', tentativeByDefault: true, notice: 'Eurostat 仅提供日期，不推断发布时间。日程可能调整；下周日程通常于周五确认，本页未独立核实确认状态，按暂定展示。科技日程为统计发布，不是产品发布会。' },
    attribution: 'Source: Eurostat / European Commission. Calendar titles and dates only; formatting removed and titles may be shortened by FinanceFlowAtlas. Dates are provisional and subject to change. No endorsement implied.',
  },
  {
    id: 'eurostat-technology', name: 'Eurostat science, technology and digital society', kind: 'events', format: 'ics',
    url: 'https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=9&category=0',
    websiteUrl: 'https://ec.europa.eu/eurostat/web/products-eurostat-news/w/wdn-20260105-1',
    termsUrl: 'https://ec.europa.eu/eurostat/help/copyright-notice',
    license: 'European Commission reuse policy; attribution required, third-party material excluded',
    category: 'technology', regions: ['EU'], relatedMarkets: [],
    articleHosts: ['ec.europa.eu'], includeSummary: false,
    calendar: { dateZone: 'Europe/Luxembourg', tentativeByDefault: true, notice: 'Eurostat 仅提供日期，不推断发布时间。日程可能调整；下周日程通常于周五确认，本页未独立核实确认状态，按暂定展示。科技日程为统计发布，不是产品发布会。' },
    attribution: 'Source: Eurostat / European Commission. Calendar titles and dates only; formatting removed and titles may be shortened by FinanceFlowAtlas. Dates are provisional and subject to change. No endorsement implied.',
  },
  {
    id: 'eu-events', name: 'European Union events calendar', kind: 'events', format: 'ics',
    url: 'https://european-union.europa.eu/node/406/ical_en',
    websiteUrl: 'https://european-union.europa.eu/news-and-events/events_en',
    termsUrl: 'https://european-union.europa.eu/legal-notice_en',
    license: 'CC BY 4.0, except separately credited third-party material',
    category: 'official', regions: ['EU'], relatedMarkets: [],
    articleHosts: ['european-union.europa.eu'], includeSummary: false,
    calendar: { dateZone: 'UTC', notice: '欧盟机构活动日历并非政治峰会全量。保留来源 UTC 时间并换算显示；日程边界不视为实际开场时间，具体时刻及活动详情请查官方日历。' },
    attribution: 'Source: European Union. Reused under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Titles may be shortened, formatting removed and UTC timestamps converted for display by FinanceFlowAtlas. No endorsement implied.',
  },
] as const;

export function assertAllowedSource(source: NewsSource): void {
  const reviewed = NEWS_SOURCES.find((candidate) => candidate.id === source.id);
  if (!reviewed || reviewed.url !== source.url || reviewed.format !== source.format) {
    throw new Error('Source is not in the reviewed allowlist');
  }
}
