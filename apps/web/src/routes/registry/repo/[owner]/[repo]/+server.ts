import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { getAccessibleSkillIds } from '$lib/server/permissions';
import { getCached } from '$lib/server/cache';

const MAX_PATH_LENGTH = 512;
const MAX_OWNER_LENGTH = 100;
const MAX_REPO_LENGTH = 100;
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const PUBLIC_CACHE_TTL_SECONDS = 60;

function normalizeRepoParam(value: string | undefined, maxLength: number): string | null {
  const normalized = (value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;
  if (normalized.length > maxLength) return null;
  if (!REPO_SEGMENT_PATTERN.test(normalized)) return null;
  return normalized;
}

function normalizePathQuery(value: string | null): string | null {
  const normalized = (value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  if (normalized.length > MAX_PATH_LENGTH) return null;
  return normalized.replace(/\/SKILL\.md$/i, '');
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

function buildRepoCacheKey(owner: string, repo: string, pathFilter: string, hasPathFilter: boolean): string {
  return `registry-repo:${owner.toLowerCase()}:${repo.toLowerCase()}:${hasPathFilter ? `path:${pathFilter}` : 'path:*'}`;
}

export interface RegistryRepoSkillItem {
  slug: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  skillPath: string;
  githubUrl: string;
  visibility: 'public' | 'private' | 'unlisted';
  updatedAt: number;
  stars: number;
}

export interface RegistryRepoResult {
  skills: RegistryRepoSkillItem[];
  total: number;
}

export const GET: RequestHandler = async ({ params, platform, request, locals, url }) => {
  const owner = normalizeRepoParam(params.owner, MAX_OWNER_LENGTH);
  const repo = normalizeRepoParam(params.repo, MAX_REPO_LENGTH);
  const hasPathFilter = url.searchParams.has('path');
  const pathFilter = normalizePathQuery(url.searchParams.get('path'));
  const db = platform?.env?.DB;

  if (!owner || !repo || (hasPathFilter && pathFilter === null)) {
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
      {
        status: 400,
        headers: {
          ...baseCorsHeaders(),
          'Cache-Control': 'no-store',
        }
      }
    );
  }

  if (!db) {
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
      {
        headers: {
          ...baseCorsHeaders(),
          'Cache-Control': 'no-store',
        }
      }
    );
  }

  try {
    let accessiblePrivateIds: string[] = [];
    const auth = await getAuthContext(request, locals, db);
    if (auth.userId) {
      requireScope(auth, 'read');
      accessiblePrivateIds = await getAccessibleSkillIds(auth.userId, db);
    }

    const canCachePublic = !auth.userId;
    let response: RegistryRepoResult;
    let cacheHit = false;

    if (canCachePublic) {
      const cached = await getCached(
        buildRepoCacheKey(owner, repo, pathFilter || '', hasPathFilter),
        async () => fetchRepoSkills(db, { owner, repo, pathFilter: hasPathFilter ? (pathFilter || '') : null, accessiblePrivateIds: [] }),
        PUBLIC_CACHE_TTL_SECONDS,
      );
      response = cached.data;
      cacheHit = cached.hit;
    } else {
      response = await fetchRepoSkills(db, {
        owner,
        repo,
        pathFilter: hasPathFilter ? (pathFilter || '') : null,
        accessiblePrivateIds,
      });
    }

    return json(response, {
      headers: canCachePublic
        ? responseHeaders({
          cacheControl: `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=180`,
          cacheStatus: cacheHit ? 'HIT' : 'MISS',
        })
        : responseHeaders({
          cacheControl: 'private, no-cache',
          cacheStatus: 'BYPASS',
        })
    });
  } catch (err) {
    console.error('Error fetching registry repo skills:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
      {
        status: 500,
        headers: {
          ...baseCorsHeaders(),
          'Cache-Control': 'no-store',
        }
      }
    );
  }
};

async function fetchRepoSkills(
  db: D1Database,
  {
    owner,
    repo,
    pathFilter,
    accessiblePrivateIds,
  }: {
    owner: string;
    repo: string;
    pathFilter: string | null;
    accessiblePrivateIds: string[];
  }
): Promise<RegistryRepoResult> {
  let sql = `
    SELECT
      s.id,
      s.slug,
      s.name,
      s.description,
      s.repo_owner as owner,
      s.repo_name as repo,
      s.skill_path as skillPath,
      s.github_url as githubUrl,
      s.visibility as visibility,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      s.stars as stars
    FROM skills s
    WHERE s.repo_owner = ? AND s.repo_name = ?
      AND (
        s.visibility = 'public'
  `;
  const bindValues: Array<string | number> = [owner, repo];

  if (accessiblePrivateIds.length > 0) {
    const placeholders = accessiblePrivateIds.map(() => '?').join(',');
    sql += ` OR s.id IN (${placeholders})`;
    bindValues.push(...accessiblePrivateIds);
  }

  sql += ')';

  if (pathFilter !== null) {
    sql += ' AND COALESCE(s.skill_path, \'\') = ?';
    bindValues.push(pathFilter);
  }

  sql += ' ORDER BY CASE WHEN COALESCE(s.skill_path, \'\') = \'\' THEN 0 ELSE 1 END, COALESCE(s.skill_path, \'\') ASC, s.name COLLATE NOCASE ASC';

  const result = await db.prepare(sql).bind(...bindValues).all<{
    slug: string;
    name: string;
    description: string | null;
    owner: string | null;
    repo: string | null;
    skillPath: string | null;
    githubUrl: string | null;
    visibility: string;
    updatedAt: number;
    stars: number;
  }>();

  const skills: RegistryRepoSkillItem[] = (result.results || []).map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description || '',
    owner: row.owner || owner,
    repo: row.repo || repo,
    skillPath: row.skillPath || '',
    githubUrl: row.githubUrl || '',
    visibility: (row.visibility || 'public') as RegistryRepoSkillItem['visibility'],
    updatedAt: row.updatedAt || 0,
    stars: row.stars || 0,
  }));

  return {
    skills,
    total: skills.length,
  };
}

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
