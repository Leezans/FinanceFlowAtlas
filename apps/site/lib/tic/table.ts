/** Shared bounded parser for the public SLT Table 1, never a release-calendar estimate. */
export const FIRST_TRANSACTION_MONTH = '2023-02';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export type TableRow = Record<string, string>;

function fields(line: string): string[] {
 const values: string[] = []; let value = '', quoted = false;
 for (let i = 0; i < line.length; i++) {
  const c = line[i];
  if (c === '"') {
   if (quoted && line[i + 1] === '"') {value += '"'; i++;}
   else if (!value || quoted) quoted = !quoted;
   else value += c;
  } else if (c === '\t' && !quoted) {values.push(value); value = '';}
  else value += c;
 }
 if (quoted) throw new Error('Unterminated source quote');
 values.push(value); return values;
}

export function readTable(raw: Uint8Array): TableRow[] {
 if (raw.byteLength > 10_000_000) throw new Error('TIC source exceeds size limit');
 const lines = new TextDecoder('utf-8', {fatal: true}).decode(raw).replace(/^\uFEFF/, '').split(/\r?\n/);
 if (!lines[0]?.startsWith('Table 1: U.S. Long-Term Securities Held by Foreign Residents') ||
     !lines.slice(0, 10).some(line => line.split('\t')[0] === 'Millions of dollars')) {
  throw new Error('Unexpected TIC title or unverified units');
 }
 const heads = lines.flatMap((line, i) => line.startsWith('country\tcountry_code\tdate\t') ? [i] : []);
 const feet = lines.flatMap((line, i) => line.split('\t')[0] === 'Definitions:' ? [i] : []);
 if (heads.length !== 1 || feet.length !== 1 || feet[0] <= heads[0]) throw new Error('Invalid or truncated TIC source');
 const headers = fields(lines[heads[0]]);
 if (new Set(headers).size !== headers.length || !['country', 'country_code', 'date', 'for_lt_eqty_net'].every(h => headers.includes(h))) throw new Error('Missing or duplicate transaction columns');
 return lines.slice(heads[0] + 1, feet[0]).filter(line => line.trim()).map(line => {
  const values = fields(line);
  if (values.length !== headers.length) throw new Error('Malformed source row');
  const row = Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  if (!MONTH.test(row.date)) throw new Error('Malformed source month');
  return row;
 });
}

export function validateRetrievedAt(value: string): void {
 if (!/([zZ]|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('retrieved_at must include timezone');
}

/** Discover from all source rows, not only good totals: a partial newer month must fail closed. */
export function latestPeriod(rows: TableRow[], retrievedAt: string): string {
 validateRetrievedAt(retrievedAt);
 let latest = '';
 const currentMonth = new Date(retrievedAt).toISOString().slice(0, 7);
 for (const row of rows) {
  if (row.date >= currentMonth) throw new Error('TIC source includes an incomplete current or future observation month');
  if (row.date >= FIRST_TRANSACTION_MONTH && row.date > latest) latest = row.date;
 }
 if (!latest) throw new Error('No supported TIC transaction month in source');
 const totals = rows.filter(row => row.date === latest && (row.country_code === '99996' || row.country === 'Grand Total'));
 if (totals.length !== 1 || totals[0].country !== 'Grand Total' || totals[0].country_code !== '99996') throw new Error('Latest TIC month requires one valid Grand Total');
 if (!/^-?\d+$/.test(totals[0].for_lt_eqty_net.trim()) || !Number.isSafeInteger(Number(totals[0].for_lt_eqty_net.trim()) * 1_000_000)) throw new Error('Latest TIC month has no valid published equity transaction total');
 return latest;
}

export function trailingMonths(end: string): string[] {
 if (!MONTH.test(end) || end < FIRST_TRANSACTION_MONTH) throw new Error('Unsupported TIC history month');
 const [year, month] = end.split('-').map(Number);
 return Array.from({length: 12}, (_, i) => new Date(Date.UTC(year, month - 12 + i, 1)).toISOString().slice(0, 7));
}
