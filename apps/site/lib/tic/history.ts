import {z} from 'zod';
import {SOURCE_URL, sha256} from './adapter';

import {readTable, latestPeriod, trailingMonths, FIRST_TRANSACTION_MONTH} from './table';
export {trailingMonths} from './table';
export const HISTORY_CACHE_KEY = 'tic-equity-history-latest-12-v2';
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const observationSchema = z.object({
 period: month,
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
 start_period: month,
 end_period: month,
 retrieved_at: z.string().datetime({offset: true}),
 raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
 vintage_note: z.literal('Single retrieved source vintage; historical observations may be revised.'),
 observation_release_dates: z.null(),
 observations: z.array(observationSchema).length(12),
}).strict().superRefine((s, ctx) => {
 if (!month.safeParse(s.end_period).success || s.end_period < FIRST_TRANSACTION_MONTH) {ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Unsupported transaction window'}); return;}
 const months = trailingMonths(s.end_period);
 if (s.start_period !== months[0] || (Number.isFinite(Date.parse(s.retrieved_at)) && s.end_period >= new Date(s.retrieved_at).toISOString().slice(0, 7)) ||
     s.observations.some((r, i) => r.period !== months[i] ||
   (r.state === 'reported') !== (r.net_foreign_purchases_usd !== null) ||
   (r.period < FIRST_TRANSACTION_MONTH && r.state === 'reported'))) {
  ctx.addIssue({code: z.ZodIssueCode.custom, message: 'History months or missing-value states are inconsistent'});
 }
 if (s.observations[11]?.state !== 'reported') {
  ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Latest month requires a published total'});
 }
});
export type TicHistory = z.infer<typeof historySchema>;

export async function normalizeHistory(raw: Uint8Array, retrievedAt = new Date().toISOString()): Promise<TicHistory> {
 const table = readTable(raw);
 const end = latestPeriod(table, retrievedAt);
 const months = trailingMonths(end), start = months[0];
 const totals = new Map<string, number | null>();
 for (const row of table) {
  if (row.date < start || row.date < FIRST_TRANSACTION_MONTH || row.date > end) continue;
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
 const rawHash = await sha256(raw);
 return historySchema.parse({
  version: (await sha256(`${rawHash}:${start}:${end}:tic-history-v2`)).slice(0, 20),
  concept: 'reported_net_transactions', scope: 'foreign_residents_us_equity_including_fund_shares',
  aggregation: 'published_grand_total', source_field: 'for_lt_eqty_net', source_url: SOURCE_URL,
  source_unit: 'USD millions', output_unit: 'USD', frequency: 'monthly', is_live: false,
  start_period: start, end_period: end, retrieved_at: retrievedAt, raw_sha256: rawHash,
  vintage_note: 'Single retrieved source vintage; historical observations may be revised.', observation_release_dates: null,
  observations: months.map(period => ({period, net_foreign_purchases_usd: totals.get(period) ?? null,
   state: totals.get(period) == null ? 'not_reported' : 'reported'})),
 });
}
