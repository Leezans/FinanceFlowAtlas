CREATE TABLE `worldbank_equity_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "worldbank_equity_gate_id" CHECK("worldbank_equity_source_gate"."id" = 'annual_equity'),
	CONSTRAINT "worldbank_equity_gate_status" CHECK("worldbank_equity_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "worldbank_equity_gate_lease" CHECK(("worldbank_equity_source_gate"."status" = 'busy' AND "worldbank_equity_source_gate"."lease_token" IS NOT NULL) OR ("worldbank_equity_source_gate"."status" != 'busy' AND "worldbank_equity_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO worldbank_equity_source_gate (id,status) VALUES ('annual_equity','idle');
