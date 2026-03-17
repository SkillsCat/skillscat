import { getCached } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { getAccessibleSkillIds } from '$lib/server/permissions';

const MAX_PATH_LENGTH = 512;
const MAX_OWNER_LENGTH = 100;
const MAX_REPO_LENGTH = 100;
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const PUBLIC_CACHE_TTL_SECONDS = 60;

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

export interface RegistryRepoInput {
  owner: string;
  repo: string;
  pathFilter: string | null;
}

export interface ResolvedRegistryRepo {
  data: RegistryRepoResult;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
}

function normalizeRepoParam(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;
  if (normalized.length > maxLength) return null;
  if (!REPO_SEGMENT_PATTERN.test(normalized)) return null;
  return normalized;
}

function normalizePathQuery(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  if (normalized.length > MAX_PATH_LENGTH) return null;
  return normalized.replace(/\/SKILL\.md$/i, '');
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function buildRepoCacheKey(owner: string, repo: string, pathFilter: string | null): string {
  return `registry-repo:${owner.toLowerCase()}:${repo.toLowerCase()}:${pathFilter === null ? 'path:*' : `path:${pathFilter}`}`;
}

export function parseRegistryRepoInput(input: Record<string, unknown>): RegistryRepoInput | null {
  const owner = normalizeRepoParam(input.owner, MAX_OWNER_LENGTH);
  const repo = normalizeRepoParam(input.repo, MAX_REPO_LENGTH);

  const hasPathFilter = hasOwn(input, 'path') || hasOwn(input, 'skillPath');
  const rawPath = hasOwn(input, 'path') ? input.path : input.skillPath;
  const normalizedPath = hasPathFilter ? normalizePathQuery(rawPath) : null;

  if (!owner || !repo) {
    return null;
  }

  if (hasPathFilter && normalizedPath === null) {
    return null;
  }

  return {
    owner,
    repo,
    pathFilter: hasPathFilter ? (normalizedPath || '') : null,
  };
}

export async function resolveRegistryRepo(
  {
    db,
    request,
    locals,
    waitUntil,
  }: {
    db: D1Database | undefined;
    request: Request;
    locals: App.Locals;
    waitUntil?: (promise: Promise<unknown>) => void;
  },
  input: RegistryRepoInput
): Promise<ResolvedRegistryRepo> {
  if (!db) {
    return {
      data: { skills: [], total: 0 },
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
    };
  }

  let accessiblePrivateIds: string[] = [];
  const auth = await getAuthContext(request, locals, db);
  if (auth.userId) {
    requireScope(auth, 'read');
    accessiblePrivateIds = await getAccessibleSkillIds(auth.userId, db);
  }

  const canCachePublic = !auth.userId;

  if (canCachePublic) {
    const cached = await getCached(
      buildRepoCacheKey(input.owner, input.repo, input.pathFilter),
      async () => fetchRepoSkills(db, { ...input, accessiblePrivateIds: [] }),
      PUBLIC_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    return {
      data: cached.data,
      cacheControl: `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=180`,
      cacheStatus: cached.hit ? 'HIT' : 'MISS',
    };
  }

  return {
    data: await fetchRepoSkills(db, { ...input, accessiblePrivateIds }),
    cacheControl: 'private, no-cache',
    cacheStatus: 'BYPASS',
  };
}

async function fetchRepoSkills(
  db: D1Database,
  {
    owner,
    repo,
    pathFilter,
    accessiblePrivateIds,
  }: RegistryRepoInput & { accessiblePrivateIds: string[] }
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
