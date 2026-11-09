import type { NewsSource } from './sources';

/** Plain text only. The UI must render strings, never dangerouslySetInnerHTML. */
export function plainText(value: string, limit = 360): string {
  const text = value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    })
    // Encoded markup is also removed; all strings remain inert React text.
    .replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** Normalize only known tracking fields; preserve meaningful query and path data. */
export function canonicalUrl(raw: string, source: NewsSource): string | null {
  try {
    // Relative feed links resolve against the fetched feed, not a separate dataset directory.
    const url = new URL(raw.trim(), source.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !source.articleHosts.includes(url.hostname)) return null;
    if (source.articlePathPrefixes && !source.articlePathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export function stableId(sourceId: string, identity: string): string {
  // Stable non-cryptographic identifier only; never used as a trust/authentication token.
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  return `${sourceId}-${(hash >>> 0).toString(16)}`;
}

export function contextTags(title: string, source: NewsSource): { regions: string[]; relatedMarkets: string[] } {
  const regions = new Set(source.regions);
  const markets = new Set(source.relatedMarkets);
  // Literal title matches and publisher context, not NLP causality or investment advice.
  for (const [pattern, code] of [
    [/\b(?:China|Chinese)\b/i, 'CHN'], [/\b(?:Japan|Japanese)\b/i, 'JPN'],
    [/\b(?:Europe|European Union|ECB)\b/i, 'EU'], [/\b(?:United States|U\.S\.|Federal Reserve)\b/i, 'USA'],
    [/\b(?:United Kingdom|Britain|British)\b/i, 'GBR'],
    [/\bHong Kong\b/i, 'HKG'],
  ] as const) if (pattern.test(title)) regions.add(code);
  if (/\b(?:currency|foreign exchange|monetary|interest rate|inflation|consumer price)\b/i.test(title)) markets.add('fx');
  if (/\b(?:oil|gold|commodity|commodities|futures)\b/i.test(title)) markets.add('cftc');
  if (/\b(?:bitcoin|ethereum|crypto(?:currency)?)\b/i.test(title)) markets.add('kraken');
  return { regions: [...regions], relatedMarkets: [...markets] };
}

export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Refuse floating date-times: the server's timezone is not source evidence. */
export function publicationDate(value: string): { instant: string | null; date: string | null } {
  const text = value.trim();
  if (validDateOnly(text)) return { instant: null, date: text };
  const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const rfcWithZone = /(?:\b(?:GMT|UTC|UT|EST|EDT|CST|CDT|MST|MDT|PST|PDT)|[+-]\d{4})$/i.test(text) && /\d{4}/.test(text);
  if (!isoWithZone && !rfcWithZone) return { instant: null, date: null };
  if (isoWithZone && (!validDateOnly(text.slice(0, 10)) || Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59)) return { instant: null, date: null };
  if (rfcWithZone) {
    const parts = /^(?:[a-z]{3},?\s+)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:GMT|UTC|UT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|[+-]\d{4})$/i.exec(text);
    const month = parts ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(parts[2].toLowerCase()) + 1 : 0;
    if (!parts || !month || !validDateOnly(`${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}`) || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6] ?? '0') > 59) return { instant: null, date: null };
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return { instant: null, date: null };
  return { instant: new Date(ms).toISOString(), date: new Date(ms).toISOString().slice(0, 10) };
}
