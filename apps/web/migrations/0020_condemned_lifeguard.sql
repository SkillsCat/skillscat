CREATE INDEX `skills_security_source_updated_idx` ON `skills` (updated_at DESC,`id`) WHERE COALESCE("skills"."file_structure", '') != '' OR COALESCE("skills"."readme", '') != '';--> statement-breakpoint
CREATE INDEX `skills_security_reindex_backfill_idx` ON `skills` (updated_at DESC,`id`) WHERE "skills"."source_type" = 'github'
        AND "skills"."repo_owner" IS NOT NULL
        AND "skills"."repo_name" IS NOT NULL
        AND COALESCE("skills"."file_structure", '') = ''
        AND COALESCE("skills"."readme", '') = '';