import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SkillCardData, ApiResponse, SortOption } from '$lib/types';
import { getCached } from '$lib/server/cache';

type SkillsResponse = {
  skills: SkillCardData[];
  nextCursor: string | null;
  total: number;
  hasMore: boolean;
};

type PaginatedSkillsResponse = {
  skills: SkillCardData[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
};

async function fetchSkills(
  db: D1Database,
  sort: SortOption,
  category: string | null,
  search: string | null,
  cursor: string | null,
  limit: number
): Promise<SkillsResponse> {
  // Build query
  let sql = `
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
      GROUP_CONCAT(sc.category_slug) as categories,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN skill_categories sc ON s.id = sc.skill_id
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (search) {
    sql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    sql += ` AND EXISTS (SELECT 1 FROM skill_categories sc2 WHERE sc2.skill_id = s.id AND sc2.category_slug = ?)`;
    params.push(category);
  }

  // Cursor-based pagination
  if (cursor) {
    const [cursorValue, cursorId] = cursor.split(':');
    if (sort === 'trending') {
      sql += ` AND (s.trending_score < ? OR (s.trending_score = ? AND s.id > ?))`;
      params.push(parseFloat(cursorValue), parseFloat(cursorValue), cursorId);
    } else if (sort === 'stars') {
      sql += ` AND (s.stars < ? OR (s.stars = ? AND s.id > ?))`;
      params.push(parseInt(cursorValue), parseInt(cursorValue), cursorId);
    } else if (sort === 'recent') {
      sql += ` AND (s.updated_at < ? OR (s.updated_at = ? AND s.id > ?))`;
      params.push(parseInt(cursorValue), parseInt(cursorValue), cursorId);
    } else {
      sql += ` AND (s.name > ? OR (s.name = ? AND s.id > ?))`;
      params.push(cursorValue, cursorValue, cursorId);
    }
  }

  sql += ` GROUP BY s.id`;

  // Sort order
  switch (sort) {
    case 'trending':
      sql += ` ORDER BY s.trending_score DESC, s.id ASC`;
      break;
    case 'stars':
      sql += ` ORDER BY s.stars DESC, s.id ASC`;
      break;
    case 'recent':
      sql += ` ORDER BY COALESCE(s.last_commit_at, s.indexed_at) DESC, s.id ASC`;
      break;
    case 'name':
      sql += ` ORDER BY s.name ASC, s.id ASC`;
      break;
  }

  sql += ` LIMIT ?`;
  params.push(limit + 1); // Fetch one extra to check if there's more

  const result = await db.prepare(sql).bind(...params).all<{
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
    categories: string | null;
    authorAvatar: string | null;
  }>();

  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const skills: SkillCardData[] = rows.slice(0, limit).map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    stars: row.stars,
    forks: row.forks,
    trendingScore: row.trendingScore,
    updatedAt: row.updatedAt,
    categories: row.categories ? row.categories.split(',') : [],
    authorAvatar: row.authorAvatar || undefined
  }));

  // Generate next cursor
  let nextCursor: string | null = null;
  if (hasMore && skills.length > 0) {
    const lastSkill = skills[skills.length - 1];
    switch (sort) {
      case 'trending':
        nextCursor = `${lastSkill.trendingScore}:${lastSkill.id}`;
        break;
      case 'stars':
        nextCursor = `${lastSkill.stars}:${lastSkill.id}`;
        break;
      case 'recent':
        nextCursor = `${lastSkill.updatedAt}:${lastSkill.id}`;
        break;
      case 'name':
        nextCursor = `${lastSkill.name}:${lastSkill.id}`;
        break;
    }
  }

  // Get total count
  let countSql = `SELECT COUNT(DISTINCT s.id) as total FROM skills s`;
  const countParams: (string | number)[] = [];

  if (category) {
    countSql += ` LEFT JOIN skill_categories sc ON s.id = sc.skill_id WHERE sc.category_slug = ?`;
    countParams.push(category);
    if (search) {
      countSql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`);
    }
  } else if (search) {
    countSql += ` WHERE s.name LIKE ? OR s.description LIKE ?`;
    countParams.push(`%${search}%`, `%${search}%`);
  }

  const countResult = await db.prepare(countSql).bind(...countParams).first<{ total: number }>();
  const total = countResult?.total || 0;

  return { skills, nextCursor, total, hasMore };
}

async function fetchSkillsPaginated(
  db: D1Database,
  sort: SortOption,
  category: string | null,
  search: string | null,
  page: number,
  limit: number
): Promise<PaginatedSkillsResponse> {
  const offset = (page - 1) * limit;

  // Build query
  let sql = `
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
      GROUP_CONCAT(sc.category_slug) as categories,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN skill_categories sc ON s.id = sc.skill_id
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (search) {
    sql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    sql += ` AND EXISTS (SELECT 1 FROM skill_categories sc2 WHERE sc2.skill_id = s.id AND sc2.category_slug = ?)`;
    params.push(category);
  }

  sql += ` GROUP BY s.id`;

  // Sort order
  switch (sort) {
    case 'trending':
      sql += ` ORDER BY s.trending_score DESC, s.id ASC`;
      break;
    case 'stars':
      sql += ` ORDER BY s.stars DESC, s.id ASC`;
      break;
    case 'recent':
      sql += ` ORDER BY COALESCE(s.last_commit_at, s.indexed_at) DESC, s.id ASC`;
      break;
    case 'name':
      sql += ` ORDER BY s.name ASC, s.id ASC`;
      break;
  }

  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await db.prepare(sql).bind(...params).all<{
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
    categories: string | null;
    authorAvatar: string | null;
  }>();

  const rows = result.results || [];
  const skills: SkillCardData[] = rows.map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    stars: row.stars,
    forks: row.forks,
    trendingScore: row.trendingScore,
    updatedAt: row.updatedAt,
    categories: row.categories ? row.categories.split(',') : [],
    authorAvatar: row.authorAvatar || undefined
  }));

  // Get total count
  let countSql = `SELECT COUNT(DISTINCT s.id) as total FROM skills s`;
  const countParams: (string | number)[] = [];

  if (category) {
    countSql += ` LEFT JOIN skill_categories sc ON s.id = sc.skill_id WHERE sc.category_slug = ?`;
    countParams.push(category);
    if (search) {
      countSql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`);
    }
  } else if (search) {
    countSql += ` WHERE s.name LIKE ? OR s.description LIKE ?`;
    countParams.push(`%${search}%`, `%${search}%`);
  }

  const countResult = await db.prepare(countSql).bind(...countParams).first<{ total: number }>();
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / limit);
  const hasMore = page < totalPages;

  return { skills, total, page, totalPages, hasMore };
}

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const sort = (url.searchParams.get('sort') || 'trending') as SortOption;
    const category = url.searchParams.get('category');
    const search = url.searchParams.get('q');
    const cursor = url.searchParams.get('cursor');
    const pageParam = url.searchParams.get('page');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

    const db = platform?.env?.DB;

    if (!db) {
      return json({
        success: true,
        data: { skills: [], nextCursor: null },
        meta: { total: 0, hasMore: false, page: 1, totalPages: 0 }
      } satisfies ApiResponse<{ skills: SkillCardData[]; nextCursor: string | null }>);
    }

    // Use page-based pagination if page param is provided
    if (pageParam) {
      const page = Math.max(1, parseInt(pageParam, 10));
      const canCache = page === 1 && !search;
      let data: PaginatedSkillsResponse;
      let hit = false;

      if (canCache) {
        const cacheKey = `api:skills:paginated:${sort}:${category || 'all'}:${limit}:${page}`;
        const cached = await getCached(cacheKey, () => fetchSkillsPaginated(db, sort, category, search, page, limit), 60);
        data = cached.data;
        hit = cached.hit;
      } else {
        data = await fetchSkillsPaginated(db, sort, category, search, page, limit);
      }

      return json({
        success: true,
        data: { skills: data.skills, nextCursor: null },
        meta: { total: data.total, hasMore: data.hasMore, page: data.page, totalPages: data.totalPages }
      } satisfies ApiResponse<{ skills: SkillCardData[]; nextCursor: string | null }>, {
        headers: {
          'Cache-Control': canCache ? 'public, max-age=60, stale-while-revalidate=120' : 'private, no-cache',
          'X-Cache': hit ? 'HIT' : 'MISS'
        }
      });
    }

    // Fallback to cursor-based pagination
    const canCache = !cursor && !search;
    let data: SkillsResponse;
    let hit = false;

    if (canCache) {
      const cacheKey = `api:skills:${sort}:${category || 'all'}:${limit}`;
      const cached = await getCached(cacheKey, () => fetchSkills(db, sort, category, search, cursor, limit), 60);
      data = cached.data;
      hit = cached.hit;
    } else {
      data = await fetchSkills(db, sort, category, search, cursor, limit);
    }

    return json({
      success: true,
      data: { skills: data.skills, nextCursor: data.nextCursor },
      meta: { total: data.total, hasMore: data.hasMore }
    } satisfies ApiResponse<{ skills: SkillCardData[]; nextCursor: string | null }>, {
      headers: {
        'Cache-Control': canCache ? 'public, max-age=60, stale-while-revalidate=120' : 'private, no-cache',
        'X-Cache': hit ? 'HIT' : 'MISS'
      }
    });
  } catch (error) {
    console.error('Error fetching skills:', error);
    return json({
      success: false,
      error: 'Failed to fetch skills'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
