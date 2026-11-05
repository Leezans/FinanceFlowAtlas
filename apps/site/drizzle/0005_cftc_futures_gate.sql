CREATE TABLE `cftc_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cftc_gate_id" CHECK("cftc_source_gate"."id" = 'legacy_futures'),
	CONSTRAINT "cftc_gate_status" CHECK("cftc_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "cftc_gate_lease" CHECK(("cftc_source_gate"."status" = 'busy' AND "cftc_source_gate"."lease_token" IS NOT NULL) OR ("cftc_source_gate"."status" != 'busy' AND "cftc_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO cftc_source_gate (id,status) VALUES ('legacy_futures','idle');
