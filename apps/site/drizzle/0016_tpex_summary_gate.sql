CREATE TABLE `tpex_summary_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`payload` text,
	`updated_ms` integer DEFAULT 0 NOT NULL,
	`not_before_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tpex_summary_gate_id" CHECK("tpex_summary_gate"."id" = 'institutional_money'),
	CONSTRAINT "tpex_summary_gate_status" CHECK("tpex_summary_gate"."status" IN ('idle','busy','blocked')),
	CONSTRAINT "tpex_summary_gate_lease" CHECK(("tpex_summary_gate"."status" = 'busy' AND "tpex_summary_gate"."lease_token" IS NOT NULL) OR ("tpex_summary_gate"."status" != 'busy' AND "tpex_summary_gate"."lease_token" IS NULL))
);

--> statement-breakpoint
INSERT INTO tpex_summary_gate (id,status) SELECT 'institutional_money', CASE WHEN (SELECT status FROM tpex_source_gate WHERE id='institutional_shares')='blocked' THEN 'blocked' ELSE 'idle' END;
