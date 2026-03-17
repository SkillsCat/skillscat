import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkSkillAccess } from '$lib/server/auth/permissions';

interface FavoriteSkillRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoOwner: string;
  repoName: string;
  stars: number;
  forks: number;
  trendingScore: number;
  updatedAt: number;
  authorAvatar: string | null;
  favoritedAt: number;
}

interface SkillCategoryRow {
  skill_id: string;
  category_slug: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(raw: string | null): number {
  const parsed = Number.parseInt(raw || '0', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function hasStatus(errorValue: unknown): errorValue is { status: number } {
  if (typeof errorValue !== 'object' || errorValue === null) return false;
  if (!('status' in errorValue)) return false;
  return typeof (errorValue as { status: unknown }).status === 'number';
}

/**
 * GET /api/favorites - 获取用户收藏列表
 */
export const GET: RequestHandler = async ({ locals, platform, url }) => {
  try {
    // 检查用户是否登录
    const session = await locals.auth?.();
    if (!session?.user) {
      throw error(401, 'Unauthorized');
    }

    const userId = session.user.id;
    const limit = parseLimit(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'));
    const offset = parseOffset(url.searchParams.get('offset'));
    const queryLimit = offset === 0 ? limit + 1 : limit;
    const now = Date.now();

    // 从 D1 获取收藏列表
    const db = platform?.env?.DB;
    if (!db) {
      // 开发环境返回空数据
      return json({
        favorites: [],
        total: 0,
        limit,
        offset,
      });
    }

    // 获取收藏的 skills
    const favorites = await db.prepare(`
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
        a.avatar_url as authorAvatar,
        f.created_at as favoritedAt
      FROM favorites f
      JOIN skills s ON f.skill_id = s.id
      LEFT JOIN authors a ON s.repo_owner = a.username
      WHERE f.user_id = ?
        AND (
          s.visibility = 'public'
          OR s.visibility = 'unlisted'
          OR s.owner_id = ?
          OR EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = s.org_id AND om.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM skill_permissions sp
            WHERE sp.skill_id = s.id
              AND sp.grantee_type = 'user'
              AND sp.grantee_id = ?
              AND (sp.expires_at IS NULL OR sp.expires_at > ?)
          )
        )
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `)
      .bind(userId, userId, userId, userId, now, queryLimit, offset)
      .all<FavoriteSkillRow>();

    const hasMoreOnFirstPage = offset === 0 && favorites.results.length > limit;
    const pageRows = hasMoreOnFirstPage ? favorites.results.slice(0, limit) : favorites.results;

    let total = 0;
    if (offset === 0 && !hasMoreOnFirstPage) {
      total = pageRows.length;
    } else {
      // 获取总数
      const countResult = await db.prepare(`
        SELECT COUNT(*) as total
        FROM favorites f
        JOIN skills s ON f.skill_id = s.id
        WHERE f.user_id = ?
          AND (
            s.visibility = 'public'
            OR s.visibility = 'unlisted'
            OR s.owner_id = ?
            OR EXISTS (
              SELECT 1 FROM org_members om
              WHERE om.org_id = s.org_id AND om.user_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM skill_permissions sp
              WHERE sp.skill_id = s.id
                AND sp.grantee_type = 'user'
                AND sp.grantee_id = ?
                AND (sp.expires_at IS NULL OR sp.expires_at > ?)
            )
          )
      `)
        .bind(userId, userId, userId, userId, now)
        .first<{ total: number }>();
      total = countResult?.total || 0;
    }

    // 获取每个 skill 的分类
    const skillIds = pageRows.map((favorite) => favorite.id);
    let categoriesMap: Record<string, string[]> = {};

    if (skillIds.length > 0) {
      const placeholders = skillIds.map(() => '?').join(',');
      const categories = await db.prepare(`
        SELECT skill_id, category_slug FROM skill_categories
        WHERE skill_id IN (${placeholders})
      `)
        .bind(...skillIds)
        .all<SkillCategoryRow>();

      for (const cat of categories.results) {
        if (!categoriesMap[cat.skill_id]) {
          categoriesMap[cat.skill_id] = [];
        }
        categoriesMap[cat.skill_id].push(cat.category_slug);
      }
    }

    // 组装结果
    const results = pageRows.map((favorite) => ({
      ...favorite,
      categories: categoriesMap[favorite.id] || [],
    }));

    return json({
      favorites: results,
      total,
      limit,
      offset,
    });
  } catch (err: unknown) {
    console.error('Error fetching favorites:', err);
    if (hasStatus(err)) throw err;
    throw error(500, 'Failed to fetch favorites');
  }
};

/**
 * POST /api/favorites - 添加收藏
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  try {
    // 检查用户是否登录
    const session = await locals.auth?.();
    if (!session?.user) {
      throw error(401, 'Unauthorized');
    }

    const userId = session.user.id;
    const body = await request.json() as { skillId?: string };
    const { skillId } = body;

    if (!skillId) {
      throw error(400, 'skillId is required');
    }

    const db = platform?.env?.DB;
    if (!db) {
      // 开发环境模拟成功
      return json({ success: true, message: 'Favorite added (dev mode)' });
    }

    // 检查 skill 是否存在
    const skill = await db.prepare('SELECT id FROM skills WHERE id = ?')
      .bind(skillId)
      .first();

    if (!skill) {
      throw error(404, 'Skill not found');
    }

    const hasAccess = await checkSkillAccess(skillId, userId, db);
    if (!hasAccess) {
      throw error(403, 'You do not have permission to favorite this skill');
    }

    // 检查是否已收藏
    const existing = await db.prepare(`
      SELECT 1 FROM favorites WHERE user_id = ? AND skill_id = ?
    `)
      .bind(userId, skillId)
      .first();

    if (existing) {
      return json({ success: true, message: 'Already favorited' });
    }

    // 添加收藏
    await db.prepare(`
      INSERT INTO favorites (user_id, skill_id, created_at)
      VALUES (?, ?, ?)
    `)
      .bind(userId, skillId, Date.now())
      .run();

    // 记录用户行为
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, ?, ?, 'favorite', ?)
    `)
      .bind(crypto.randomUUID(), userId, skillId, Date.now())
      .run();

    return json({ success: true, message: 'Favorite added' });
  } catch (err: unknown) {
    console.error('Error adding favorite:', err);
    if (hasStatus(err)) throw err;
    throw error(500, 'Failed to add favorite');
  }
};

/**
 * DELETE /api/favorites - 删除收藏
 */
export const DELETE: RequestHandler = async ({ locals, platform, request }) => {
  try {
    // 检查用户是否登录
    const session = await locals.auth?.();
    if (!session?.user) {
      throw error(401, 'Unauthorized');
    }

    const userId = session.user.id;
    const body = await request.json() as { skillId?: string };
    const { skillId } = body;

    if (!skillId) {
      throw error(400, 'skillId is required');
    }

    const db = platform?.env?.DB;
    if (!db) {
      // 开发环境模拟成功
      return json({ success: true, message: 'Favorite removed (dev mode)' });
    }

    // 删除收藏
    await db.prepare(`
      DELETE FROM favorites WHERE user_id = ? AND skill_id = ?
    `)
      .bind(userId, skillId)
      .run();

    // 记录用户行为
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, ?, ?, 'unfavorite', ?)
    `)
      .bind(crypto.randomUUID(), userId, skillId, Date.now())
      .run();

    return json({ success: true, message: 'Favorite removed' });
  } catch (err: unknown) {
    console.error('Error removing favorite:', err);
    if (hasStatus(err)) throw err;
    throw error(500, 'Failed to remove favorite');
  }
};
