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
    LEFT JOIN authors a ON s.repo_owner = a.username
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
    LEFT JOIN authors a ON s.repo_owner = a.username
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
    LEFT JOIN authors a ON s.repo_owner = a.username
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
    LEFT JOIN authors a ON s.repo_owner = a.username
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
    // 根据 source_type 决定 R2 路径
    let r2Path: string;
    if (skillData.source_type === 'upload') {
      // 上传的 skill 使用 slug 中的 owner 和 name
      const slugParts = skillData.slug.replace(/^@/, '').split('/');
      r2Path = `skills/${slugParts[0]}/${slugParts[1] || skillData.name}/SKILL.md`;
    } else {
      // Include skill_path in R2 path for multi-skill repos
      const skillPathPart = skillData.skill_path ? `/${skillData.skill_path}` : '';
      r2Path = `skills/${skillData.repo_owner}/${skillData.repo_name}${skillPathPart}/SKILL.md`;
    }

    try {
      const object = await env.R2.get(r2Path);
      if (object) {
        readme = await object.text();
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
    LEFT JOIN authors a ON s.repo_owner = a.username
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

/**
 * Record skill access and check if update is needed
 * This is called asynchronously when a user views a skill detail page
 */
export async function recordSkillAccess(
  env: DbEnv,
  skillId: string
): Promise<void> {
  if (!env.DB || !env.KV) return;

  const now = Date.now();

  try {
    // Get current skill data
    const skill = await env.DB.prepare(`
      SELECT tier, next_update_at, last_accessed_at, access_count_7d, access_count_30d
      FROM skills WHERE id = ?
    `)
      .bind(skillId)
      .first<{
        tier: SkillTier;
        next_update_at: number | null;
        last_accessed_at: number | null;
        access_count_7d: number;
        access_count_30d: number;
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

    if (needsUpdate) {
      // Mark for update in KV (will be processed by trending worker)
      await env.KV.put(`needs_update:${skillId}`, '1', {
        expirationTtl: 60 * 60, // 1 hour TTL
      });
    }

    // Record access metric
    const hourKey = `metrics:access:${new Date().toISOString().slice(0, 13)}`;
    const existing = await env.KV.get(hourKey, 'json') as { count: number } | null;
    await env.KV.put(hourKey, JSON.stringify({ count: (existing?.count || 0) + 1 }), {
      expirationTtl: 7 * 24 * 60 * 60, // 7 days
    });
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
