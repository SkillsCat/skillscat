/**
 * Database utility functions for D1 and R2
 */

import type { SkillCardData, SkillDetail } from '$lib/types';

export interface DbEnv {
  DB?: D1Database;
  R2?: R2Bucket;
  KV?: KVNamespace;
  WORKER_SECRET?: string;
  RESURRECTION_WORKER_URL?: string;
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY s.trending_score DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY s.trending_score DESC
    LIMIT ? OFFSET ?
  `)
    .bind(limit, offset)
    .all();

  const countResult = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'")
    .first<{ total: number }>();

  const skills = await addCategoriesToSkills(env.DB, result.results as any[]);

  return {
    skills,
    total: countResult?.total || 0,
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY COALESCE(s.last_commit_at, s.indexed_at) DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY COALESCE(s.last_commit_at, s.indexed_at) DESC
    LIMIT ? OFFSET ?
  `)
    .bind(limit, offset)
    .all();

  const countResult = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'")
    .first<{ total: number }>();

  const skills = await addCategoriesToSkills(env.DB, result.results as any[]);

  return {
    skills,
    total: countResult?.total || 0,
  };
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY s.stars DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return addCategoriesToSkills(env.DB, result.results as any[]);
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
      AND (s.skill_path IS NULL OR s.skill_path = '' OR s.skill_path NOT LIKE '.%')
    ORDER BY s.stars DESC
    LIMIT ? OFFSET ?
  `)
    .bind(limit, offset)
    .all();

  const countResult = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public' AND (skill_path IS NULL OR skill_path = '' OR skill_path NOT LIKE '.%')")
    .first<{ total: number }>();

  const skills = await addCategoriesToSkills(env.DB, result.results as any[]);

  return {
    skills,
    total: countResult?.total || 0,
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE sc.category_slug = ? AND s.visibility = 'public'
    ORDER BY s.trending_score DESC
    LIMIT ? OFFSET ?
  `)
    .bind(categorySlug, limit, offset)
    .all();

  const countResult = await env.DB.prepare(`
    SELECT COUNT(*) as total FROM skill_categories sc
    JOIN skills s ON sc.skill_id = s.id
    WHERE sc.category_slug = ? AND s.visibility = 'public'
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
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public' AND (s.name LIKE ? OR s.description LIKE ? OR s.repo_owner LIKE ?)
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
  slug: string,
  userId?: string | null
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
      a.total_stars as authorTotalStars,
      u.name as ownerName,
      u.image as ownerAvatar,
      o.name as orgName,
      o.slug as orgSlug,
      o.avatar_url as orgAvatar
    FROM skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    LEFT JOIN user u ON s.owner_id = u.id
    LEFT JOIN organizations o ON s.org_id = o.id
    WHERE s.slug = ?
  `)
    .bind(slug)
    .first();

  if (!result) return null;

  const skillData = result as any;

  // 权限检查
  if (skillData.visibility === 'private') {
    if (!userId) {
      return null; // 未登录用户无法访问私有 skill
    }

    // 检查是否是所有者
    const isOwner = skillData.owner_id === userId;

    // 检查是否是组织成员
    let isOrgMember = false;
    if (skillData.org_id) {
      const membership = await env.DB.prepare(`
        SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?
      `)
        .bind(skillData.org_id, userId)
        .first();
      isOrgMember = !!membership;
    }

    // 检查是否有显式权限
    let hasPermission = false;
    if (!isOwner && !isOrgMember) {
      const permission = await env.DB.prepare(`
        SELECT 1 FROM skill_permissions
        WHERE skill_id = ? AND grantee_type = 'user' AND grantee_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
      `)
        .bind(skillData.id, userId, Date.now())
        .first();
      hasPermission = !!permission;
    }

    if (!isOwner && !isOrgMember && !hasPermission) {
      return null; // 无权限访问
    }
  }

  // 获取分类
  const categories = await env.DB.prepare(`
    SELECT category_slug FROM skill_categories WHERE skill_id = ?
  `)
    .bind(skillData.id)
    .all();

  // 从 R2 读取 SKILL.md 内容
  let readme = skillData.readme;
  if (env.R2 && !readme) {
    try {
      if (skillData.source_type === 'upload') {
        const slugParts = skillData.slug.split('/');
        const candidatePaths = [
          `skills/${slugParts[0]}/${slugParts[1] || skillData.name}/SKILL.md`,
          `skills/${slugParts[0]}/${skillData.name}/SKILL.md`,
        ];
        for (const path of candidatePaths) {
          const object = await env.R2.get(path);
          if (object) {
            readme = await object.text();
            break;
          }
        }
      } else {
        // Include skill_path in R2 path for multi-skill repos
        const skillPathPart = skillData.skill_path ? `/${skillData.skill_path}` : '';
        const r2Path = `skills/${skillData.repo_owner}/${skillData.repo_name}${skillPathPart}/SKILL.md`;
        const object = await env.R2.get(r2Path);
        if (object) {
          readme = await object.text();
        }
      }
    } catch (error) {
      console.error('Error reading SKILL.md from R2:', error);
    }
  }

  // 解析文件结构 (直接使用预构建的 fileTree)
  let fileStructure: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: any[];
  }> = [];
  try {
    if (skillData.file_structure) {
      const parsed = JSON.parse(skillData.file_structure);
      if (parsed.fileTree && Array.isArray(parsed.fileTree)) {
        fileStructure = parsed.fileTree;
      }
    }
  } catch {}

  return {
    id: skillData.id,
    name: skillData.name,
    slug: skillData.slug,
    description: skillData.description,
    repoOwner: skillData.repo_owner,
    repoName: skillData.repo_name,
    githubUrl: skillData.github_url || (skillData.repo_owner ? `https://github.com/${skillData.repo_owner}/${skillData.repo_name}` : null),
    skillPath: skillData.skill_path || '',
    stars: skillData.stars || 0,
    forks: skillData.forks || 0,
    trendingScore: skillData.trending_score || 0,
    updatedAt: skillData.updated_at,
    lastCommitAt: skillData.last_commit_at || null,
    createdAt: skillData.created_at || skillData.indexed_at,
    indexedAt: skillData.indexed_at,
    readme,
    fileStructure,
    categories: categories.results.map((c: any) => c.category_slug),
    authorAvatar: skillData.authorAvatar,
    authorUsername: skillData.authorUsername,
    authorDisplayName: skillData.authorDisplayName,
    authorBio: skillData.authorBio,
    authorSkillsCount: skillData.authorSkillsCount,
    authorTotalStars: skillData.authorTotalStars,
    // 新增字段
    visibility: skillData.visibility || 'public',
    sourceType: skillData.source_type || 'github',
    ownerId: skillData.owner_id,
    ownerName: skillData.ownerName,
    ownerAvatar: skillData.ownerAvatar,
    orgId: skillData.org_id,
    orgName: skillData.orgName,
    orgSlug: skillData.orgSlug,
    orgAvatar: skillData.orgAvatar,
  };
}

/**
 * 获取相关 skills (tiered candidate discovery + adaptive scoring)
 *
 * Tiered discovery ensures results even when a skill has no categories/tags:
 *   Tier 1: Category overlap | Tier 2: Tag overlap | Tier 3: Same author | Tier 4: Trending fallback
 *
 * Adaptive weights adjust based on available signals (categories, tags, both, neither).
 */
export async function getRelatedSkills(
  env: DbEnv,
  skillId: string,
  categories: string[],
  repoOwner: string = '',
  limit: number = 10
): Promise<SkillCardData[]> {
  if (!env.DB) return [];

  const MIN_CANDIDATES = limit * 2;
  const hasCategories = categories.length > 0;

  // Step 1: Get current skill's tags
  const tagsResult = await env.DB.prepare(
    'SELECT tag FROM skill_tags WHERE skill_id = ?'
  ).bind(skillId).all();
  const skillTags: string[] = (tagsResult.results as any[]).map((r) => r.tag);
  const hasTags = skillTags.length > 0;

  // Step 2: Tiered candidate discovery
  // Each candidate tracks which tier discovered it
  const candidateMap = new Map<string, { data: any; tier: number }>();
  const excludeIds: string[] = [skillId];

  const SKILL_COLUMNS = `
    s.id, s.name, s.slug, s.description,
    s.repo_owner as repoOwner, s.repo_name as repoName,
    s.stars, s.forks, s.trending_score as trendingScore,
    s.updated_at as updatedAt, s.last_commit_at as lastCommitAt,
    a.avatar_url as authorAvatar`;

  const addCandidates = (rows: any[], tier: number) => {
    for (const row of rows) {
      if (!candidateMap.has(row.id)) {
        candidateMap.set(row.id, { data: row, tier });
        excludeIds.push(row.id);
      }
    }
  };

  const excludePlaceholders = () => excludeIds.map(() => '?').join(',');

  // Tier 1: Category overlap
  if (hasCategories) {
    const catPh = categories.map(() => '?').join(',');
    const exPh = excludePlaceholders();
    const result = await env.DB.prepare(`
      SELECT ${SKILL_COLUMNS},
        COUNT(sc.category_slug) as sharedCategoryCount
      FROM skills s
      JOIN skill_categories sc ON s.id = sc.skill_id
      LEFT JOIN authors a ON s.repo_owner = a.username
      WHERE sc.category_slug IN (${catPh})
        AND s.id NOT IN (${exPh})
        AND s.visibility = 'public'
      GROUP BY s.id
      ORDER BY sharedCategoryCount DESC, s.trending_score DESC
      LIMIT 30
    `).bind(...categories, ...excludeIds).all();
    addCandidates(result.results as any[], 1);
  }

  // Tier 2: Tag overlap
  if (hasTags && candidateMap.size < MIN_CANDIDATES) {
    const tagPh = skillTags.map(() => '?').join(',');
    const exPh = excludePlaceholders();
    const result = await env.DB.prepare(`
      SELECT ${SKILL_COLUMNS},
        COUNT(st.tag) as sharedTagCount
      FROM skills s
      JOIN skill_tags st ON s.id = st.skill_id
      LEFT JOIN authors a ON s.repo_owner = a.username
      WHERE st.tag IN (${tagPh})
        AND s.id NOT IN (${exPh})
        AND s.visibility = 'public'
      GROUP BY s.id
      ORDER BY sharedTagCount DESC, s.trending_score DESC
      LIMIT 20
    `).bind(...skillTags, ...excludeIds).all();
    addCandidates(result.results as any[], 2);
  }

  // Tier 3: Same author
  if (repoOwner && candidateMap.size < MIN_CANDIDATES) {
    const exPh = excludePlaceholders();
    const result = await env.DB.prepare(`
      SELECT ${SKILL_COLUMNS}
      FROM skills s
      LEFT JOIN authors a ON s.repo_owner = a.username
      WHERE s.repo_owner = ?
        AND s.id NOT IN (${exPh})
        AND s.visibility = 'public'
      ORDER BY s.trending_score DESC
      LIMIT 10
    `).bind(repoOwner, ...excludeIds).all();
    addCandidates(result.results as any[], 3);
  }

  // Tier 4: Trending fallback
  if (candidateMap.size < MIN_CANDIDATES) {
    const exPh = excludePlaceholders();
    const result = await env.DB.prepare(`
      SELECT ${SKILL_COLUMNS}
      FROM skills s
      LEFT JOIN authors a ON s.repo_owner = a.username
      WHERE s.id NOT IN (${exPh})
        AND s.visibility = 'public'
      ORDER BY s.trending_score DESC
      LIMIT 15
    `).bind(...excludeIds).all();
    addCandidates(result.results as any[], 4);
  }

  if (candidateMap.size === 0) return [];

  const allCandidates = Array.from(candidateMap.values());
  const allIds = allCandidates.map((c) => c.data.id);

  // Step 3: Batch enrichment queries
  const tagOverlapMap: Record<string, number> = {};
  const catOverlapMap: Record<string, number> = {};

  if (hasTags) {
    const idPh = allIds.map(() => '?').join(',');
    const tagPh = skillTags.map(() => '?').join(',');
    const tagResult = await env.DB.prepare(`
      SELECT skill_id, COUNT(*) as cnt
      FROM skill_tags
      WHERE skill_id IN (${idPh}) AND tag IN (${tagPh})
      GROUP BY skill_id
    `).bind(...allIds, ...skillTags).all();
    for (const row of tagResult.results as any[]) {
      tagOverlapMap[row.skill_id] = row.cnt;
    }
  }

  // Category overlap for non-Tier-1 candidates
  const nonTier1Ids = allCandidates
    .filter((c) => c.tier !== 1)
    .map((c) => c.data.id);
  if (hasCategories && nonTier1Ids.length > 0) {
    const idPh = nonTier1Ids.map(() => '?').join(',');
    const catPh = categories.map(() => '?').join(',');
    const catResult = await env.DB.prepare(`
      SELECT skill_id, COUNT(*) as cnt
      FROM skill_categories
      WHERE skill_id IN (${idPh}) AND category_slug IN (${catPh})
      GROUP BY skill_id
    `).bind(...nonTier1Ids, ...categories).all();
    for (const row of catResult.results as any[]) {
      catOverlapMap[row.skill_id] = row.cnt;
    }
  }

  // Step 4: Adaptive weight scoring
  const weights = hasCategories && hasTags
    ? { cat: 0.30, tag: 0.20, author: 0.10, pop: 0.15, fresh: 0.10, disc: 0.15 }
    : hasCategories
    ? { cat: 0.40, tag: 0.00, author: 0.10, pop: 0.20, fresh: 0.15, disc: 0.15 }
    : hasTags
    ? { cat: 0.00, tag: 0.40, author: 0.10, pop: 0.20, fresh: 0.15, disc: 0.15 }
    : { cat: 0.00, tag: 0.00, author: 0.20, pop: 0.35, fresh: 0.20, disc: 0.25 };

  const now = Date.now();
  const totalCategories = Math.max(categories.length, 1);
  const totalTags = Math.max(skillTags.length, 1);
  const tierDiscovery: Record<number, number> = { 1: 100, 2: 67, 3: 33, 4: 0 };

  const scored = allCandidates.map(({ data: c, tier }) => {
    // Category score: Tier 1 has sharedCategoryCount from query, others from batch
    const sharedCats = tier === 1
      ? (c.sharedCategoryCount || 0)
      : (catOverlapMap[c.id] || 0);
    const categoryScore = (sharedCats / totalCategories) * 100;

    // Tag score: Tier 2 has sharedTagCount from query, others from batch
    const sharedTags = tier === 2
      ? (c.sharedTagCount || 0)
      : (tagOverlapMap[c.id] || 0);
    const tagScore = (sharedTags / totalTags) * 100;

    const authorScore = (repoOwner && c.repoOwner === repoOwner) ? 100 : 0;
    const stars = c.stars || 0;
    const trending = c.trendingScore || 0;
    const popularityScore = Math.min(100, Math.log10(stars + 1) * 20 + trending * 2);
    const commitTs = c.lastCommitAt || (now - 200 * 86400000);
    const daysSinceCommit = (now - commitTs) / 86400000;
    const freshnessScore = Math.max(0, 100 - daysSinceCommit * 0.5);
    const discoveryScore = tierDiscovery[tier] ?? 0;

    const relevanceScore =
      categoryScore * weights.cat +
      tagScore * weights.tag +
      authorScore * weights.author +
      popularityScore * weights.pop +
      freshnessScore * weights.fresh +
      discoveryScore * weights.disc;

    return { ...c, relevanceScore, trendingScore: trending, stars };
  });

  // Step 5: Sort, slice, enrich with categories
  scored.sort((a, b) =>
    b.relevanceScore - a.relevanceScore
    || b.trendingScore - a.trendingScore
    || b.stars - a.stars
  );

  const top = scored.slice(0, limit).map(({
    relevanceScore, sharedCategoryCount, sharedTagCount, lastCommitAt, ...rest
  }) => rest);

  return addCategoriesToSkills(env.DB, top);
}

/**
 * 获取统计数据
 */
export async function getStats(env: DbEnv): Promise<{ totalSkills: number }> {
  if (!env.DB) return { totalSkills: 0 };

  const result = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'").first<{ total: number }>();

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
    SELECT sc.category_slug, COUNT(*) as count
    FROM skill_categories sc
    JOIN skills s ON sc.skill_id = s.id
    WHERE s.visibility = 'public'
    GROUP BY sc.category_slug
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

// Tier configuration (must match workers/types.ts)
const TIER_CONFIG = {
  hot: {
    updateInterval: 6 * 60 * 60 * 1000,      // 6 hours
    accessWindow: 7 * 24 * 60 * 60 * 1000,   // 7 days
  },
  warm: {
    updateInterval: 24 * 60 * 60 * 1000,     // 24 hours
    accessWindow: 30 * 24 * 60 * 60 * 1000,  // 30 days
  },
  cool: {
    updateInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
    accessWindow: 90 * 24 * 60 * 60 * 1000,  // 90 days
  },
  cold: {
    updateInterval: 30 * 24 * 60 * 60 * 1000, // 30 days for cold (on-access)
    accessWindow: 365 * 24 * 60 * 60 * 1000, // 1 year
  },
  archived: {
    updateInterval: 0,
    accessWindow: 0,
  },
} as const;

type SkillTier = keyof typeof TIER_CONFIG;

const ACCESS_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const NEEDS_UPDATE_MARK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACCESS_DEDUPE_ENTRIES = 10_000;
const MAX_MARKED_UPDATE_ENTRIES = 5_000;

const recentAccessByClient = new Map<string, number>();
const recentNeedsUpdateMark = new Map<string, number>();

function pruneExpiredEntries(map: Map<string, number>, now: number, windowMs: number): void {
  for (const [key, timestamp] of map.entries()) {
    if (now - timestamp > windowMs) {
      map.delete(key);
    }
  }
}

function shouldSkipAccessCount(
  skillId: string,
  clientKey: string | undefined,
  now: number
): boolean {
  if (!clientKey) return false;

  const dedupeKey = `${skillId}:${clientKey}`;
  const lastSeen = recentAccessByClient.get(dedupeKey);

  if (lastSeen && now - lastSeen < ACCESS_DEDUPE_WINDOW_MS) {
    return true;
  }

  recentAccessByClient.set(dedupeKey, now);
  if (recentAccessByClient.size > MAX_ACCESS_DEDUPE_ENTRIES) {
    pruneExpiredEntries(recentAccessByClient, now, ACCESS_DEDUPE_WINDOW_MS);
  }

  return false;
}

function shouldWriteNeedsUpdateMarker(skillId: string, now: number): boolean {
  const lastMarkedAt = recentNeedsUpdateMark.get(skillId);
  if (lastMarkedAt && now - lastMarkedAt < NEEDS_UPDATE_MARK_WINDOW_MS) {
    return false;
  }

  recentNeedsUpdateMark.set(skillId, now);
  if (recentNeedsUpdateMark.size > MAX_MARKED_UPDATE_ENTRIES) {
    pruneExpiredEntries(recentNeedsUpdateMark, now, NEEDS_UPDATE_MARK_WINDOW_MS);
  }

  return true;
}

/**
 * Record skill access and check if update is needed
 * This is called asynchronously when a user views a skill detail page
 */
export async function recordSkillAccess(
  env: DbEnv,
  skillId: string,
  clientKey?: string
): Promise<void> {
  if (!env.DB) return;

  const now = Date.now();
  if (shouldSkipAccessCount(skillId, clientKey, now)) {
    return;
  }

  try {
    // Get current skill data
    const skill = await env.DB.prepare(`
      SELECT tier, next_update_at, last_accessed_at
      FROM skills WHERE id = ?
    `)
      .bind(skillId)
      .first<{
        tier: SkillTier;
        next_update_at: number | null;
        last_accessed_at: number | null;
      }>();

    if (!skill) return;

    // Update access tracking
    await env.DB.prepare(`
      UPDATE skills
      SET last_accessed_at = ?,
          access_count_7d = access_count_7d + 1,
          access_count_30d = access_count_30d + 1
      WHERE id = ?
    `)
      .bind(now, skillId)
      .run();

    // Check if update is needed based on tier
    const tier = skill.tier || 'cold';
    const updateInterval = TIER_CONFIG[tier]?.updateInterval || TIER_CONFIG.cold.updateInterval;

    // Handle archived skills - check for resurrection
    if (tier === 'archived') {
      // Trigger resurrection check asynchronously
      checkAndResurrect(env, skillId).catch(console.error);
      return;
    }

    // Check if skill needs update
    const needsUpdate =
      !skill.next_update_at ||
      skill.next_update_at < now ||
      (tier === 'cold' && (!skill.last_accessed_at || now - skill.last_accessed_at > updateInterval));

    if (needsUpdate && env.KV && shouldWriteNeedsUpdateMarker(skillId, now)) {
      // Mark for update in KV (will be processed by trending worker)
      await env.KV.put(`needs_update:${skillId}`, '1', {
        expirationTtl: 60 * 60, // 1 hour TTL
      });
    }
  } catch (error) {
    console.error('Error recording skill access:', error);
  }
}

/**
 * Check if an archived skill should be resurrected
 * Called when a user accesses an archived skill
 */
async function checkAndResurrect(env: DbEnv, skillId: string): Promise<void> {
  // If resurrection worker URL is configured, call it
  if (env.RESURRECTION_WORKER_URL && env.WORKER_SECRET) {
    try {
      const response = await fetch(`${env.RESURRECTION_WORKER_URL}/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.WORKER_SECRET}`,
        },
        body: JSON.stringify({ skillId }),
      });

      if (response.ok) {
        const result = await response.json() as { resurrected: boolean; reason?: string };
        if (result.resurrected) {
          console.log(`Skill ${skillId} resurrected via worker`);
        }
      }
    } catch (error) {
      console.error('Error calling resurrection worker:', error);
    }
    return;
  }

  // Fallback: Mark for resurrection check in KV
  // This will be picked up by the resurrection worker on next run
  if (env.KV) {
    await env.KV.put(`needs_resurrection_check:${skillId}`, '1', {
      expirationTtl: 24 * 60 * 60, // 24 hour TTL
    });
  }
}

/**
 * Reset access counts (called by tier-recalc worker daily)
 */
export async function resetAccessCounts(env: DbEnv): Promise<void> {
  if (!env.DB) return;

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Reset 7-day counts for skills not accessed in 7 days
  await env.DB.prepare(`
    UPDATE skills
    SET access_count_7d = 0
    WHERE last_accessed_at IS NULL OR last_accessed_at < ?
  `)
    .bind(sevenDaysAgo)
    .run();

  // Reset 30-day counts for skills not accessed in 30 days
  await env.DB.prepare(`
    UPDATE skills
    SET access_count_30d = 0
    WHERE last_accessed_at IS NULL OR last_accessed_at < ?
  `)
    .bind(thirtyDaysAgo)
    .run();
}
