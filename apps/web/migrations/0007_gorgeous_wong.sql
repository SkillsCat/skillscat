CREATE TABLE `skill_search_terms` (
	`skill_id` text NOT NULL,
	`term` text NOT NULL,
	`source` text DEFAULT 'token' NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`skill_id`, `term`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_search_terms_term_idx` ON `skill_search_terms` (`term`);--> statement-breakpoint
CREATE INDEX `skill_search_terms_skill_idx` ON `skill_search_terms` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_search_terms_term_weight_idx` ON `skill_search_terms` (`term`,`weight`);