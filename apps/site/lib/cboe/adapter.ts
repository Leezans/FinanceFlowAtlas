import {parseCboePrice} from './model';
import type {CboeParseResult, CboeQuote, CboeTrade} from './model';

const isinPattern = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const currencyPattern = /^[A-Z]{3}$/;
const sourceHeader = ['UpdateTime','InstrumentID','Price','PriceCurrency','PriceNotation','Quantity','VenueOfExecution','TradingSystem','PublicationTime','VenueOfPublication','TransactionID','Flags'];
/** Strict RFC4180 records; malformed quoting is a document error, not a shifted price row. */
function csv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => { finishField(); if (row.some(v => v !== '')) rows.push(row); row = []; };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',') finishField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('cboe_invalid_csv'); field += c; }
  }
  if (quoted) throw new Error('cboe_invalid_csv');
  if (field || row.length || closed) finishRow();
  return rows;
}
function instant(value: string): string | null {
  // Source timestamps are UTC with six fractional digits. Retain microseconds, not Date's millisecond truncation.
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) return null;
  const iso = value.replace(' ', 'T') + 'Z', ms = Date.parse(iso);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,23) === iso.slice(0,23) ? iso : null;
}
function positive(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null;
}
export function parseCboeTrades(text: string, sourceFile: string | null = null): CboeParseResult<{events: CboeTrade[]}> {
  const records = csv(text); const events: CboeTrade[] = []; let rejectedRows = 0, skippedRows = 0;
  for (const [index, row] of records.entries()) {
    if (index === 0 && row.length === sourceHeader.length && row.every((value, column) => value === sourceHeader[column])) { skippedRows++; continue; }
    if (row.length !== 12) { rejectedRows++; continue; }
    const [time,isin,p,currency,notation,q,executionVenue,tradingSystem,published,publicationVenue,tradeId,rawFlags] = row;
    const tradeTime = instant(time), publicationTime = instant(published);
    const flags = rawFlags ? rawFlags.split(',') : [];
    if (!tradeTime || !publicationTime || publicationTime < tradeTime || !isinPattern.test(isin) || !currencyPattern.test(currency) || !/^[A-Z0-9]{4}$/.test(executionVenue) || !/^[A-Z0-9]{4}$/.test(publicationVenue) || !/^[A-Za-z0-9]+$/.test(tradeId) || flags.some(f => !/^[A-Z0-9]{4}$/.test(f))) { rejectedRows++; continue; }
    const action = flags.includes('CANC') || flags.includes('CNCL') ? 'cancel' : flags.includes('AMND') ? 'amend' : 'trade';
    if(action!=='trade'&&q!==''&&(!/^\d+(?:\.\d+)?$/.test(q)||!Number.isFinite(Number(q)))){rejectedRows++;continue;}
    const price = parseCboePrice(p), quantity = positive(q);
    if(action!=='trade'&&p!==''&&price===null&&!(p.length<=18&&/^0+(?:\.0+)?$/.test(p))){rejectedRows++;continue;}
    if (action === 'trade' && (price === null || quantity === null)) { rejectedRows++; continue; }
    // Only the non-price-changing ALGO flag is permitted; all other flags fail closed.
    const eligible = action === 'trade' && flags.every(flag => flag === 'ALGO') && notation === 'MONE' && ['BATE','BATD','BATP'].includes(executionVenue) && publicationVenue === 'BATE' && ['CLOB','PATS'].includes(tradingSystem);
    events.push({isin,tradeId,tradeTime,publicationTime,price,currency,notation,quantity,executionVenue,tradingSystem,publicationVenue,flags,action,eligible,sourceFile});
  }
  return {events,rejectedRows,skippedRows,rawRows:records.length-skippedRows};
}
/** Full sampled window must be projected together. Never merge separately projected minute prices. */
export function projectCboeQuotes(events: readonly CboeTrade[]): CboeQuote[] {
  const blocked = new Set<string>(), byId = new Map<string,CboeTrade>();
  for (const event of events) {
    if (event.action !== 'trade') blocked.add(event.isin); // No reliable original/replacement chain: suppress this instrument's entire window.
    const key = `${event.publicationVenue}:${event.tradeTime.slice(0,10)}:${event.tradeId}`;
    const previous = byId.get(key);
    if (previous && JSON.stringify({...previous,sourceFile:null}) !== JSON.stringify({...event,sourceFile:null})) { blocked.add(previous.isin); blocked.add(event.isin); }
    byId.set(key,event);
  }
  const latest = new Map<string,CboeTrade>();
  for (const event of byId.values()) {
    if (!event.eligible || event.price === null || blocked.has(event.isin)) continue;
    const key = `${event.isin}:${event.currency}`; const previous = latest.get(key);
    if (!previous || event.tradeTime > previous.tradeTime || event.tradeTime === previous.tradeTime && event.publicationTime > previous.publicationTime) latest.set(key,event);
  }
  const quotes: CboeQuote[] = [];
  for (const event of latest.values()) {
    if (event.price === null) continue;
    quotes.push({isin:event.isin,price:event.price,currency:event.currency,tradeId:event.tradeId,tradeTime:event.tradeTime,publicationTime:event.publicationTime,executionVenue:event.executionVenue as CboeQuote['executionVenue'],publicationVenue:'BATE',sourceFile:event.sourceFile});
  }
  return quotes.sort((a,b)=>a.currency.localeCompare(b.currency)||a.isin.localeCompare(b.isin));
}
