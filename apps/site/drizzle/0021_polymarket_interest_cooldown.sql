ALTER TABLE `polymarket_source_gate` ADD `lease_view` text;--> statement-breakpoint
ALTER TABLE `polymarket_source_gate` ADD `interest_not_before_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `polymarket_source_gate` ADD `interest_checked_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `polymarket_source_gate` ADD `interest_error_code` text;