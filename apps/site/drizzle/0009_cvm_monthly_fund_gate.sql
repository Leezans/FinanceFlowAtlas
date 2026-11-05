CREATE TABLE `cvm_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cvm_gate_id" CHECK("cvm_source_gate"."id" = 'monthly_fund_equity'),
	CONSTRAINT "cvm_gate_status" CHECK("cvm_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "cvm_gate_lease" CHECK(("cvm_source_gate"."status" = 'busy' AND "cvm_source_gate"."lease_token" IS NOT NULL) OR ("cvm_source_gate"."status" != 'busy' AND "cvm_source_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO cvm_source_gate (id,status) VALUES ('monthly_fund_equity','idle');
