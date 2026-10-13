import { error } from '@sveltejs/kit';
import { PUBLIC_LIST_MAX_PAGE } from '$lib/server/db/shared/constants';
import type { PageServerLoad } from './$types';
import { setPublicPageCache } from '$lib/server/cache/page';

const ITEMS_PER_PAGE = 24;

interface ProfilePagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  baseUrl: string;
}

const CACHE_TTL = 30 * 60; // 30 minutes
const CACHE_TTL_NOT_FOUND = 5 * 60; // 5 minutes for 404s

interface UserProfileLoadResult {
  profile: UserProfile | null;
  skills: Skill[];
  error?: string;
  pagination?: ProfilePagination;
}

interface UserSkillRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  stars: number;
  updatedAt: number;
  tier: string | null;
  indexedAt: number;
  downloadCount90d: number;
  accessCount30d: number;
}

interface SkillCategoryRow {
  skill_id: string;
  category_slug: string;
}

async function hydrateCategories(
  db: D1Database,
  rows: UserSkillRow[]
): Promise<Array<UserSkillRow & { categories: string[] }>> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const categoryRows = await db.prepare(`
    SELECT skill_id, category_slug
    FROM skill_categories
    WHERE skill_id IN (${placeholders})
  `)
    .bind(...ids)
    .all<SkillCategoryRow>();

  const categoryMap: Record<string, string[]> = {};
  for (const row of categoryRows.results || []) {
    if (!categoryMap[row.skill_id]) {
      categoryMap[row.skill_id] = [];
    }
    categoryMap[row.skill_id].push(row.category_slug);
  }

  return rows.map((row) => ({
    ...row,
    categories: categoryMap[row.id] || []
  }));
}

async function loadProfileSkills(
  db: D1Database,
  identity: { ownerId: string } | { repoOwner: string },
  page: number
) {
  const registered = 'ownerId' in identity;
  // These fragments are selected by code, never supplied by the caller.
  const index = registered ? 'skills_owner_visibility_stars_idx' : 'skills_visibility_repo_owner_idx';
  const where = registered ? 's.owner_id = ? AND s.org_id IS NULL' : 's.repo_owner = ?';
  const owner = registered ? identity.ownerId : identity.repoOwner;
  const totals = await db.prepare(`
    SELECT COUNT(*) AS skillCount, COALESCE(SUM(s.stars), 0) AS totalStars
    FROM skills s INDEXED BY ${index}
    WHERE ${where} AND s.visibility = 'public'
    LIMIT 1
  `).bind(owner).first<{ skillCount: number; totalStars: number }>();
  const skillCount = Number(totals?.skillCount) || 0;
  const totalPages = Math.min(PUBLIC_LIST_MAX_PAGE, Math.ceil(skillCount / ITEMS_PER_PAGE));
  if (page > Math.max(1, totalPages)) throw error(404, 'Page not found');

  // Limit IDs before loading descriptions and categories. In particular, the
  // category bind count must not grow with the author's entire collection.
  const idsResult = await db.prepare(`
    SELECT s.id
    FROM skills s INDEXED BY ${index}
    WHERE ${where} AND s.visibility = 'public'
    ORDER BY s.stars DESC, COALESCE(s.last_commit_at, s.updated_at) DESC, s.id ASC
    LIMIT ? OFFSET ?
  `).bind(owner, ITEMS_PER_PAGE, (page - 1) * ITEMS_PER_PAGE).all<{ id: string }>();
  const ids = (idsResult.results || []).map((row) => row.id);
  let rows: UserSkillRow[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT s.id, s.name, s.slug, s.description, s.stars,
        COALESCE(s.last_commit_at, s.updated_at) AS updatedAt,
        s.tier, s.indexed_at AS indexedAt,
        s.download_count_90d AS downloadCount90d, s.access_count_30d AS accessCount30d
      FROM skills s
      WHERE s.id IN (${placeholders}) AND ${where} AND s.visibility = 'public'
      LIMIT ?
    `).bind(...ids, owner, ITEMS_PER_PAGE).all<UserSkillRow>();
    const byId = new Map((result.results || []).map((row) => [row.id, row]));
    rows = ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  }
  return {
    skills: await hydrateCategories(db, rows),
    skillCount,
    totalStars: Number(totals?.totalStars) || 0,
    totalPages,
  };
}

export const load: PageServerLoad = async ({ params, platform, setHeaders, locals, request, url }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: CACHE_TTL,
    staleWhileRevalidate: 3600,
    varyByLanguageHeader: false,
  });

  const db = platform?.env?.DB;
  const cache = platform?.caches?.default;
  const { username } = params;
  const rawPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  if (page > PUBLIC_LIST_MAX_PAGE) throw error(404, 'Page not found');
  const pagination = (skillCount: number, totalPages: number): ProfilePagination => ({
    currentPage: page, totalPages, totalItems: skillCount, itemsPerPage: ITEMS_PER_PAGE,
    baseUrl: `/u/${encodeURIComponent(username)}`,
  });

  if (!db || !username) {
    return {
      profile: null,
      skills: [],
      error: 'Invalid request',
    };
  }

  // Try to get from cache first
  const cacheKey = `user-profile:v3:${encodeURIComponent(username)}:${page}`;
  if (cache) {
    try {
      const cached = await cache.match(new Request(`https://cache/${cacheKey}`));
      if (cached) {
        const data = await cached.json() as UserProfileLoadResult;
        if (!data?.profile && data?.error === 'User not found') {
          setHeaders({ 'X-Skillscat-Status-Override': '404' });
        }
        return data;
      }
    } catch {
      // Cache miss or error, continue to DB query
    }
  }

  // Try to find registered user by:
  // 1. GitHub account_id (username from GitHub OAuth)
  // 2. User name (display name)
  let user = await db.prepare(`
    SELECT u.id, u.name, u.image, u.created_at as joinedAt,
           a.account_id as githubUsername
    FROM account a
    CROSS JOIN user u
    WHERE u.id = a.user_id
      AND a.provider_id = 'github'
      AND a.account_id = ?
    LIMIT 1
  `)
    .bind(username)
    .first<{
      id: string;
      name: string;
      image: string | null;
      joinedAt: number;
      githubUsername: string | null;
    }>();

  if (!user) {
    user = await db.prepare(`
      SELECT u.id, u.name, u.image, u.created_at as joinedAt,
             a.account_id as githubUsername
      FROM user u
      LEFT JOIN account a ON u.id = a.user_id AND a.provider_id = 'github'
      WHERE u.name = ?
      LIMIT 1
    `)
      .bind(username)
      .first<{
        id: string;
        name: string;
          image: string | null;
        joinedAt: number;
        githubUsername: string | null;
      }>();
  }

  if (user) {
    const { skills, skillCount, totalStars, totalPages } = await loadProfileSkills(db, { ownerId: user.id }, page);

    const result = {
      profile: {
        id: user.id,
        name: user.name,
        image: user.image,
        bio: null as string | null,
        githubUsername: user.githubUsername,
        skillCount,
        totalStars,
        joinedAt: user.joinedAt,
        isRegistered: true,
        type: 'User' as const,
      },
      pagination: pagination(skillCount, totalPages),
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description || '',
        visibility: 'public' as const,
        stars: s.stars || 0,
        tier: s.tier,
        indexedAt: s.indexedAt,
        downloadCount90d: s.downloadCount90d,
        accessCount30d: s.accessCount30d,
        categories: s.categories,
        updatedAt: s.updatedAt,
      })),
    };

    // Store in cache
    if (cache) {
      const response = new Response(JSON.stringify(result), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
      });
      platform?.context?.waitUntil(
        cache.put(new Request(`https://cache/${cacheKey}`), response)
      );
    }

    return result;
  }

  // Not a registered user - try to find GitHub author by username
  const author = await db.prepare(`
    SELECT id, github_id as githubId, username, display_name as displayName,
           avatar_url as avatarUrl, bio, type, skills_count as skillsCount,
           total_stars as totalStars, created_at as createdAt
    FROM authors
    WHERE username = ?
    LIMIT 1
  `)
    .bind(username)
    .first<{
      id: string;
      githubId: number;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      type: string | null;
      skillsCount: number;
      totalStars: number;
      createdAt: number;
    }>();

  if (!author) {
    setHeaders({ 'X-Skillscat-Status-Override': '404' });
    // Cache 404 with shorter TTL
    const notFoundResult = {
      profile: null,
      skills: [],
      error: 'User not found',
    };

    if (cache) {
      const response = new Response(JSON.stringify(notFoundResult), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_NOT_FOUND}` },
      });
      platform?.context?.waitUntil(
        cache.put(new Request(`https://cache/${cacheKey}`), response)
      );
    }

    return notFoundResult;
  }

  const { skills, skillCount, totalStars, totalPages } = await loadProfileSkills(db, { repoOwner: username }, page);

  const result = {
    profile: {
      id: author.id,
      name: author.displayName || author.username,
      image: author.avatarUrl,
      bio: author.bio,
      githubUsername: author.username,
      skillCount,
      totalStars,
      joinedAt: author.createdAt,
      isRegistered: false,
      type: (author.type || 'User') as 'User' | 'Organization',
    },
    pagination: pagination(skillCount, totalPages),
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description || '',
      visibility: 'public' as const,
      stars: s.stars || 0,
      tier: s.tier,
      indexedAt: s.indexedAt,
      downloadCount90d: s.downloadCount90d,
      accessCount30d: s.accessCount30d,
      categories: s.categories,
      updatedAt: s.updatedAt,
    })),
  };

  // Store in cache
  if (cache) {
    const response = new Response(JSON.stringify(result), {
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
    });
    platform?.context?.waitUntil(
      cache.put(new Request(`https://cache/${cacheKey}`), response)
    );
  }

  return result;
};

interface UserProfile {
  id: string;
  name: string;
  image: string | null;
  bio: string | null;
  githubUsername: string | null;
  skillCount: number;
  totalStars: number;
  joinedAt: number;
  isRegistered: boolean;
  type: 'User' | 'Organization';
}

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  stars: number;
  categories: string[];
  updatedAt: number;
}
