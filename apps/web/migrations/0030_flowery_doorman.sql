CREATE INDEX `skills_public_category_rank_idx` ON `skills` (CASE
        WHEN classification_method = 'direct' THEN 0
        WHEN classification_method = 'ai' THEN 1
        WHEN classification_method = 'keyword' THEN 2
        ELSE 3
      END ASC,trending_score DESC,`id`) WHERE "skills"."visibility" = 'public';