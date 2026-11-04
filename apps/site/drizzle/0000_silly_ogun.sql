CREATE TABLE `tic_snapshot_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text,
	`version` text,
	`last_attempt_ms` integer,
	`last_success_ms` integer,
	`error` text,
	`lease_until_ms` integer DEFAULT 0 NOT NULL,
	`lease_token` text
);
