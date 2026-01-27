-- Migration: Add skill_tags table and unique index for multi-skill repos
-- This migration supports multiple skills per repository

-- Set existing skills to have empty skill_path (normalize NULL to empty string)
UPDATE skills SET skill_path = '' WHERE skill_path IS NULL;

--> statement-breakpoint

-- Add unique constraint on (repo_owner, repo_name, skill_path)
-- This allows multiple skills from the same repo with different paths
CREATE UNIQUE INDEX IF NOT EXISTS `skills_repo_path_unique` ON `skills` (`repo_owner`, `repo_name`, `skill_path`);

--> statement-breakpoint

-- Create skill_tags table for storing tags from SKILL.md frontmatter
CREATE TABLE IF NOT EXISTS `skill_tags` (
	`skill_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`skill_id`, `tag`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint

-- Index for efficient tag lookups
CREATE INDEX IF NOT EXISTS `skill_tags_tag_idx` ON `skill_tags` (`tag`);
