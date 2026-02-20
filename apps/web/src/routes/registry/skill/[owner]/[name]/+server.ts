import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';
import {
  buildSkillSlug,
  buildUploadSkillR2Key,
  normalizeSkillName,
  normalizeSkillOwner,
  parseSkillSlug,
} from '$lib/skill-path';

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

/**
 * GET /registry/skill/[owner]/[name] - Get skill by owner and name
 *
 * This is the two-segment path version that produces clean URLs like:
 * /registry/skill/testuser/my-skill instead of /registry/skill/%40testuser%2Fmy-skill
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const owner = normalizeSkillOwner(params.owner);
  const name = normalizeSkillName(params.name);
  if (!owner || !name) {
    return json(
      { error: 'Invalid skill identifier' },
      { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
  const slug = buildSkillSlug(owner, name);

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  try {
    if (!db) {
      return json(
        { error: 'Database not available' },
        { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Query skill by slug
    const row = await db.prepare(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.description,
        s.repo_owner as owner,
        s.repo_name as repo,
        s.stars,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
        s.github_url as githubUrl,
        s.skill_path as skillPath,
        s.source_type as sourceType,
        s.readme,
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
      slug: string;
      description: string | null;
      owner: string | null;
      repo: string | null;
      stars: number;
      updatedAt: number;
      githubUrl: string | null;
      skillPath: string | null;
      sourceType: string;
      readme: string | null;
      visibility: string;
      categories: string | null;
    }>();

    if (!row) {
      return json(
        { error: 'Skill not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Check access permission for private skills
    if (row.visibility === 'private') {
      const auth = await getAuthContext(request, locals, db);
      if (!auth.userId) {
        return json(
          { error: 'Authentication required to access this skill' },
          { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }
      requireScope(auth, 'read');
      const hasAccess = await checkSkillAccess(row.id, auth.userId, db);
      if (!hasAccess) {
        return json(
          { error: 'You do not have permission to access this skill' },
          { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }
    }

    // Fetch content from R2
    let content = '';
    if (r2) {
      try {
        if (row.sourceType === 'upload') {
          const canonicalPath = buildUploadSkillR2Key(row.slug, 'SKILL.md');
          const parsedSlug = parseSkillSlug(row.slug);
          const candidatePaths = new Set<string>();

          if (canonicalPath) {
            candidatePaths.add(canonicalPath);
          }
          if (parsedSlug) {
            // Legacy fallback for previously stored upload paths.
            candidatePaths.add(`skills/${parsedSlug.owner}/${parsedSlug.name.split('/')[0]}/SKILL.md`);
          }

          for (const key of candidatePaths) {
            const object = await r2.get(key);
            if (object) {
              content = await object.text();
              break;
            }
          }
        } else if (row.owner && row.repo) {
          const skillPathPart = row.skillPath ? `/${row.skillPath}` : '';
          const r2Key = `skills/${row.owner}/${row.repo}${skillPathPart}/SKILL.md`;
          const object = await r2.get(r2Key);
          if (object) {
            content = await object.text();
          }
        }
      } catch {
        // Content not in R2
      }
    }
    if (!content && row.readme) {
      content = row.readme;
    }

    const parsedSlug = parseSkillSlug(row.slug);

    const skill: RegistrySkillItem = {
      name: row.name,
      description: row.description || '',
      owner: row.owner || parsedSlug?.owner || '',
      repo: row.repo || parsedSlug?.name.split('/')[0] || '',
      stars: row.stars || 0,
      updatedAt: row.updatedAt,
      categories: row.categories ? row.categories.split(',') : [],
      content,
      githubUrl: row.githubUrl || '',
      visibility: row.visibility as 'public' | 'private' | 'unlisted'
    };

    return json(skill, {
      headers: {
        'Cache-Control': row.visibility === 'public' ? 'public, max-age=300' : 'private, no-cache',
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
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
};
