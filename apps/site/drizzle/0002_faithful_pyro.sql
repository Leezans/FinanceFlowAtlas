CREATE TABLE `sina_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sina_gate_id" CHECK("sina_source_gate"."id" = 'industry_0'),
	CONSTRAINT "sina_gate_status" CHECK("sina_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "sina_gate_lease" CHECK(("sina_source_gate"."status" = 'busy' AND "sina_source_gate"."lease_token" IS NOT NULL) OR ("sina_source_gate"."status" != 'busy' AND "sina_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO sina_source_gate (id,status) VALUES ('industry_0','idle');
