import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit, getRateLimitKey, rateLimitHeaders, RATE_LIMITS } from '$lib/server/ratelimit';

export interface RegistrySkillItem {
  name: string;
  description: string;
  owner: string;
  repo: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  content: string;
  githubUrl: string;
  platform: 'github' | 'gitlab';
}

export const GET: RequestHandler = async ({ params, platform, request }) => {
  const identifier = params.identifier;

  // identifier can be:
  // - "owner/skill-name" (e.g., "anthropics/commit-message")
  // - "skill-name" (search and pick first match)

  const kv = platform?.env?.KV;
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  // Rate limiting
  if (kv) {
    const clientKey = getRateLimitKey(request);
    const rateLimitResult = await checkRateLimit(kv, clientKey, RATE_LIMITS.skill);

    if (!rateLimitResult.allowed) {
      return json(
        { error: 'Rate limit exceeded. Please try again later.' },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(rateLimitResult, RATE_LIMITS.skill),
            'Retry-After': String(rateLimitResult.resetAt - Math.floor(Date.now() / 1000)),
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }

  // Check cache first
  const cacheKey = `skill:${identifier}`;
  if (kv) {
    try {
      const cached = await kv.get<RegistrySkillItem>(cacheKey, 'json');
      if (cached) {
        return json(cached, {
          headers: {
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
            'X-Cache': 'HIT',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch {
      // Cache miss
    }
  }

  try {
    if (!db) {
      return json(
        { error: 'Database not available' },
        { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Parse identifier
    let owner: string | undefined;
    let skillName: string;

    if (identifier.includes('/')) {
      [owner, skillName] = identifier.split('/');
    } else {
      skillName = identifier;
    }

    // Build query
    let sql = `
      SELECT
        s.id,
        s.name,
        s.description,
        s.repo_owner as owner,
        s.repo_name as repo,
        s.stars,
        s.updated_at as updatedAt,
        s.github_url as githubUrl,
        s.skill_path as skillPath,
        s.platform,
        GROUP_CONCAT(sc.category_slug) as categories
      FROM skills s
      LEFT JOIN skill_categories sc ON s.id = sc.skill_id
      WHERE s.name = ?
    `;
    const params: string[] = [skillName];

    if (owner) {
      sql += ` AND s.repo_owner = ?`;
      params.push(owner);
    }

    sql += ` GROUP BY s.id LIMIT 1`;

    const row = await db.prepare(sql).bind(...params).first<{
      id: string;
      name: string;
      description: string | null;
      owner: string;
      repo: string;
      stars: number;
      updatedAt: number;
      githubUrl: string;
      skillPath: string;
      platform: string;
      categories: string | null;
    }>();

    if (!row) {
      return json(
        { error: 'Skill not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Fetch SKILL.md content from R2
    let content = '';
    if (r2) {
      try {
        const r2Key = `${row.owner}/${row.repo}/${row.skillPath || 'SKILL.md'}`;
        const object = await r2.get(r2Key);
        if (object) {
          content = await object.text();
        }
      } catch {
        // Content not in R2, will be empty
      }
    }

    const skill: RegistrySkillItem = {
      name: row.name,
      description: row.description || '',
      owner: row.owner,
      repo: row.repo,
      stars: row.stars,
      updatedAt: row.updatedAt,
      categories: row.categories ? row.categories.split(',') : [],
      content,
      githubUrl: row.githubUrl,
      platform: (row.platform || 'github') as 'github' | 'gitlab'
    };

    // Cache the result
    if (kv) {
      try {
        await kv.put(cacheKey, JSON.stringify(skill), { expirationTtl: 300 });
      } catch {
        // Ignore cache write errors
      }
    }

    return json(skill, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    console.error('Error fetching skill:', err);
    return json(
      { error: 'Failed to fetch skill' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
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
