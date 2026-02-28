CREATE TABLE `skill_search_state` (
	`skill_id` text PRIMARY KEY NOT NULL,
	`dirty` integer DEFAULT 1 NOT NULL,
	`next_update_at` integer,
	`precomputed_at` integer,
	`algo_version` text,
	`score` real,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_error_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_search_state_dirty_due_idx` ON `skill_search_state` (`dirty`,`next_update_at`);--> statement-breakpoint
CREATE INDEX `skill_search_state_due_idx` ON `skill_search_state` (`next_update_at`);--> statement-breakpoint
CREATE INDEX `skill_search_state_algo_dirty_idx` ON `skill_search_state` (`algo_version`,`dirty`);--> statement-breakpoint
CREATE INDEX `skill_search_state_score_idx` ON `skill_search_state` (`score`);--> statement-breakpoint
CREATE INDEX `skills_visibility_name_idx` ON `skills` (`visibility`,`name`);--> statement-breakpoint
CREATE INDEX `skills_visibility_repo_name_idx` ON `skills` (`visibility`,`repo_name`);--> statement-breakpoint
CREATE INDEX `skills_visibility_slug_idx` ON `skills` (`visibility`,`slug`);