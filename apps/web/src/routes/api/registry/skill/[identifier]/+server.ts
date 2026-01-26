import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit, getRateLimitKey, rateLimitHeaders, RATE_LIMITS } from '$lib/server/ratelimit';
import { getAuthContext } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';
import { getCached } from '$lib/server/cache';

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
  visibility: 'public' | 'private' | 'unlisted';
}

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const identifier = params.identifier;

  // identifier can be:
  // - "@owner/skill-name" (e.g., "@anthropics/commit-message") - private skill format
  // - "owner/skill-name" (e.g., "anthropics/commit-message")
  // - "skill-name" (search and pick first match)

  const kv = platform?.env?.KV;
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  // Get auth context for permission checks
  const auth = await getAuthContext(request, locals, db);

  // Rate limiting (keep using KV for atomic counters)
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
    let isPrivateFormat = false;

    // Handle @owner/skill-name format (private skills)
    if (identifier.startsWith('@')) {
      isPrivateFormat = true;
      const slug = identifier; // Keep the @ prefix for slug lookup
      const parts = identifier.slice(1).split('/');
      if (parts.length === 2) {
        [owner, skillName] = parts;
      } else {
        skillName = identifier;
      }

      // Try to find by slug first for private skills
      const slugRow = await db.prepare(`
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
          s.visibility,
          GROUP_CONCAT(sc.category_slug) as categories
        FROM skills s
        LEFT JOIN skill_categories sc ON s.id = sc.skill_id
        WHERE s.slug = ?
        GROUP BY s.id
        LIMIT 1
      `).bind(slug).first<{
        id: string;
        name: string;
        description: string | null;
        owner: string | null;
        repo: string | null;
        stars: number;
        updatedAt: number;
        githubUrl: string | null;
        skillPath: string | null;
        visibility: string;
        categories: string | null;
      }>();

      if (slugRow) {
        // Check access permission for private skills
        if (slugRow.visibility === 'private') {
          if (!auth.userId) {
            return json(
              { error: 'Authentication required to access this skill' },
              { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } }
            );
          }
          const hasAccess = await checkSkillAccess(slugRow.id, auth.userId, db);
          if (!hasAccess) {
            return json(
              { error: 'You do not have permission to access this skill' },
              { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } }
            );
          }
        }

        // Fetch content and return
        let content = '';
        if (r2 && slugRow.owner && slugRow.repo) {
          try {
            const r2Key = `skills/${slugRow.owner}/${slugRow.repo}/SKILL.md`;
            const object = await r2.get(r2Key);
            if (object) {
              content = await object.text();
            }
          } catch {
            // Content not in R2
          }
        }

        const skill: RegistrySkillItem = {
          name: slugRow.name,
          description: slugRow.description || '',
          owner: slugRow.owner || '',
          repo: slugRow.repo || '',
          stars: slugRow.stars || 0,
          updatedAt: slugRow.updatedAt,
          categories: slugRow.categories ? slugRow.categories.split(',') : [],
          content,
          githubUrl: slugRow.githubUrl || '',
          visibility: slugRow.visibility as 'public' | 'private' | 'unlisted'
        };

        return json(skill, {
          headers: {
            'Cache-Control': slugRow.visibility === 'public' ? 'public, max-age=300' : 'private, no-cache',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } else if (identifier.includes('/')) {
      [owner, skillName] = identifier.split('/');
    } else {
      skillName = identifier;
    }

    // For public skills, use Cache API
    const cacheKey = `skill:${identifier}`;
    const { data: skill, hit } = await getCached(
      cacheKey,
      async () => {
        // Build query for public skills (legacy format)
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
            s.visibility,
            GROUP_CONCAT(sc.category_slug) as categories
          FROM skills s
          LEFT JOIN skill_categories sc ON s.id = sc.skill_id
          WHERE s.name = ? AND s.visibility = 'public'
        `;
        const queryParams: string[] = [skillName];

        if (owner) {
          sql += ` AND s.repo_owner = ?`;
          queryParams.push(owner);
        }

        sql += ` GROUP BY s.id LIMIT 1`;

        const row = await db.prepare(sql).bind(...queryParams).first<{
          id: string;
          name: string;
          description: string | null;
          owner: string;
          repo: string;
          stars: number;
          updatedAt: number;
          githubUrl: string;
          skillPath: string;
          visibility: string;
          categories: string | null;
        }>();

        if (!row) {
          return null;
        }

        // Fetch SKILL.md content from R2
        let content = '';
        if (r2) {
          try {
            const r2Key = `skills/${row.owner}/${row.repo}/SKILL.md`;
            const object = await r2.get(r2Key);
            if (object) {
              content = await object.text();
            }
          } catch {
            // Content not in R2, will be empty
          }
        }

        return {
          name: row.name,
          description: row.description || '',
          owner: row.owner,
          repo: row.repo,
          stars: row.stars,
          updatedAt: row.updatedAt,
          categories: row.categories ? row.categories.split(',') : [],
          content,
          githubUrl: row.githubUrl,
          visibility: (row.visibility || 'public') as 'public' | 'private' | 'unlisted'
        } satisfies RegistrySkillItem;
      },
      300
    );

    if (!skill) {
      return json(
        { error: 'Skill not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return json(skill, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Cache': hit ? 'HIT' : 'MISS',
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
