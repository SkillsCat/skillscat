import type { SkillCardData } from '$lib/types';
import { normalizeSearchText } from '$lib/server/ranking/search-precompute';
import { buildPrefixRange } from '$lib/server/text/prefix-range';
import {
  SEARCH_PAGE_MAX_FUZZY_HEAD_SCAN,
  SEARCH_PAGE_MIN_FUZZY_HEAD_SCAN,
  SEARCH_PAGE_FUZZY_HEAD_SCAN_MULTIPLIER,
} from '$lib/server/db/shared/constants';
import { addCategoriesToSkills } from '$lib/server/db/shared/skills';
import type { DbEnv, SkillListRow } from '$lib/server/db/shared/types';

/**
 * 搜索 skills
 */
export async function searchSkills(
  env: DbEnv,
  query: string,
  limit: number = 50
): Promise<SkillCardData[]> {
  if (!env.DB || !query) return [];

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const prefixRange = buildPrefixRange(normalizedQuery);
  const prefixTerm = `${normalizedQuery}%`;
  const fuzzyTerm = `%${normalizedQuery}%`;
  const prefixPerColumnLimit = Math.max(limit, Math.ceil(limit / 2));
  const prefixParams = prefixRange.end
    ? [prefixRange.start, prefixRange.end, prefixTerm]
    : [prefixRange.start, prefixTerm];

  const prefixResult = await env.DB.prepare(`
    WITH prefix_ids AS (
      SELECT id FROM (
        SELECT id
        FROM skills INDEXED BY skills_visibility_lower_name_idx
        WHERE visibility = 'public'
          AND LOWER(name) >= ?
          ${prefixRange.end ? 'AND LOWER(name) < ?' : ''}
          AND LOWER(name) LIKE ?
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills INDEXED BY skills_visibility_lower_slug_idx
        WHERE visibility = 'public'
          AND LOWER(slug) >= ?
          ${prefixRange.end ? 'AND LOWER(slug) < ?' : ''}
          AND LOWER(slug) LIKE ?
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills INDEXED BY skills_visibility_lower_repo_owner_idx
        WHERE visibility = 'public'
          AND LOWER(repo_owner) >= ?
          ${prefixRange.end ? 'AND LOWER(repo_owner) < ?' : ''}
          AND LOWER(repo_owner) LIKE ?
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills INDEXED BY skills_visibility_lower_repo_name_idx
        WHERE visibility = 'public'
          AND LOWER(repo_name) >= ?
          ${prefixRange.end ? 'AND LOWER(repo_name) < ?' : ''}
          AND LOWER(repo_name) LIKE ?
        LIMIT ?
      )
    ),
    dedup_ids AS (
      SELECT id
      FROM prefix_ids
      GROUP BY id
      LIMIT ?
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      s.forks,
      s.trending_score as trendingScore,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      a.avatar_url as authorAvatar
    FROM dedup_ids d
    JOIN skills s ON s.id = d.id
    LEFT JOIN authors a ON s.repo_owner = a.username
    ORDER BY
      CASE
        WHEN LOWER(s.name) = ? THEN 0
        WHEN LOWER(s.slug) = ? THEN 1
        WHEN LOWER(s.repo_owner) = ? THEN 2
        WHEN LOWER(s.repo_name) = ? THEN 3
        WHEN LOWER(s.name) LIKE ? THEN 4
        WHEN LOWER(s.slug) LIKE ? THEN 5
        WHEN LOWER(s.repo_owner) LIKE ? THEN 6
        WHEN LOWER(s.repo_name) LIKE ? THEN 7
        ELSE 8
      END ASC,
      s.trending_score DESC
    LIMIT ?
  `)
    .bind(
      ...prefixParams,
      prefixPerColumnLimit,
      ...prefixParams,
      prefixPerColumnLimit,
      ...prefixParams,
      prefixPerColumnLimit,
      ...prefixParams,
      prefixPerColumnLimit,
      limit,
      normalizedQuery,
      normalizedQuery,
      normalizedQuery,
      normalizedQuery,
      prefixTerm,
      prefixTerm,
      prefixTerm,
      prefixTerm,
      limit
    )
    .all<SkillListRow>();

  const merged = new Map<string, SkillListRow>();
  for (const row of prefixResult.results || []) {
    merged.set(row.id, row);
  }

  const fuzzyBudget = Math.min(
    Math.max(0, limit - merged.size),
    Math.max(8, Math.ceil(limit / 3))
  );

  if (fuzzyBudget > 0) {
    const excludedIds = Array.from(merged.keys());
    const exclusionSql = excludedIds.length > 0
      ? `AND s.id NOT IN (${excludedIds.map(() => '?').join(',')})`
      : '';
    const fuzzyHeadLimit = Math.min(
      SEARCH_PAGE_MAX_FUZZY_HEAD_SCAN,
      Math.max(SEARCH_PAGE_MIN_FUZZY_HEAD_SCAN, fuzzyBudget * SEARCH_PAGE_FUZZY_HEAD_SCAN_MULTIPLIER)
    );

    const fuzzyResult = await env.DB.prepare(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.description,
        s.repo_owner as repoOwner,
        s.repo_name as repoName,
        s.stars,
        s.forks,
        s.trending_score as trendingScore,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
        a.avatar_url as authorAvatar
      FROM skills s
      LEFT JOIN authors a ON s.repo_owner = a.username
      WHERE s.visibility = 'public'
        ${exclusionSql}
      ORDER BY s.trending_score DESC
      LIMIT ?
    `)
      .bind(
        ...excludedIds,
        fuzzyHeadLimit
      )
      .all<SkillListRow>();

    const fuzzyTargetSize = merged.size + fuzzyBudget;
    for (const row of fuzzyResult.results || []) {
      const name = normalizeSearchText(row.name);
      const slug = normalizeSearchText(row.slug);
      const owner = normalizeSearchText(row.repoOwner);
      const repo = normalizeSearchText(row.repoName);
      const description = normalizeSearchText(row.description);

      if (
        !name.includes(normalizedQuery)
        && !slug.includes(normalizedQuery)
        && !owner.includes(normalizedQuery)
        && !repo.includes(normalizedQuery)
        && !description.includes(normalizedQuery)
      ) {
        continue;
      }

      if (!merged.has(row.id)) {
        merged.set(row.id, row);
      }
      if (merged.size >= fuzzyTargetSize) break;
    }
  }

  if (merged.size < limit) {
    const excludedIds = Array.from(merged.keys());
    const exclusionSql = excludedIds.length > 0
      ? `AND s.id NOT IN (${excludedIds.map(() => '?').join(',')})`
      : '';
    const remaining = Math.max(0, limit - merged.size);

    if (remaining > 0) {
      // The full search page is query-by-query cached and user-driven, so we keep
      // a deeper fuzzy fallback here to preserve long-tail recall.
      const deepFuzzyResult = await env.DB.prepare(`
        SELECT
          s.id,
          s.name,
          s.slug,
          s.description,
          s.repo_owner as repoOwner,
          s.repo_name as repoName,
          s.stars,
          s.forks,
          s.trending_score as trendingScore,
          COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
          a.avatar_url as authorAvatar
        FROM skills s
        LEFT JOIN authors a ON s.repo_owner = a.username
        WHERE s.visibility = 'public'
          AND (
            LOWER(s.name) LIKE ?
            OR LOWER(s.slug) LIKE ?
            OR LOWER(s.repo_owner) LIKE ?
            OR LOWER(s.repo_name) LIKE ?
            OR LOWER(COALESCE(s.description, '')) LIKE ?
          )
          ${exclusionSql}
        ORDER BY s.trending_score DESC
        LIMIT ?
      `)
        .bind(
          fuzzyTerm,
          fuzzyTerm,
          fuzzyTerm,
          fuzzyTerm,
          fuzzyTerm,
          ...excludedIds,
          remaining
        )
        .all<SkillListRow>();

      for (const row of deepFuzzyResult.results || []) {
        if (!merged.has(row.id)) {
          merged.set(row.id, row);
        }
      }
    }
  }

  return addCategoriesToSkills(env.DB, Array.from(merged.values()).slice(0, limit));
}
