import { SaxesParser } from 'saxes';
import type { NewsSource } from './sources';
import type { NewsItem } from './types';
import { canonicalUrl, contextTags, plainText, publicationDate, stableId } from './normalize';

interface XmlNode { name: string; uri: string; attributes: Record<string, string>; children: Array<XmlNode | string> }
const ATOM = 'http://www.w3.org/2005/Atom';
const DC = 'http://purl.org/dc/elements/1.1/';
export const MAX_DOCUMENT_BYTES = 1_048_576;

function children(node: XmlNode, name: string, uri = node.uri): XmlNode[] {
  return node.children.filter((child): child is XmlNode => typeof child !== 'string' && child.name === name && child.uri === uri);
}
function textContent(node: XmlNode | undefined): string {
  if (!node) return '';
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('');
}
function field(node: XmlNode, name: string, uri = node.uri): string {
  return textContent(children(node, name, uri)[0]).trim();
}

/** Strict bounded XML, no DTD/entities, fetching or HTML execution. */
function parseXml(xml: string): XmlNode {
  if (new TextEncoder().encode(xml).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Feed exceeds size limit');
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodes = 0;
  parser.on('doctype', () => { throw new Error('XML DTD is not permitted'); });
  parser.on('error', () => { throw new Error('Malformed XML feed'); });
  parser.on('opentag', (tag) => {
    if (++nodes > 25000 || stack.length >= 32) throw new Error('XML complexity limit exceeded');
    const node: XmlNode = { name: tag.local.toLowerCase(), uri: tag.uri, attributes: {}, children: [] };
    for (const attr of Object.values(tag.attributes)) if (!attr.uri) node.attributes[attr.local.toLowerCase()] = attr.value;
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    stack.push(node);
  });
  const append = (text: string) => { if (stack.length) stack[stack.length - 1].children.push(text); };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => { stack.pop(); });
  parser.write(xml).close();
  if (!root) throw new Error('Missing feed root');
  return root;
}

export function parseNewsFeed(xml: string, source: NewsSource): { news: NewsItem[]; warnings: string[] } {
  const root = parseXml(xml);
  let entries: XmlNode[];
  if (source.format === 'rss' && root.name === 'rss' && !root.uri) {
    const channel = children(root, 'channel')[0];
    if (!channel) throw new Error('Missing RSS channel');
    entries = children(channel, 'item');
  } else if (source.format === 'atom' && root.name === 'feed' && root.uri === ATOM) {
    entries = children(root, 'entry');
  } else throw new Error('Unexpected feed format');
  if (entries.length > 2000) throw new Error('Feed entry limit exceeded');
  const news: NewsItem[] = [];
  let skipped = 0;
  let unknownDates = 0;
  for (const entry of entries) {
    const title = plainText(field(entry, 'title'), 240);
    const rawUrl = source.format === 'rss' ? field(entry, 'link') : children(entry, 'link')
      .find((link) => !link.attributes.rel || link.attributes.rel === 'alternate')?.attributes.href ?? '';
    const url = rawUrl ? canonicalUrl(rawUrl, source) : null;
    if (!title || !url) { skipped++; continue; }
    const published = source.format === 'rss' ? field(entry, 'pubdate') || field(entry, 'date', DC) : field(entry, 'published');
    const updated = source.format === 'atom' ? field(entry, 'updated') : '';
    const rawDate = published || updated;
    const date = publicationDate(rawDate);
    const known = date.instant !== null || date.date !== null;
    if (!known) unknownDates++;
    news.push({
      id: stableId(source.id, url), title, url, sourceId: source.id, sourceName: source.name,
      category: source.category, ...contextTags(title, source),
      publishedAt: date.instant, publishedDate: date.date,
      publicationTimeKind: known ? (published ? 'published' : 'updated') : 'unknown',
      occurredAt: null,
      summary: plainText(field(entry, source.format === 'rss' ? 'description' : 'summary')) || null,
    });
  }
  if (entries.length && !news.length) throw new Error('No valid entries in nonempty feed');
  const warnings: string[] = [];
  if (skipped) warnings.push(`已跳过 ${skipped} 条缺少标题或安全来源链接的记录。`);
  if (unknownDates) warnings.push(`${unknownDates} 条记录没有可确认的发布时间；采集时间不代替发布时间。`);
  return { news, warnings };
}
