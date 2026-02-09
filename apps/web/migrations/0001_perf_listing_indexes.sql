CREATE INDEX IF NOT EXISTS `skills_visibility_trending_desc_idx`
ON `skills` (`visibility`, `trending_score` DESC);

CREATE INDEX IF NOT EXISTS `skills_visibility_stars_desc_idx`
ON `skills` (`visibility`, `stars` DESC);

CREATE INDEX IF NOT EXISTS `skills_visibility_recent_expr_idx`
ON `skills` (`visibility`, COALESCE(`last_commit_at`, `indexed_at`) DESC);
