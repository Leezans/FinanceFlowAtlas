ALTER TABLE `ecb_fx_source_gate` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `ecb_fx_source_gate` ADD `expires_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ecb_fx_source_gate` ADD `checked_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ecb_fx_source_gate` ADD `error_code` text;