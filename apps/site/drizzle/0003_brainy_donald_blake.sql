CREATE TABLE `kraken_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "kraken_gate_id" CHECK("kraken_source_gate"."id" = 'spot_usd'),
	CONSTRAINT "kraken_gate_status" CHECK("kraken_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "kraken_gate_lease" CHECK(("kraken_source_gate"."status" = 'busy' AND "kraken_source_gate"."lease_token" IS NOT NULL) OR ("kraken_source_gate"."status" != 'busy' AND "kraken_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO kraken_source_gate (id,status) VALUES ('spot_usd','idle');
