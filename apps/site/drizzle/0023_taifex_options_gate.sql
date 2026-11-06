CREATE TABLE `taifex_options_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "taifex_options_gate_id" CHECK("taifex_options_gate"."id" = 'daily_institutions'),
	CONSTRAINT "taifex_options_gate_status" CHECK("taifex_options_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "taifex_options_gate_lease" CHECK(("taifex_options_gate"."status" = 'busy' AND "taifex_options_gate"."lease_token" IS NOT NULL) OR ("taifex_options_gate"."status" != 'busy' AND "taifex_options_gate"."lease_token" IS NULL)),
	CONSTRAINT "taifex_options_gate_payload" CHECK("taifex_options_gate"."payload" IS NULL OR (json_valid("taifex_options_gate"."payload") AND length(CAST("taifex_options_gate"."payload" AS BLOB)) <= 256000))
);

--> statement-breakpoint
INSERT INTO taifex_options_gate (id,status) VALUES ('daily_institutions','idle');
