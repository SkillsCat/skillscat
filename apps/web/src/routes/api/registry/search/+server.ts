import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit, getRateLimitKey, rateLimitHeaders, RATE_LIMITS } from '$lib/server/ratelimit';
import { getAuthContext } from '$lib/server/middleware/auth';
import { getAccessibleSkillIds } from '$lib/server/permissions';

export interface RegistrySkillItem {
  name: string;
  description: string;
  owner: string;
  repo: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  visibility: 'public' | 'private' | 'unlisted';
  slug: string;
}

export interface RegistrySearchResult {
  skills: RegistrySkillItem[];
  total: number;
}

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const query = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const includePrivate = url.searchParams.get('include_private') === 'true';

  const kv = platform?.env?.KV;
  const db = platform?.env?.DB;

  // Get auth context for private skill access
  const auth = await getAuthContext(request, locals, db);

  // Rate limiting
  if (kv) {
    const clientKey = getRateLimitKey(request);
    const rateLimitResult = await checkRateLimit(kv, clientKey, RATE_LIMITS.search);

    if (!rateLimitResult.allowed) {
      return json(
        { error: 'Rate limit exceeded. Please try again later.' },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(rateLimitResult, RATE_LIMITS.search),
            'Retry-After': String(rateLimitResult.resetAt - Math.floor(Date.now() / 1000)),
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }

  // Check cache first
  const cacheKey = `search:${query}:${category}:${limit}:${offset}`;
  if (kv) {
    try {
      const cached = await kv.get<RegistrySearchResult>(cacheKey, 'json');
      if (cached) {
        return json(cached, {
          headers: {
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
            'X-Cache': 'HIT',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch {
      // Cache miss, continue to database
    }
  }

  try {
    let skills: RegistrySkillItem[] = [];
    let total = 0;

    if (db) {
      // Get accessible private skill IDs if user is authenticated and wants private skills
      let accessiblePrivateIds: string[] = [];
      if (includePrivate && auth.userId) {
        accessiblePrivateIds = await getAccessibleSkillIds(auth.userId, db);
      }

      // Build query
      let sql = `
        SELECT
          s.id,
          s.name,
          s.slug,
          s.description,
          s.repo_owner as owner,
          s.repo_name as repo,
          s.stars,
          s.updated_at as updatedAt,
          s.visibility,
          GROUP_CONCAT(sc.category_slug) as categories
        FROM skills s
        LEFT JOIN skill_categories sc ON s.id = sc.skill_id
        WHERE (s.visibility = 'public'
      `;
      const params: (string | number)[] = [];

      // Include user's accessible private skills
      if (accessiblePrivateIds.length > 0) {
        const placeholders = accessiblePrivateIds.map(() => '?').join(',');
        sql += ` OR s.id IN (${placeholders})`;
        params.push(...accessiblePrivateIds);
      }

      sql += `)`;

      if (query) {
        sql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
        params.push(`%${query}%`, `%${query}%`);
      }

      if (category) {
        sql += ` AND sc.category_slug = ?`;
        params.push(category);
      }

      sql += ` GROUP BY s.id ORDER BY s.trending_score DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      // Execute query
      const result = await db.prepare(sql).bind(...params).all<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        owner: string;
        repo: string;
        stars: number;
        updatedAt: number;
        visibility: string;
        categories: string | null;
      }>();

      skills = (result.results || []).map(row => ({
        name: row.name,
        description: row.description || '',
        owner: row.owner || '',
        repo: row.repo || '',
        stars: row.stars || 0,
        updatedAt: row.updatedAt,
        categories: row.categories ? row.categories.split(',') : [],
        visibility: (row.visibility || 'public') as 'public' | 'private' | 'unlisted',
        slug: row.slug
      }));

      // Get total count (only public skills for unauthenticated users)
      let countSql = `SELECT COUNT(DISTINCT s.id) as total FROM skills s WHERE s.visibility = 'public'`;
      if (category) {
        countSql = `SELECT COUNT(DISTINCT s.id) as total FROM skills s LEFT JOIN skill_categories sc ON s.id = sc.skill_id WHERE s.visibility = 'public' AND sc.category_slug = ?`;
        const countResult = await db.prepare(countSql).bind(category).first<{ total: number }>();
        total = countResult?.total || 0;
      } else if (query) {
        countSql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
        const countResult = await db.prepare(countSql).bind(`%${query}%`, `%${query}%`).first<{ total: number }>();
        total = countResult?.total || 0;
      } else {
        const countResult = await db.prepare(countSql).first<{ total: number }>();
        total = countResult?.total || 0;
      }
    }

    const response: RegistrySearchResult = { skills, total };

    // Cache the result
    if (kv && skills.length > 0) {
      try {
        await kv.put(cacheKey, JSON.stringify(response), { expirationTtl: 60 });
      } catch {
        // Ignore cache write errors
      }
    }

    return json(response, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    console.error('Error searching skills:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistrySearchResult,
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
};

// Handle CORS preflight
export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
      'Access-Control-Max-Age': '86400'
    }
  });
};
