import {z} from 'zod';
import {SOURCE_URL, sha256} from './adapter';

export const HISTORY_START = '2025-09';
// Deliberately fixed and independent of the latest single-month adapter setting.
export const HISTORY_END = '2026-08';
export const HISTORY_CACHE_KEY = 'tic-equity-history-2025-09-2026-08-v1';
export const HISTORY_MONTHS = Array.from({length: 12}, (_, i) => {
 const date = new Date(Date.UTC(2025, 8 + i, 1));
 return date.toISOString().slice(0, 7);
});
const observationSchema = z.object({
 period: z.string(),
 net_foreign_purchases_usd: z.number().int().safe().nullable(),
 state: z.enum(['reported', 'not_reported']),
}).strict();
export const historySchema = z.object({
 version: z.string().regex(/^[a-f0-9]{20}$/),
 concept: z.literal('reported_net_transactions'),
 scope: z.literal('foreign_residents_us_equity_including_fund_shares'),
 aggregation: z.literal('published_grand_total'),
 source_field: z.literal('for_lt_eqty_net'),
 source_url: z.literal(SOURCE_URL),
 source_unit: z.literal('USD millions'),
 output_unit: z.literal('USD'),
 frequency: z.literal('monthly'),
 is_live: z.literal(false),
 start_period: z.literal(HISTORY_START),
 end_period: z.literal(HISTORY_END),
 retrieved_at: z.string().datetime({offset: true}),
 raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
 vintage_note: z.literal('Single retrieved source vintage; historical observations may be revised.'),
 observation_release_dates: z.null(),
 observations: z.array(observationSchema).length(12),
}).strict().superRefine((s, ctx) => {
 if (s.observations.some((r, i) => r.period !== HISTORY_MONTHS[i] ||
   (r.state === 'reported') !== (r.net_foreign_purchases_usd !== null))) {
  ctx.addIssue({code: z.ZodIssueCode.custom, message: 'History months or missing-value states are inconsistent'});
 }
 if (!s.observations.some(r => r.state === 'reported')) {
  ctx.addIssue({code: z.ZodIssueCode.custom, message: 'No published totals in the supported window'});
 }
});
export type TicHistory = z.infer<typeof historySchema>;

// The bounded TSV reader deliberately does not accept HTML, CSV, or inferred units.
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
export async function normalizeHistory(raw: Uint8Array, retrievedAt = new Date().toISOString()): Promise<TicHistory> {
 if (raw.byteLength > 10_000_000) throw new Error('TIC source exceeds size limit');
 const lines = new TextDecoder('utf-8', {fatal: true}).decode(raw).replace(/^\uFEFF/, '').split(/\r?\n/);
 if (!lines[0]?.startsWith('Table 1: U.S. Long-Term Securities Held by Foreign Residents') ||
     !lines.slice(0, 10).some(line => line.split('\t')[0] === 'Millions of dollars')) {
  throw new Error('Unexpected TIC title or unverified units');
 }
 const headersAt = lines.flatMap((line, i) => line.startsWith('country\tcountry_code\tdate\t') ? [i] : []);
 const footersAt = lines.flatMap((line, i) => line.split('\t')[0] === 'Definitions:' ? [i] : []);
 if (headersAt.length !== 1 || footersAt.length !== 1 || footersAt[0] <= headersAt[0]) throw new Error('Invalid or truncated TIC source');
 const headers = fields(lines[headersAt[0]]);
 if (new Set(headers).size !== headers.length || !['country', 'country_code', 'date', 'for_lt_eqty_net'].every(h => headers.includes(h))) throw new Error('Missing or duplicate transaction columns');
 const totals = new Map<string, number | null>();
 for (const line of lines.slice(headersAt[0] + 1, footersAt[0])) {
  if (!line.trim()) continue;
  const values = fields(line);
  if (values.length !== headers.length) throw new Error('Malformed source row');
  const row = Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.date)) throw new Error('Malformed source month');
  if (row.date < HISTORY_START || row.date > HISTORY_END) continue;
  // Country rows and regional aggregates cannot replace the separately published total.
  if (row.country_code !== '99996') {
   if (row.country === 'Grand Total') throw new Error('Grand Total source code changed');
   continue;
  }
  if (row.country !== 'Grand Total' || totals.has(row.date)) throw new Error('Changed or duplicate Grand Total');
  const input = row.for_lt_eqty_net.trim();
  if (input === '' || input === 'n.a.') {totals.set(row.date, null); continue;}
  if (!/^-?\d+$/.test(input)) throw new Error('Malformed Grand Total value');
  const usd = Number(input) * 1_000_000;
  if (!Number.isSafeInteger(usd)) throw new Error('Grand Total exceeds safe precision');
  totals.set(row.date, usd === 0 ? 0 : usd);
 }
 if (!totals.has(HISTORY_END)) throw new Error('Verified endpoint month is absent from the source');
 const rawHash = await sha256(raw);
 return historySchema.parse({
  version: (await sha256(`${rawHash}:${HISTORY_START}:${HISTORY_END}:tic-history-v1`)).slice(0, 20),
  concept: 'reported_net_transactions', scope: 'foreign_residents_us_equity_including_fund_shares',
  aggregation: 'published_grand_total', source_field: 'for_lt_eqty_net', source_url: SOURCE_URL,
  source_unit: 'USD millions', output_unit: 'USD', frequency: 'monthly', is_live: false,
  start_period: HISTORY_START, end_period: HISTORY_END, retrieved_at: retrievedAt, raw_sha256: rawHash,
  vintage_note: 'Single retrieved source vintage; historical observations may be revised.', observation_release_dates: null,
  observations: HISTORY_MONTHS.map(period => ({period, net_foreign_purchases_usd: totals.get(period) ?? null,
   state: totals.get(period) == null ? 'not_reported' : 'reported'})),
 });
}
