CREATE INDEX `skill_related_state_precomputed_null_idx` ON `skill_related_state` (`skill_id`) WHERE "skill_related_state"."precomputed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_related_state_next_update_null_idx` ON `skill_related_state` (`skill_id`) WHERE "skill_related_state"."next_update_at" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_related_state_algo_null_idx` ON `skill_related_state` (`skill_id`) WHERE "skill_related_state"."algo_version" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_search_state_precomputed_null_idx` ON `skill_search_state` (`skill_id`) WHERE "skill_search_state"."precomputed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_search_state_next_update_null_idx` ON `skill_search_state` (`skill_id`) WHERE "skill_search_state"."next_update_at" IS NULL;--> statement-breakpoint
CREATE INDEX `skill_search_state_algo_null_idx` ON `skill_search_state` (`skill_id`) WHERE "skill_search_state"."algo_version" IS NULL;