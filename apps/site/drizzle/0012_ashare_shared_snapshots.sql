CREATE TABLE `ashare_snapshot_cache` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`format_version` integer NOT NULL,
	`payload` text NOT NULL,
	`committed_ms` integer NOT NULL,
	`expires_ms` integer NOT NULL,
	CONSTRAINT "ashare_snapshot_scope" CHECK("ashare_snapshot_cache"."scope_key" = 'level1' OR "ashare_snapshot_cache"."scope_key" GLOB 'BK[0-9][0-9][0-9][0-9]'),
	CONSTRAINT "ashare_snapshot_version" CHECK("ashare_snapshot_cache"."format_version" = 1),
	CONSTRAINT "ashare_snapshot_payload" CHECK(json_valid("ashare_snapshot_cache"."payload") AND length(CAST("ashare_snapshot_cache"."payload" AS BLOB)) <= 2000000),
	CONSTRAINT "ashare_snapshot_retention" CHECK("ashare_snapshot_cache"."committed_ms" >= 0 AND "ashare_snapshot_cache"."expires_ms" = "ashare_snapshot_cache"."committed_ms" + 86400000)
);
