PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_skill_recommend_state` (
	`skill_id` text PRIMARY KEY NOT NULL,
	`dirty` integer DEFAULT 1 NOT NULL,
	`next_update_at` integer,
	`precomputed_at` integer,
	`algo_version` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_error_at` integer,
	`last_fallback_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_skill_recommend_state`("skill_id", "dirty", "next_update_at", "precomputed_at", "algo_version", "fail_count", "last_error_at", "last_fallback_at", "created_at", "updated_at") SELECT "skill_id", "dirty", "next_update_at", "precomputed_at", "algo_version", "fail_count", "last_error_at", "last_fallback_at", "created_at", "updated_at" FROM `skill_related_state`;--> statement-breakpoint
DROP TABLE `skill_related_state`;--> statement-breakpoint
ALTER TABLE `__new_skill_recommend_state` RENAME TO `skill_recommend_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `skill_recommend_state_dirty_due_idx` ON `skill_recommend_state` (`dirty`,`next_update_at`);--> statement-breakpoint
CREATE INDEX `skill_recommend_state_due_idx` ON `skill_recommend_state` (`next_update_at`);--> statement-breakpoint
CREATE INDEX `skill_recommend_state_algo_dirty_idx` ON `skill_recommend_state` (`algo_version`,`dirty`);--> statement-breakpoint
CREATE INDEX `skill_recommend_state_precomputed_null_idx` ON `skill_recommend_state` (`skill_id`) WHERE "skill_recommend_state"."precomputed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_recommend_state_next_update_null_idx` ON `skill_recommend_state` (`skill_id`) WHERE "skill_recommend_state"."next_update_at" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_recommend_state_algo_null_idx` ON `skill_recommend_state` (`skill_id`) WHERE "skill_recommend_state"."algo_version" IS NULL;
