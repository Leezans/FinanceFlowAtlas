CREATE TABLE `deribit_options_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deribit_options_gate_id" CHECK("deribit_options_gate"."id" = 'btc_options'),
	CONSTRAINT "deribit_options_gate_status" CHECK("deribit_options_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "deribit_options_gate_lease" CHECK(("deribit_options_gate"."status" = 'busy' AND "deribit_options_gate"."lease_token" IS NOT NULL) OR ("deribit_options_gate"."status" != 'busy' AND "deribit_options_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO deribit_options_gate (id,status) VALUES ('btc_options','idle');
