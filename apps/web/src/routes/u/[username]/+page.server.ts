import type { PageServerLoad } from './$types';

const CACHE_TTL = 300; // 5 minutes
const CACHE_TTL_NOT_FOUND = 60; // 1 minute for 404s

export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
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
        const data = await cached.json();
        if (!data?.profile && data?.error === 'User not found') {
          setHeaders({ 'X-Skillscat-Status-Override': '404' });
        }
        return data as {
          profile: UserProfile | null;
          skills: Skill[];
          error?: string;
        };
      }
    } catch {
      // Cache miss or error, continue to DB query
    }
  }

  // Try to find registered user by:
  // 1. GitHub account_id (username from GitHub OAuth)
  // 2. User name (display name)
  const user = await db.prepare(`
    SELECT u.id, u.name, u.email, u.image, u.created_at as joinedAt,
           a.account_id as githubUsername
    FROM user u
    LEFT JOIN account a ON u.id = a.user_id AND a.provider_id = 'github'
    WHERE a.account_id = ? OR u.name = ?
    LIMIT 1
  `)
    .bind(username, username)
    .first<{
      id: string;
      name: string;
      email: string | null;
      image: string | null;
      joinedAt: number;
      githubUsername: string | null;
    }>();

  if (user) {
    // Found registered user - get their skills by owner_id
    const skillsResult = await db.prepare(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.description,
        s.stars,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
        GROUP_CONCAT(sc.category_slug) as categories
      FROM skills s
      LEFT JOIN skill_categories sc ON s.id = sc.skill_id
      WHERE s.owner_id = ? AND s.visibility = 'public'
      GROUP BY s.id
      ORDER BY s.stars DESC, COALESCE(s.last_commit_at, s.updated_at) DESC
    `)
      .bind(user.id)
      .all<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        stars: number;
        updatedAt: number;
        categories: string | null;
      }>();

    const skills = skillsResult.results || [];
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
        categories: s.categories ? s.categories.split(',') : [],
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
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      GROUP_CONCAT(sc.category_slug) as categories
    FROM skills s
    LEFT JOIN skill_categories sc ON s.id = sc.skill_id
    WHERE s.repo_owner = ? AND s.visibility = 'public'
    GROUP BY s.id
    ORDER BY s.stars DESC, COALESCE(s.last_commit_at, s.updated_at) DESC
  `)
    .bind(username)
    .all<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      stars: number;
      updatedAt: number;
      categories: string | null;
    }>();

  const skills = skillsResult.results || [];
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
      categories: s.categories ? s.categories.split(',') : [],
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
