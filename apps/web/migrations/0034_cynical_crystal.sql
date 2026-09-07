DROP INDEX `skill_recommend_state_dirty_due_idx`;--> statement-breakpoint
DROP INDEX `skill_recommend_state_due_idx`;--> statement-breakpoint
CREATE INDEX `skill_recommend_state_dirty_due_idx` ON `skill_recommend_state` (`dirty`,`next_update_at`,`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_recommend_state_due_idx` ON `skill_recommend_state` (`next_update_at`,`skill_id`);--> statement-breakpoint
DROP INDEX `skill_search_state_dirty_due_idx`;--> statement-breakpoint
DROP INDEX `skill_search_state_due_idx`;--> statement-breakpoint
CREATE INDEX `skill_search_state_dirty_due_idx` ON `skill_search_state` (`dirty`,`next_update_at`,`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_search_state_due_idx` ON `skill_search_state` (`next_update_at`,`skill_id`);