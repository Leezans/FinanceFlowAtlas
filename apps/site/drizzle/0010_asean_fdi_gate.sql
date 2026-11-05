CREATE TABLE `asean_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "asean_gate_id" CHECK("asean_source_gate"."id" = 'annual_sector_fdi'),
	CONSTRAINT "asean_gate_status" CHECK("asean_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "asean_gate_lease" CHECK(("asean_source_gate"."status" = 'busy' AND "asean_source_gate"."lease_token" IS NOT NULL) OR ("asean_source_gate"."status" != 'busy' AND "asean_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO asean_source_gate (id,status) VALUES ('annual_sector_fdi','idle');
