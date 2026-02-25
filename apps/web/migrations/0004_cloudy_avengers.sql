CREATE INDEX `skill_categories_category_skill_idx` ON `skill_categories` (`category_slug`,`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_tags_tag_skill_idx` ON `skill_tags` (`tag`,`skill_id`);--> statement-breakpoint
CREATE INDEX `skills_repo_visibility_trending_idx` ON `skills` (`repo_owner`,`visibility`,`trending_score`);