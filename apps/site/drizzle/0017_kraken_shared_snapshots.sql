CREATE TABLE `kraken_snapshot_cache` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`format_version` integer NOT NULL,
	`payload` text NOT NULL,
	`fetched_ms` integer NOT NULL,
	`expires_ms` integer NOT NULL,
	CONSTRAINT "kraken_snapshot_id" CHECK(length("kraken_snapshot_cache"."snapshot_id") = 36),
	CONSTRAINT "kraken_snapshot_version" CHECK("kraken_snapshot_cache"."format_version" = 1),
	CONSTRAINT "kraken_snapshot_payload" CHECK(json_valid("kraken_snapshot_cache"."payload") AND length(CAST("kraken_snapshot_cache"."payload" AS BLOB)) <= 2000000),
	CONSTRAINT "kraken_snapshot_retention" CHECK("kraken_snapshot_cache"."fetched_ms" >= 0 AND "kraken_snapshot_cache"."expires_ms" = "kraken_snapshot_cache"."fetched_ms" + 900000)
);
--> statement-breakpoint
CREATE TABLE `kraken_snapshot_refs` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `kraken_snapshot_cache`(`snapshot_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kraken_snapshot_key" CHECK("kraken_snapshot_refs"."cache_key" = 'latest' OR (length("kraken_snapshot_refs"."cache_key") BETWEEN 8 AND 113 AND (substr("kraken_snapshot_refs"."cache_key",1,3) = '1m:' OR substr("kraken_snapshot_refs"."cache_key",1,3) = '5m:')))
);
