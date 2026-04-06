import type { PageServerLoad } from './$types';
import { setPublicPageCache } from '$lib/server/cache/page';

const CACHE_TTL = 30 * 60; // 30 minutes
const CACHE_TTL_NOT_FOUND = 5 * 60; // 5 minutes for 404s

interface UserProfileLoadResult {
  profile: UserProfile | null;
  skills: Skill[];
  error?: string;
}

interface UserSkillRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  stars: number;
  updatedAt: number;
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

export const load: PageServerLoad = async ({ params, platform, setHeaders, locals, request }) => {
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

  if (!db || !username) {
    return {
      profile: null,
      skills: [],
      error: 'Invalid request',
    };
  }

  // Try to get from cache first
  const cacheKey = `user-profile:${username}`;
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
    SELECT u.id, u.name, u.email, u.image, u.created_at as joinedAt,
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
      email: string | null;
      image: string | null;
      joinedAt: number;
      githubUsername: string | null;
    }>();

  if (!user) {
    user = await db.prepare(`
      SELECT u.id, u.name, u.email, u.image, u.created_at as joinedAt,
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
        email: string | null;
        image: string | null;
        joinedAt: number;
        githubUsername: string | null;
      }>();
  }

  if (user) {
    // Found registered user - get their skills by owner_id
    const skillsResult = await db.prepare(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.description,
        s.stars,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt
      FROM skills s INDEXED BY skills_owner_visibility_stars_idx
      WHERE s.owner_id = ? AND s.visibility = 'public'
      ORDER BY s.stars DESC, COALESCE(s.last_commit_at, s.updated_at) DESC
    `)
      .bind(user.id)
      .all<UserSkillRow>();

    const skills = await hydrateCategories(db, skillsResult.results || []);
    const totalStars = skills.reduce((sum, s) => sum + (s.stars || 0), 0);

    const result = {
      profile: {
        id: user.id,
        name: user.name,
        image: user.image,
        bio: null as string | null,
        githubUsername: user.githubUsername,
        skillCount: skills.length,
        totalStars,
        joinedAt: user.joinedAt,
        isRegistered: true,
        type: 'User' as const,
      },
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description || '',
        stars: s.stars || 0,
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

  // Get skills by repo_owner (GitHub username)
  const skillsResult = await db.prepare(`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.stars,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt
    FROM skills s INDEXED BY skills_visibility_repo_owner_idx
    WHERE s.repo_owner = ? AND s.visibility = 'public'
    ORDER BY s.stars DESC, COALESCE(s.last_commit_at, s.updated_at) DESC
  `)
    .bind(username)
    .all<UserSkillRow>();

  const skills = await hydrateCategories(db, skillsResult.results || []);
  const totalStars = skills.reduce((sum, s) => sum + (s.stars || 0), 0);

  const result = {
    profile: {
      id: author.id,
      name: author.displayName || author.username,
      image: author.avatarUrl,
      bio: author.bio,
      githubUsername: author.username,
      skillCount: skills.length,
      totalStars,
      joinedAt: author.createdAt,
      isRegistered: false,
      type: (author.type || 'User') as 'User' | 'Organization',
    },
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description || '',
      stars: s.stars || 0,
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
