import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCached } from '$lib/server/cache';
import { getAuthContext } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/permissions';
import {
  buildSkillSlug,
  buildUploadSkillR2Key,
  normalizeSkillName,
  normalizeSkillOwner,
  parseSkillSlug,
} from '$lib/skill-path';

const PUBLIC_CACHE_TTL_SECONDS = 300;

interface RegistrySkillRow {
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
}

class PublicSkillCacheBypass extends Error {
  reason: 'not_found' | 'private' | 'unlisted';
  row: RegistrySkillRow | null;

  constructor(reason: 'not_found' | 'private' | 'unlisted', row: RegistrySkillRow | null = null) {
    super(reason);
    this.reason = reason;
    this.row = row;
  }
}

function baseCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    Vary: 'Authorization',
  };
}

function responseHeaders(opts: { cacheControl: string; cacheStatus?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    ...baseCorsHeaders(),
    'Cache-Control': opts.cacheControl,
  };
  if (opts.cacheStatus) {
    headers['X-Cache'] = opts.cacheStatus;
  }
  return headers;
}

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
 * GET /registry/skill/[owner]/[...name] - Get skill by owner and name
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const owner = normalizeSkillOwner(params.owner);
  const name = normalizeSkillName(params.name);
  if (!owner || !name) {
    return json(
      { error: 'Invalid skill identifier' },
      { status: 400, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
    );
  }
  const slug = buildSkillSlug(owner, name);

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  try {
    if (!db) {
      return json(
        { error: 'Database not available' },
        { status: 503, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
      );
    }

    let row: RegistrySkillRow | null = null;
    let skill: RegistrySkillItem | null = null;
    let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';

    try {
      const cached = await getCached(
        `registry:skill:${slug}`,
        async () => {
          const publicRow = await fetchSkillRow(db, slug);
          if (!publicRow) {
            throw new PublicSkillCacheBypass('not_found');
          }
          if (publicRow.visibility !== 'public') {
            throw new PublicSkillCacheBypass(publicRow.visibility as 'private' | 'unlisted', publicRow);
          }
          return buildRegistrySkill(publicRow, r2);
        },
        PUBLIC_CACHE_TTL_SECONDS,
        { waitUntil }
      );

      skill = cached.data;
      cacheStatus = cached.hit ? 'HIT' : 'MISS';
    } catch (err) {
      if (err instanceof PublicSkillCacheBypass) {
        row = err.row;
      } else {
        throw err;
      }
    }

    if (skill) {
      return json(skill, {
        headers: responseHeaders({
          cacheControl: `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
          cacheStatus,
        })
      });
    }

    if (!row) {
      return json(
        { error: 'Skill not found' },
        { status: 404, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
      );
    }

    if (row.visibility === 'private') {
      const auth = await getAuthContext(request, locals, db);
      if (!auth.userId) {
        return json(
          { error: 'Authentication required to access this skill' },
          { status: 401, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
        );
      }
      if (!auth.scopes.includes('read')) {
        return json(
          { error: "Scope 'read' required" },
          { status: 403, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
        );
      }
      const hasAccess = await checkSkillAccess(row.id, auth.userId, db);
      if (!hasAccess) {
        return json(
          { error: 'You do not have permission to access this skill' },
          { status: 403, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
        );
      }
    }

    skill = await buildRegistrySkill(row, r2);

    return json(skill, {
      headers: responseHeaders({
        cacheControl: 'private, no-cache',
        cacheStatus: 'BYPASS',
      })
    });
  } catch (err) {
    console.error('Error fetching skill:', err);
    return json(
      { error: 'Failed to fetch skill' },
      { status: 500, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
    );
  }
};

async function fetchSkillRow(db: D1Database, slug: string): Promise<RegistrySkillRow | null> {
  return db.prepare(`
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
  `).bind(slug).first<RegistrySkillRow>();
}

async function buildRegistrySkill(row: RegistrySkillRow, r2: R2Bucket | undefined): Promise<RegistrySkillItem> {
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

  return {
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
}

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
