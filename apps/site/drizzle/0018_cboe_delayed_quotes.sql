CREATE TABLE `cboe_delayed_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cboe_delayed_gate_id" CHECK("cboe_delayed_source_gate"."id" = 'bxe_equities'),
	CONSTRAINT "cboe_delayed_gate_status" CHECK("cboe_delayed_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "cboe_delayed_gate_lease" CHECK(("cboe_delayed_source_gate"."status" = 'busy' AND "cboe_delayed_source_gate"."lease_token" IS NOT NULL) OR ("cboe_delayed_source_gate"."status" != 'busy' AND "cboe_delayed_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO cboe_delayed_source_gate (id,status) VALUES ('bxe_equities','idle');
