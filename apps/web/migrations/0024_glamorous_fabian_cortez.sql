CREATE TABLE `skill_search_prefixes` (
	`skill_id` text NOT NULL,
	`prefix` text NOT NULL,
	`source` text DEFAULT 'token' NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`skill_id`, `prefix`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_search_prefixes_prefix_idx` ON `skill_search_prefixes` (`prefix`);--> statement-breakpoint
CREATE INDEX `skill_search_prefixes_prefix_skill_weight_idx` ON `skill_search_prefixes` (`prefix`,`skill_id`,`weight`);--> statement-breakpoint
CREATE INDEX `skill_search_prefixes_skill_idx` ON `skill_search_prefixes` (`skill_id`);