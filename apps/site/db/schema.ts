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
},t=>[
 check('ecb_fx_gate_id',sql`${t.id} = 'daily_reference'`),
 check('ecb_fx_gate_status',sql`${t.status} IN ('idle','busy','blocked')`),
 check('ecb_fx_gate_lease',sql`(${t.status} = 'busy' AND ${t.leaseToken} IS NOT NULL) OR (${t.status} != 'busy' AND ${t.leaseToken} IS NULL)`),
]);
