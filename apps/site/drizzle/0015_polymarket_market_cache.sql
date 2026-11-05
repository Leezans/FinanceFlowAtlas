CREATE TABLE `polymarket_source_gate` (
 `id` text PRIMARY KEY NOT NULL,
 `status` text NOT NULL,
 `lease_token` text,
 `payload` text,
 `error_code` text,
 `checked_ms` integer DEFAULT 0 NOT NULL,
 `updated_ms` integer DEFAULT 0 NOT NULL,
 `not_before_ms` integer DEFAULT 0 NOT NULL,
 CONSTRAINT `polymarket_gate_id` CHECK (`id` = 'active_markets'),
 CONSTRAINT `polymarket_gate_status` CHECK (`status` IN ('idle','busy','blocked')),
 CONSTRAINT `polymarket_gate_lease` CHECK ((`status` = 'busy' AND `lease_token` IS NOT NULL) OR (`status` != 'busy' AND `lease_token` IS NULL)),
 CONSTRAINT `polymarket_gate_payload` CHECK (`payload` IS NULL OR (json_valid(`payload`) AND length(CAST(`payload` AS BLOB)) <= 2000000))
);
--> statement-breakpoint
INSERT INTO `polymarket_source_gate` (`id`,`status`) VALUES ('active_markets','idle');
