import type { SkillCardData } from '$lib/types';
import { buildRecentActivitySortSql, buildTopRatedSortScoreSql } from '$lib/server/ranking';
import { LIST_CACHE_MAX_AGE_MS } from '$lib/server/db/shared/constants';
import { buildListCacheKeys } from '$lib/server/db/shared/cache';
import { addCategoriesToSkills, hydrateCachedSkills, normalizeCachedSkill } from '$lib/server/db/shared/skills';
import type { CachedSkillCardRaw, DbEnv, SkillListRow } from '$lib/server/db/shared/types';

/**
 * 从 R2 缓存读取列表数据
 */
export async function getCachedList(
  r2: R2Bucket | undefined,
  key: string,
  cacheVersion?: string,
  options?: {
    maxAgeMs?: number;
  }
): Promise<{ data: SkillCardData[]; generatedAt: number } | null> {
  if (!r2) return null;

  try {
    const cacheKeys = buildListCacheKeys(key, cacheVersion);
    const primaryKey = cacheKeys[0];

    for (const cacheKey of cacheKeys) {
      const object = await r2.get(cacheKey);
      if (!object) continue;

      const text = await object.text();
      const parsed = JSON.parse(text) as {
        data?: CachedSkillCardRaw[];
        generatedAt?: number;
      };

      if (!Array.isArray(parsed.data)) {
        continue;
      }

      const generatedAt = Number(parsed.generatedAt);
      if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
        continue;
      }

      const maxAgeMs = options?.maxAgeMs;
      if (typeof maxAgeMs === 'number' && maxAgeMs > 0) {
        const ageMs = Date.now() - generatedAt;
        if (ageMs > maxAgeMs) {
          // Remove stale list cache so future requests don't keep probing old payloads.
          void r2.delete(cacheKey);
          continue;
        }
      }

      // If we read from legacy key, promote to versioned key asynchronously.
      if (cacheKey !== primaryKey) {
        void r2.put(primaryKey, text, {
          httpMetadata: { contentType: 'application/json' },
        });
      }

      return {
        data: parsed.data.map(normalizeCachedSkill),
        generatedAt,
      };
    }
    return null;
  } catch (error) {
    console.error(`Error reading cache ${key}:`, error);
    return null;
  }
}

/**
 * 获取 trending skills
 */
export async function getTrendingSkills(
  env: DbEnv,
  limit: number = 12
): Promise<SkillCardData[]> {
  // 先尝试从 R2 缓存读取
  const cached = await getCachedList(env.R2, 'trending', env.CACHE_VERSION, {
    maxAgeMs: LIST_CACHE_MAX_AGE_MS,
  });
  if (cached?.data) {
    const top = cached.data.slice(0, limit);
    if (!env.DB) return top;
    return hydrateCachedSkills(env.DB, top);
  }

  // 从 D1 读取
  if (!env.DB) return [];

  const result = await env.DB.prepare(`
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
    ORDER BY s.trending_score DESC
    LIMIT ?
  `)
    .bind(limit)
    .all<SkillListRow>();

  return addCategoriesToSkills(env.DB, result.results);
}

/**
 * 获取 trending skills (分页版本)
 */
export async function getTrendingSkillsPaginated(
  env: DbEnv,
  page: number = 1,
  limit: number = 24
): Promise<{ skills: SkillCardData[]; total: number }> {
  if (!env.DB) return { skills: [], total: 0 };

  const offset = (page - 1) * limit;
  const queryLimit = offset === 0 ? limit + 1 : limit;

  const result = await env.DB.prepare(`
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
    ORDER BY s.trending_score DESC
    LIMIT ? OFFSET ?
  `)
    .bind(queryLimit, offset)
    .all<SkillListRow>();

  const hasMoreOnFirstPage = offset === 0 && result.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? result.results.slice(0, limit) : result.results;

  let total: number;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'")
      .first<{ total: number }>();
    total = countResult?.total || 0;
  }

  const skills = await addCategoriesToSkills(env.DB, pageRows);

  return {
    skills,
    total,
  };
}

/**
 * 获取最近添加的 skills
 */
export async function getRecentSkills(
  env: DbEnv,
  limit: number = 12
): Promise<SkillCardData[]> {
  // 先尝试从 R2 缓存读取
  const cached = await getCachedList(env.R2, 'recent', env.CACHE_VERSION, {
    maxAgeMs: LIST_CACHE_MAX_AGE_MS,
  });
  if (cached?.data) {
    const top = cached.data.slice(0, limit);
    if (!env.DB) return top;
    return hydrateCachedSkills(env.DB, top);
  }

  // 从 D1 读取
  if (!env.DB) return [];

  const result = await env.DB.prepare(`
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
    ORDER BY CASE
      WHEN s.last_commit_at IS NULL THEN s.indexed_at
      ELSE s.last_commit_at
    END DESC
    LIMIT ?
  `)
    .bind(limit)
    .all<SkillListRow>();

  return addCategoriesToSkills(env.DB, result.results);
}

/**
 * 获取最近添加的 skills (分页版本)
 */
export async function getRecentSkillsPaginated(
  env: DbEnv,
  page: number = 1,
  limit: number = 24
): Promise<{ skills: SkillCardData[]; total: number }> {
  if (!env.DB) return { skills: [], total: 0 };

  const offset = (page - 1) * limit;
  const queryLimit = offset === 0 ? limit + 1 : limit;

  const result = await env.DB.prepare(`
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
    ORDER BY CASE
      WHEN s.last_commit_at IS NULL THEN s.indexed_at
      ELSE s.last_commit_at
    END DESC
    LIMIT ? OFFSET ?
  `)
    .bind(queryLimit, offset)
    .all<SkillListRow>();

  const hasMoreOnFirstPage = offset === 0 && result.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? result.results.slice(0, limit) : result.results;

  let total: number;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'")
      .first<{ total: number }>();
    total = countResult?.total || 0;
  }

  const skills = await addCategoriesToSkills(env.DB, pageRows);

  return {
    skills,
    total,
  };
}

/**
 * 获取 top skills (stars-dominant weighted ranking)
 */
export async function getTopSkills(
  env: DbEnv,
  limit: number = 12
): Promise<SkillCardData[]> {
  const topRatedSortScoreSql = buildTopRatedSortScoreSql('stars', 'download_count_90d');
  const recentActivitySortSql = buildRecentActivitySortSql('last_commit_at', 'updated_at');
  // 先尝试从 R2 缓存读取
  const cached = await getCachedList(env.R2, 'top', env.CACHE_VERSION, {
    maxAgeMs: LIST_CACHE_MAX_AGE_MS,
  });
  if (cached?.data) {
    const top = cached.data.slice(0, limit);
    if (!env.DB) return top;
    return hydrateCachedSkills(env.DB, top);
  }

  // 从 D1 读取
  if (!env.DB) return [];

  const result = await env.DB.prepare(`
    WITH ranked AS (
      SELECT
        id,
        name,
        slug,
        description,
        repo_owner as repoOwner,
        repo_name as repoName,
        stars,
        forks,
        trending_score as trendingScore,
        COALESCE(last_commit_at, updated_at) as updatedAt
      FROM skills INDEXED BY skills_top_public_rank_expr_idx
      WHERE visibility = 'public'
      ORDER BY ${topRatedSortScoreSql} DESC, download_count_90d DESC, download_count_30d DESC,
               stars DESC, trending_score DESC,
               ${recentActivitySortSql} DESC
      LIMIT ?
    )
    SELECT ranked.*, a.avatar_url as authorAvatar
    FROM ranked
    LEFT JOIN authors a ON ranked.repoOwner = a.username
  `)
    .bind(limit)
    .all<SkillListRow>();

  return addCategoriesToSkills(env.DB, result.results);
}

/**
 * 获取 top skills (分页版本)
 */
export async function getTopSkillsPaginated(
  env: DbEnv,
  page: number = 1,
  limit: number = 24
): Promise<{ skills: SkillCardData[]; total: number }> {
  if (!env.DB) return { skills: [], total: 0 };

  const offset = (page - 1) * limit;
  const queryLimit = offset === 0 ? limit + 1 : limit;
  const topRatedSortScoreSql = buildTopRatedSortScoreSql('stars', 'download_count_90d');
  const recentActivitySortSql = buildRecentActivitySortSql('last_commit_at', 'updated_at');

  const result = await env.DB.prepare(`
    WITH ranked AS (
      SELECT
        id,
        name,
        slug,
        description,
        repo_owner as repoOwner,
        repo_name as repoName,
        stars,
        forks,
        trending_score as trendingScore,
        COALESCE(last_commit_at, updated_at) as updatedAt
      FROM skills INDEXED BY skills_top_public_rank_expr_idx
      WHERE visibility = 'public'
      ORDER BY ${topRatedSortScoreSql} DESC, download_count_90d DESC, download_count_30d DESC,
               stars DESC, trending_score DESC,
               ${recentActivitySortSql} DESC
      LIMIT ? OFFSET ?
    )
    SELECT ranked.*, a.avatar_url as authorAvatar
    FROM ranked
    LEFT JOIN authors a ON ranked.repoOwner = a.username
  `)
    .bind(queryLimit, offset)
    .all<SkillListRow>();

  const hasMoreOnFirstPage = offset === 0 && result.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? result.results.slice(0, limit) : result.results;

  let total: number;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM skills
      WHERE visibility = 'public'
    `)
      .first<{ total: number }>();
    total = countResult?.total || 0;
  }

  const skills = await addCategoriesToSkills(env.DB, pageRows);

  return {
    skills,
    total,
  };
}

/**
 * 获取分类下的 skills
 */
export async function getSkillsByCategory(
  env: DbEnv,
  categorySlug: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ skills: SkillCardData[]; total: number }> {
  if (!env.DB) return { skills: [], total: 0 };
  const queryLimit = offset === 0 ? limit + 1 : limit;

  const result = await env.DB.prepare(`
    WITH matched AS (
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
        CASE
          WHEN s.classification_method = 'direct' THEN 0
          WHEN s.classification_method = 'ai' THEN 1
          WHEN s.classification_method = 'keyword' THEN 2
          ELSE 3
        END as classificationRank
      FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
      JOIN skills s ON s.id = sc.skill_id
      WHERE sc.category_slug = ?
        AND s.visibility = 'public'
      ORDER BY classificationRank ASC, s.trending_score DESC
      LIMIT ? OFFSET ?
    )
    SELECT matched.*, a.avatar_url as authorAvatar
    FROM matched
    LEFT JOIN authors a ON matched.repoOwner = a.username
    ORDER BY matched.classificationRank ASC, matched.trendingScore DESC
  `)
    .bind(categorySlug, queryLimit, offset)
    .all<SkillListRow>();

  const hasMoreOnFirstPage = offset === 0 && result.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? result.results.slice(0, limit) : result.results;

  let total: number;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
      JOIN skills s ON s.id = sc.skill_id
      WHERE sc.category_slug = ?
        AND s.visibility = 'public'
    `)
      .bind(categorySlug)
      .first<{ total: number }>();
    total = countResult?.total || 0;
  }

  const skills = await addCategoriesToSkills(env.DB, pageRows);

  return {
    skills,
    total,
  };
}

/**
 * 获取分类下的 skills (分页版本)
 */
export async function getSkillsByCategoryPaginated(
  env: DbEnv,
  categorySlug: string,
  page: number = 1,
  limit: number = 24
): Promise<{ skills: SkillCardData[]; total: number }> {
  const offset = (page - 1) * limit;
  return getSkillsByCategory(env, categorySlug, limit, offset);
}
