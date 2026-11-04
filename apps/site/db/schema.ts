import {integer,sqliteTable,text} from 'drizzle-orm/sqlite-core';
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
