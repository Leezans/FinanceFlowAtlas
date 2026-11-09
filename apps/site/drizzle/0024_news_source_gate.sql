-- Isolated official-news admission/cache. Does not alter any other provider gate.
-- Busy/blocked rows have no expiry or automatic takeover/reset.
CREATE TABLE `news_source_gate` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL,
  `lease_token` text,
  `payload` text,
  `error_text` text,
  `attempted_ms` integer DEFAULT 0 NOT NULL,
  `updated_ms` integer DEFAULT 0 NOT NULL,
  `not_before_ms` integer DEFAULT 0 NOT NULL,
  CONSTRAINT "news_gate_id" CHECK("id" IN ('fed-press','nist-news','fcdo-updates','bls-calendar','hk-government','ecb-press')),
  CONSTRAINT "news_gate_status" CHECK("status" IN ('idle','busy','blocked')),
  CONSTRAINT "news_gate_lease" CHECK(("status" = 'busy' AND "lease_token" IS NOT NULL) OR ("status" != 'busy' AND "lease_token" IS NULL)),
  CONSTRAINT "news_gate_clock" CHECK("attempted_ms" >= 0 AND "updated_ms" >= 0 AND "not_before_ms" >= 0),
  CONSTRAINT "news_gate_error" CHECK("error_text" IS NULL OR length("error_text") <= 256),
  CONSTRAINT "news_gate_payload" CHECK("payload" IS NULL OR (json_valid("payload") AND length(CAST("payload" AS BLOB)) <= 2100000)),
  CONSTRAINT "news_gate_blocked" CHECK("status" != 'blocked' OR "payload" IS NULL)
);
--> statement-breakpoint
INSERT INTO news_source_gate (id,status) VALUES
 ('fed-press','idle'),('nist-news','idle'),('fcdo-updates','idle'),
 ('bls-calendar','idle'),('hk-government','idle'),('ecb-press','idle');
