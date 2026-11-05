CREATE TABLE `tpex_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tpex_gate_id" CHECK("tpex_source_gate"."id" = 'institutional_shares'),
	CONSTRAINT "tpex_gate_status" CHECK("tpex_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "tpex_gate_lease" CHECK(("tpex_source_gate"."status" = 'busy' AND "tpex_source_gate"."lease_token" IS NOT NULL) OR ("tpex_source_gate"."status" != 'busy' AND "tpex_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO tpex_source_gate (id,status) VALUES ('institutional_shares','idle');
