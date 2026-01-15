import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

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
        s.updated_at as updatedAt,
        a.avatar_url as authorAvatar,
        f.created_at as favoritedAt
      FROM favorites f
      JOIN skills s ON f.skill_id = s.id
      LEFT JOIN authors a ON s.author_id = a.id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `)
      .bind(userId, limit, offset)
      .all();

    // 获取总数
    const countResult = await db.prepare(`
      SELECT COUNT(*) as total FROM favorites WHERE user_id = ?
    `)
      .bind(userId)
      .first<{ total: number }>();

    // 获取每个 skill 的分类
    const skillIds = favorites.results.map((f: any) => f.id);
    let categoriesMap: Record<string, string[]> = {};

    if (skillIds.length > 0) {
      const placeholders = skillIds.map(() => '?').join(',');
      const categories = await db.prepare(`
        SELECT skill_id, category_slug FROM skill_categories
        WHERE skill_id IN (${placeholders})
      `)
        .bind(...skillIds)
        .all();

      for (const cat of categories.results as any[]) {
        if (!categoriesMap[cat.skill_id]) {
          categoriesMap[cat.skill_id] = [];
        }
        categoriesMap[cat.skill_id].push(cat.category_slug);
      }
    }

    // 组装结果
    const results = favorites.results.map((f: any) => ({
      ...f,
      categories: categoriesMap[f.id] || [],
    }));

    return json({
      favorites: results,
      total: countResult?.total || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('Error fetching favorites:', err);
    if (err.status) throw err;
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
    const body = await request.json();
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
  } catch (err: any) {
    console.error('Error adding favorite:', err);
    if (err.status) throw err;
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
    const body = await request.json();
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
  } catch (err: any) {
    console.error('Error removing favorite:', err);
    if (err.status) throw err;
    throw error(500, 'Failed to remove favorite');
  }
};
