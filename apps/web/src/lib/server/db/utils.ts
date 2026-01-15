/**
 * Database utility functions for D1 and R2
 */

import type { SkillCardData, SkillDetail } from '$lib/types';

export interface DbEnv {
  DB?: D1Database;
  R2?: R2Bucket;
  KV?: KVNamespace;
}

/**
 * 从 R2 缓存读取列表数据
 */
export async function getCachedList(
  r2: R2Bucket | undefined,
  key: string
): Promise<{ data: SkillCardData[]; generatedAt: number } | null> {
  if (!r2) return null;

  try {
    const object = await r2.get(`cache/${key}.json`);
    if (!object) return null;

    const text = await object.text();
    return JSON.parse(text);
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
  const cached = await getCachedList(env.R2, 'trending');
  if (cached?.data) {
    return cached.data.slice(0, limit);
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
      s.updated_at as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    ORDER BY s.trending_score DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
}

/**
 * 获取最近添加的 skills
 */
export async function getRecentSkills(
  env: DbEnv,
  limit: number = 12
): Promise<SkillCardData[]> {
  // 先尝试从 R2 缓存读取
  const cached = await getCachedList(env.R2, 'recent');
  if (cached?.data) {
    return cached.data.slice(0, limit);
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
      s.updated_at as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    ORDER BY s.indexed_at DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
}

/**
 * 获取 top skills (by stars)
 */
export async function getTopSkills(
  env: DbEnv,
  limit: number = 12
): Promise<SkillCardData[]> {
  // 先尝试从 R2 缓存读取
  const cached = await getCachedList(env.R2, 'top');
  if (cached?.data) {
    return cached.data.slice(0, limit);
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
      s.updated_at as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    ORDER BY s.stars DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
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
      s.updated_at as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    JOIN skill_categories sc ON s.id = sc.skill_id
    LEFT JOIN authors a ON s.author_id = a.id
    WHERE sc.category_slug = ?
    ORDER BY s.trending_score DESC
    LIMIT ? OFFSET ?
  `)
    .bind(categorySlug, limit, offset)
    .all();

  const countResult = await env.DB.prepare(`
    SELECT COUNT(*) as total FROM skill_categories WHERE category_slug = ?
  `)
    .bind(categorySlug)
    .first<{ total: number }>();

  const skills = await addCategoriesToSkills(env.DB, result.results as any[]);

  return {
    skills,
    total: countResult?.total || 0,
  };
}

/**
 * 搜索 skills
 */
export async function searchSkills(
  env: DbEnv,
  query: string,
  limit: number = 50
): Promise<SkillCardData[]> {
  if (!env.DB || !query) return [];

  const searchTerm = `%${query}%`;

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
      s.updated_at as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    WHERE s.name LIKE ? OR s.description LIKE ? OR s.repo_owner LIKE ?
    ORDER BY s.trending_score DESC
    LIMIT ?
  `)
    .bind(searchTerm, searchTerm, searchTerm, limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
}

/**
 * 获取 skill 详情
 */
export async function getSkillBySlug(
  env: DbEnv,
  slug: string
): Promise<SkillDetail | null> {
  if (!env.DB) return null;

  const result = await env.DB.prepare(`
    SELECT
      s.*,
      a.username as authorUsername,
      a.display_name as authorDisplayName,
      a.avatar_url as authorAvatar,
      a.bio as authorBio,
      a.skills_count as authorSkillsCount,
      a.total_stars as authorTotalStars
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    WHERE s.slug = ?
  `)
    .bind(slug)
    .first();

  if (!result) return null;

  // 获取分类
  const categories = await env.DB.prepare(`
    SELECT category_slug FROM skill_categories WHERE skill_id = ?
  `)
    .bind((result as any).id)
    .all();

  // 从 R2 读取 SKILL.md 内容
  let readme = (result as any).readme;
  if (env.R2 && !readme) {
    const r2Path = `skills/${(result as any).repo_owner}/${(result as any).repo_name}/SKILL.md`;
    try {
      const object = await env.R2.get(r2Path);
      if (object) {
        readme = await object.text();
      }
    } catch (error) {
      console.error('Error reading SKILL.md from R2:', error);
    }
  }

  // 解析文件结构
  let fileStructure = [];
  try {
    if ((result as any).file_structure) {
      fileStructure = JSON.parse((result as any).file_structure);
    }
  } catch {}

  return {
    id: (result as any).id,
    name: (result as any).name,
    slug: (result as any).slug,
    description: (result as any).description,
    repoOwner: (result as any).repo_owner,
    repoName: (result as any).repo_name,
    githubUrl: (result as any).github_url || `https://github.com/${(result as any).repo_owner}/${(result as any).repo_name}`,
    stars: (result as any).stars,
    forks: (result as any).forks,
    trendingScore: (result as any).trending_score,
    updatedAt: (result as any).updated_at,
    indexedAt: (result as any).indexed_at,
    readme,
    fileStructure,
    categories: categories.results.map((c: any) => c.category_slug),
    authorAvatar: (result as any).authorAvatar,
    authorUsername: (result as any).authorUsername,
    authorDisplayName: (result as any).authorDisplayName,
    authorBio: (result as any).authorBio,
    authorSkillsCount: (result as any).authorSkillsCount,
    authorTotalStars: (result as any).authorTotalStars,
  };
}

/**
 * 获取相关 skills
 */
export async function getRelatedSkills(
  env: DbEnv,
  skillId: string,
  categories: string[],
  limit: number = 10
): Promise<SkillCardData[]> {
  if (!env.DB || categories.length === 0) return [];

  const placeholders = categories.map(() => '?').join(',');

  const result = await env.DB.prepare(`
    SELECT DISTINCT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      s.forks,
      s.trending_score as trendingScore,
      s.updated_at as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    JOIN skill_categories sc ON s.id = sc.skill_id
    LEFT JOIN authors a ON s.author_id = a.id
    WHERE sc.category_slug IN (${placeholders}) AND s.id != ?
    ORDER BY s.stars DESC
    LIMIT ?
  `)
    .bind(...categories, skillId, limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
}

/**
 * 获取统计数据
 */
export async function getStats(env: DbEnv): Promise<{ totalSkills: number }> {
  if (!env.DB) return { totalSkills: 0 };

  const result = await env.DB.prepare('SELECT COUNT(*) as total FROM skills').first<{ total: number }>();

  return {
    totalSkills: result?.total || 0,
  };
}

/**
 * 获取分类统计
 */
export async function getCategoryStats(
  env: DbEnv
): Promise<Record<string, number>> {
  if (!env.DB) return {};

  const result = await env.DB.prepare(`
    SELECT category_slug, COUNT(*) as count
    FROM skill_categories
    GROUP BY category_slug
  `).all();

  const stats: Record<string, number> = {};
  for (const row of result.results as any[]) {
    stats[row.category_slug] = row.count;
  }

  return stats;
}

/**
 * 为 skills 添加分类信息
 */
async function addCategoriesToSkills(
  db: D1Database,
  skills: any[]
): Promise<SkillCardData[]> {
  if (skills.length === 0) return [];

  const skillIds = skills.map((s) => s.id);
  const placeholders = skillIds.map(() => '?').join(',');

  const categories = await db.prepare(`
    SELECT skill_id, category_slug FROM skill_categories
    WHERE skill_id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all();

  const categoriesMap: Record<string, string[]> = {};
  for (const cat of categories.results as any[]) {
    if (!categoriesMap[cat.skill_id]) {
      categoriesMap[cat.skill_id] = [];
    }
    categoriesMap[cat.skill_id].push(cat.category_slug);
  }

  return skills.map((skill) => ({
    ...skill,
    categories: categoriesMap[skill.id] || [],
  }));
}
