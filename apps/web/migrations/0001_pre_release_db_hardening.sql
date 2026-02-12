-- Pre-release hardening migration
-- 1) enforce slug uniqueness
-- 2) normalize root skill path semantics (NULL and '' treated as same path)
-- 3) add missing org_id index for organization-related lookups
-- 4) drop redundant indexes covered by UNIQUE constraints

PRAGMA foreign_keys = OFF;

-- Drop redundant non-unique indexes (covered by UNIQUE indexes)
DROP INDEX IF EXISTS `skills_slug_idx`;
DROP INDEX IF EXISTS `api_tokens_hash_idx`;
DROP INDEX IF EXISTS `refresh_tokens_hash_idx`;
DROP INDEX IF EXISTS `device_codes_device_code_idx`;
DROP INDEX IF EXISTS `device_codes_user_code_idx`;
DROP INDEX IF EXISTS `categories_slug_idx`;

-- Rebuild repo-path uniqueness to make NULL and '' equivalent
DROP INDEX IF EXISTS `skills_repo_path_unique`;
UPDATE `skills`
SET `skill_path` = ''
WHERE `skill_path` IS NULL;

CREATE UNIQUE INDEX `skills_repo_path_unique`
ON `skills` (`repo_owner`, `repo_name`, COALESCE(`skill_path`, ''));

-- Enforce global slug uniqueness at DB level
CREATE UNIQUE INDEX `skills_slug_unique` ON `skills` (`slug`);

-- Add org-centric index for org skills listing and permission queries
CREATE INDEX `skills_org_stars_created_idx` ON `skills` (`org_id`, `stars`, `created_at`);

PRAGMA foreign_keys = ON;
