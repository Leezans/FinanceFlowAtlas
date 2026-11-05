import {sql} from 'drizzle-orm';
import {integer,sqliteTable,text,check} from 'drizzle-orm/sqlite-core';
/** Public statistical cache only. No user identities, keys, or uploaded data. */
export const ticCache=sqliteTable('tic_snapshot_cache',{
 id:text('id').primaryKey(),
 payload:text('payload'),
 version:text('version'),
 lastAttemptMs:integer('last_attempt_ms'),
 lastSuccessMs:integer('last_success_ms'),
 error:text('error'),
 leaseUntilMs:integer('lease_until_ms').notNull().default(0),
 leaseToken:text('lease_token'),
});

/** Coordination metadata only. No A-share observations or identities are stored. */
export const ashareSourceGate=sqliteTable('ashare_source_gate',{
 id:text('id').primaryKey(),
 status:text('status').notNull(),
 leaseToken:text('lease_token'),
 acquiredMs:integer('acquired_ms'),
 finishedMs:integer('finished_ms'),
 updatedMs:integer('updated_ms').notNull().default(0),
 notBeforeMs:integer('not_before_ms').notNull().default(0),
 reasonCode:text('reason_code'),
},t=>[
 check('ashare_gate_id',sql`${t.id} = 'single_upstream'`),
 check('ashare_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('ashare_gate_reason',sql`${t.reasonCode} IS NULL OR ${t.reasonCode} IN ('http_403','http_429','challenge','captcha','access_denied','login_required')`),
 check('ashare_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
 check('ashare_gate_block',sql`(${t.status} = 'blocked' AND ${t.reasonCode} IS NOT NULL) OR (${t.status} != 'blocked' AND ${t.reasonCode} IS NULL)`),
]);

/** Independent Sina coordination only. No source observations or identities. */
export const sinaSourceGate=sqliteTable('sina_source_gate',{
 id:text('id').primaryKey(),
 status:text('status').notNull(),
 leaseToken:text('lease_token'),
 updatedMs:integer('updated_ms').notNull().default(0),
 notBeforeMs:integer('not_before_ms').notNull().default(0),
},t=>[
 check('sina_gate_id',sql`${t.id} = 'industry_0'`),
 check('sina_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('sina_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

/** Kraken coordination only. No source observations, accounts or credentials. */
export const krakenSourceGate=sqliteTable('kraken_source_gate',{
 id:text('id').primaryKey(),status:text('status').notNull(),leaseToken:text('lease_token'),
 updatedMs:integer('updated_ms').notNull().default(0),notBeforeMs:integer('not_before_ms').notNull().default(0),
},t=>[
 check('kraken_gate_id',sql`${t.id} = 'spot_usd'`),
 check('kraken_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('kraken_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

export const ecbFxSourceGate=sqliteTable('ecb_fx_source_gate',{
 id:text('id').primaryKey(),status:text('status').notNull(),leaseToken:text('lease_token'),
 updatedMs:integer('updated_ms').notNull().default(0),notBeforeMs:integer('not_before_ms').notNull().default(0),
 payload:text('payload'),expiresMs:integer('expires_ms').notNull().default(0),
 checkedMs:integer('checked_ms').notNull().default(0),errorCode:text('error_code'),
},t=>[
 check('ecb_fx_gate_id',sql`${t.id} = 'daily_reference'`),
 check('ecb_fx_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('ecb_fx_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

/** Public official CFTC report cache and independent gate. No private user data. */
export const cftcSourceGate=sqliteTable('cftc_source_gate',{
 id:text('id').primaryKey(),status:text('status').notNull(),leaseToken:text('lease_token'),payload:text('payload'),
 updatedMs:integer('updated_ms').notNull().default(0),notBeforeMs:integer('not_before_ms').notNull().default(0),
},t=>[
 check('cftc_gate_id',sql`${t.id} = 'legacy_futures'`),
 check('cftc_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('cftc_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

/** Public official TPEx report cache and independent gate. No private user data. */
export const tpexSourceGate=sqliteTable('tpex_source_gate',{
 id:text('id').primaryKey(),status:text('status').notNull(),leaseToken:text('lease_token'),payload:text('payload'),
 updatedMs:integer('updated_ms').notNull().default(0),notBeforeMs:integer('not_before_ms').notNull().default(0),
},t=>[
 check('tpex_gate_id',sql`${t.id} = 'institutional_shares'`),
 check('tpex_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('tpex_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

/** Public ASEANstats annual FDI report cache and independent acquisition gate. */
export const aseanSourceGate=sqliteTable('asean_source_gate',{
 id:text('id').primaryKey(),status:text('status').notNull(),leaseToken:text('lease_token'),payload:text('payload'),
 updatedMs:integer('updated_ms').notNull().default(0),notBeforeMs:integer('not_before_ms').notNull().default(0),
},t=>[
 check('asean_gate_id',sql`${t.id} = 'annual_sector_fdi'`),
 check('asean_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('asean_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

/** Public official CVM report cache and independent gate. No private user data. */
export const cvmSourceGate=sqliteTable('cvm_source_gate',{
 id:text('id').primaryKey(),status:text('status').notNull(),leaseToken:text('lease_token'),payload:text('payload'),
 updatedMs:integer('updated_ms').notNull().default(0),notBeforeMs:integer('not_before_ms').notNull().default(0),
},t=>[
 check('cvm_gate_id',sql`${t.id} = 'monthly_fund_equity'`),
 check('cvm_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('cvm_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);

/** One-time operational reconciliation. Metadata only, never financial observations. */
export const ashareRecoveryAudit=sqliteTable('ashare_recovery_audit',{
 id:text('id').primaryKey(),
 priorStatus:text('prior_status').notNull(),
 priorLeaseToken:text('prior_lease_token').notNull(),
 priorAcquiredMs:integer('prior_acquired_ms').notNull(),
 priorFinishedMs:integer('prior_finished_ms'),
 priorUpdatedMs:integer('prior_updated_ms').notNull(),
 priorNotBeforeMs:integer('prior_not_before_ms').notNull(),
 priorReasonCode:text('prior_reason_code'),
 reconciledMs:integer('reconciled_ms').notNull(),
 invocationOutcome:text('invocation_outcome').notNull(),
 sourceOutcome:text('source_outcome').notNull(),
 evidence:text('evidence').notNull(),
});
