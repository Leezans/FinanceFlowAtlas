ALTER TABLE `ashare_source_gate` ADD `failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ashare_source_gate` ADD `last_failure_ms` integer;--> statement-breakpoint
ALTER TABLE `ashare_source_gate` ADD `failure_code` text;