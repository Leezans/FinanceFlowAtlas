CREATE TABLE `ecb_fx_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ecb_fx_gate_id" CHECK("ecb_fx_source_gate"."id" = 'daily_reference'),
	CONSTRAINT "ecb_fx_gate_status" CHECK("ecb_fx_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "ecb_fx_gate_lease" CHECK(("ecb_fx_source_gate"."status" = 'busy' AND "ecb_fx_source_gate"."lease_token" IS NOT NULL) OR ("ecb_fx_source_gate"."status" != 'busy' AND "ecb_fx_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO ecb_fx_source_gate (id,status) VALUES ('daily_reference','idle');
