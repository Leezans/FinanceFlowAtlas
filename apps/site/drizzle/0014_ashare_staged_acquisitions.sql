CREATE TABLE `ashare_staged_acquisitions` (
  `scope_key` text PRIMARY KEY NOT NULL,
  `format_version` integer NOT NULL,
  `payload` text NOT NULL,
  `started_ms` integer NOT NULL,
  `updated_ms` integer NOT NULL,
  `expires_ms` integer NOT NULL,
  CONSTRAINT "ashare_stage_scope" CHECK("scope_key" = 'level1' OR "scope_key" GLOB 'BK[0-9][0-9][0-9][0-9]'),
  CONSTRAINT "ashare_stage_version" CHECK("format_version" = 1),
  CONSTRAINT "ashare_stage_payload" CHECK(json_valid("payload") AND length(CAST("payload" AS BLOB)) <= 2000000),
  CONSTRAINT "ashare_stage_retention" CHECK("started_ms" >= 0 AND "updated_ms" >= "started_ms" AND "updated_ms" < "expires_ms" AND "expires_ms" = "started_ms" + 180000)
);
