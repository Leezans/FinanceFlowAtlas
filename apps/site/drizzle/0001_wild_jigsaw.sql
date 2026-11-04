CREATE TABLE `ashare_source_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`acquired_ms` integer,
	`finished_ms` integer,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	`reason_code` text,
	CONSTRAINT "ashare_gate_id" CHECK("ashare_source_gate"."id" = 'single_upstream'),
	CONSTRAINT "ashare_gate_status" CHECK("ashare_source_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "ashare_gate_reason" CHECK("ashare_source_gate"."reason_code" IS NULL OR "ashare_source_gate"."reason_code" IN ('http_403','http_429','challenge','captcha','access_denied','login_required')),
	CONSTRAINT "ashare_gate_lease" CHECK(("ashare_source_gate"."status" = 'busy' AND "ashare_source_gate"."lease_token" IS NOT NULL) OR ("ashare_source_gate"."status" != 'busy' AND "ashare_source_gate"."lease_token" IS NULL)),
	CONSTRAINT "ashare_gate_block" CHECK(("ashare_source_gate"."status" = 'blocked' AND "ashare_source_gate"."reason_code" IS NOT NULL) OR ("ashare_source_gate"."status" != 'blocked' AND "ashare_source_gate"."reason_code" IS NULL))
);

--> statement-breakpoint
INSERT INTO ashare_source_gate (id,status) VALUES ('single_upstream','idle');
