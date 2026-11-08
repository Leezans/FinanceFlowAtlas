// Browser-safe data contract only: no parsing, fetching, cache, or runtime bindings.
import {z} from 'zod';
import {COUNTRIES} from './geography';

export const SOURCE_URL='https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt';
export const SOURCE_ID='us-tic-slt-equity-transactions';
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const rowSchema = z.object({
  record_id: z.string(),
  foreign_economy_iso3: z.string().regex(/^[A-Z]{3}$/),
  foreign_economy_name: z.string(),
  treasury_country_code: z.string(),
  issuer_economy_iso3: z.literal('USA'),
  net_foreign_purchases_usd: z.number().int().safe(),
  period: month,
  source_id: z.literal(SOURCE_ID),
}).strict();

/** Shared ingestion/browser rules; validation never rescales monetary values. */
export const ticSnapshotSchema = z.object({
  version: z.string(),
  concept: z.literal('reported_net_transactions'),
  asset_class: z.literal('equity'),
  frequency: z.literal('monthly'),
  is_live: z.literal(false),
  period: month,
  source_id: z.literal(SOURCE_ID),
  source_url: z.literal(SOURCE_URL),
  source_field: z.literal('for_lt_eqty_net'),
  source_unit: z.literal('USD millions'),
  output_unit: z.literal('USD'),
  observation_release_date: z.string().nullable(),
  release_url: z.string().url().nullable(),
  source_revision_published_at: z.string().datetime({offset: true}).nullable(),
  retrieved_at: z.string().datetime({offset: true}),
  raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  adapter_version: z.string(),
  geography_version: z.string(),
  excluded_records: z.record(z.number().int().nonnegative()),
  country_flows: z.array(rowSchema).min(1),
  grand_total_net_foreign_purchases_usd: z.number().int().safe().nullable(),
  direction_note: z.string(),
  coverage_note: z.string(),
  license_note: z.string(),
  rights_url: z.string().url(),
}).strict().superRefine((snapshot, ctx) => {
  const retrievedMs = Date.parse(snapshot.retrieved_at);
  if (snapshot.period < '2023-02' || (
    Number.isFinite(retrievedMs) &&
    snapshot.period >= new Date(retrievedMs).toISOString().slice(0, 7)
  )) {
    ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Unsupported or incomplete TIC month'});
  }

  const seen = new Set<string>();
  for (const row of snapshot.country_flows) {
    if (
      row.period !== snapshot.period ||
      seen.has(row.foreign_economy_iso3) ||
      COUNTRIES[row.treasury_country_code]?.[1] !== row.foreign_economy_iso3
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid geography, duplicate country, or inconsistent period',
      });
    }
    seen.add(row.foreign_economy_iso3);
  }
});

export type TicFlow = z.infer<typeof rowSchema>;
export type TicSnapshot = z.infer<typeof ticSnapshotSchema>;

// New ingestion requires the published total. Existing UI snapshots may have null.
export const snapshotSchema = ticSnapshotSchema.refine(
  (snapshot): snapshot is TicSnapshot & {grand_total_net_foreign_purchases_usd: number} =>
    snapshot.grand_total_net_foreign_purchases_usd !== null,
  {message: 'Published TIC grand total is required for ingestion'},
);
export type FlowSnapshot = z.infer<typeof snapshotSchema>;
