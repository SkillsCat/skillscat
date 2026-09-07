CREATE TABLE `discovery_daily_stats` (
	`day` text NOT NULL,
	`source` text NOT NULL,
	`queued` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`indexed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `source`)
);
--> statement-breakpoint
CREATE TABLE `skill_localizations` (
	`skill_id` text NOT NULL,
	`locale` text NOT NULL,
	`summary` text,
	`source_hash` text NOT NULL,
	`generation_version` text NOT NULL,
	`updated_at` integer NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`skill_id`, `locale`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_localizations_locale_updated_idx` ON `skill_localizations` (`locale`,`updated_at`,`skill_id`);--> statement-breakpoint
ALTER TABLE `skills` ADD `first_published_at` integer;--> statement-breakpoint
ALTER TABLE `skills` ADD `content_updated_at` integer;--> statement-breakpoint
CREATE INDEX `skills_public_first_published_idx` ON `skills` (CASE WHEN first_published_at IS NOT NULL THEN first_published_at WHEN created_at IS NOT NULL THEN created_at ELSE indexed_at END DESC,`id`) WHERE "skills"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX `skills_public_seo_freshness_idx` ON `skills` (CASE WHEN (CASE WHEN first_published_at IS NOT NULL THEN first_published_at WHEN created_at IS NOT NULL THEN created_at ELSE indexed_at END) > (CASE WHEN content_updated_at > (CASE WHEN last_commit_at IS NOT NULL THEN last_commit_at ELSE updated_at END) THEN content_updated_at ELSE (CASE WHEN last_commit_at IS NOT NULL THEN last_commit_at ELSE updated_at END) END) THEN (CASE WHEN first_published_at IS NOT NULL THEN first_published_at WHEN created_at IS NOT NULL THEN created_at ELSE indexed_at END) ELSE (CASE WHEN content_updated_at > (CASE WHEN last_commit_at IS NOT NULL THEN last_commit_at ELSE updated_at END) THEN content_updated_at ELSE (CASE WHEN last_commit_at IS NOT NULL THEN last_commit_at ELSE updated_at END) END) END DESC,`slug`) WHERE "skills"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX `skills_public_content_updated_idx` ON `skills` (`content_updated_at`,`slug`) WHERE "skills"."visibility" = 'public';