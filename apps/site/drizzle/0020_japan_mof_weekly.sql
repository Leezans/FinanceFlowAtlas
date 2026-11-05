CREATE TABLE `japan_mof_source_gate` (
 `id` text PRIMARY KEY NOT NULL,
 `status` text NOT NULL,
 `lease_token` text,
 `payload` text,
 `updated_ms` integer DEFAULT 0 NOT NULL,
 `not_before_ms` integer DEFAULT 0 NOT NULL,
 CONSTRAINT "japan_mof_gate_id" CHECK("id" = 'weekly_liabilities'),
 CONSTRAINT "japan_mof_gate_status" CHECK("status" IN ('idle','busy','blocked')),
 CONSTRAINT "japan_mof_gate_lease" CHECK(("status" = 'busy' AND "lease_token" IS NOT NULL) OR ("status" != 'busy' AND "lease_token" IS NULL)),
 CONSTRAINT "japan_mof_gate_payload" CHECK("payload" IS NULL OR (json_valid("payload") AND length(CAST("payload" AS BLOB)) <= 20000))
);
--> statement-breakpoint
INSERT INTO japan_mof_source_gate (id,status) VALUES ('weekly_liabilities','idle');
