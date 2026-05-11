DROP INDEX `skills_top_public_rank_expr_idx`;--> statement-breakpoint
CREATE INDEX `skills_top_public_rank_expr_idx` ON `skills` ((((CASE
    WHEN (CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END) <= 1000 THEN CAST((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END) AS REAL)
    ELSE
      1000.0
      + (1000.0 * (LOG(1.0 + (((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END) - 1000.0) / 1000.0)) * 2.302585092994046))
    END)) * ((0.96
    + (1.0 - 0.96) * (CASE
    WHEN LOG(((CASE WHEN (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) < 0 THEN 0 ELSE (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) END)) + 1) <= 0 OR LOG(((2
    + (LOG(((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END)) + 1) / LOG(2.0)) * 6)) + 1) <= 0 THEN 0
    WHEN ((LOG(((CASE WHEN (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) < 0 THEN 0 ELSE (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) END)) + 1) / LOG(2.0)) / (LOG(((2
    + (LOG(((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END)) + 1) / LOG(2.0)) * 6)) + 1) / LOG(2.0))) < 1.0 THEN ((LOG(((CASE WHEN (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) < 0 THEN 0 ELSE (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) END)) + 1) / LOG(2.0)) / (LOG(((2
    + (LOG(((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END)) + 1) / LOG(2.0)) * 6)) + 1) / LOG(2.0)))
    ELSE 1.0
  END))) * ((0.78
    + (1.0 - 0.78) * (CASE
    WHEN (30
    + (LOG(((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END)) + 1) / LOG(2.0)) * 6) <= 0 THEN 1.0
    WHEN (((CASE WHEN (CASE WHEN trending_score IS NULL THEN 0 ELSE trending_score END) < 0 THEN 0 ELSE (CASE WHEN trending_score IS NULL THEN 0 ELSE trending_score END) END)) / ((30
    + (LOG(((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END)) + 1) / LOG(2.0)) * 6))) < 1.0 THEN (((CASE WHEN (CASE WHEN trending_score IS NULL THEN 0 ELSE trending_score END) < 0 THEN 0 ELSE (CASE WHEN trending_score IS NULL THEN 0 ELSE trending_score END) END)) / ((30
    + (LOG(((CASE WHEN (CASE WHEN stars IS NULL THEN 0 ELSE stars END) < 0 THEN 0 ELSE (CASE WHEN stars IS NULL THEN 0 ELSE stars END) END)) + 1) / LOG(2.0)) * 6)))
    ELSE 1.0
  END))) + ((CASE
    WHEN ((LOG(((CASE WHEN (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) < 0 THEN 0 ELSE (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) END)) + 1) / LOG(2.0)) * 3) < 24 THEN ((LOG(((CASE WHEN (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) < 0 THEN 0 ELSE (CASE WHEN download_count_90d IS NULL THEN 0 ELSE download_count_90d END) END)) + 1) / LOG(2.0)) * 3)
    ELSE 24
  END))) DESC,stars DESC,download_count_90d DESC,download_count_30d DESC,trending_score DESC,CASE WHEN last_commit_at IS NULL THEN updated_at ELSE last_commit_at END DESC) WHERE visibility = 'public';