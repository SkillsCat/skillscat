import { getCached, invalidateCache } from '$lib/server/cache';
import { getAuthContext, hasScope, requireScope } from '$lib/server/auth/middleware';
import { getRegistryRepoCacheKey } from '$lib/server/cache/keys';

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

interface RegistryRepoAccess {
  userId: string | null;
  orgId: string | null;
  now: number;
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

export function canCachePublicRegistryRepo(input: RegistryRepoInput, canReadPrivate: boolean): boolean {
  // Only the unfiltered repo list has a stable key that skill mutations can
  // invalidate. Path-filtered variants remain bounded DB reads.
  return !canReadPrivate && input.pathFilter === null;
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

  const auth = await getAuthContext(request, locals, db);
  if (auth.userId || auth.orgId) {
    requireScope(auth, 'read');
  }
  const canReadPrivate = Boolean(auth.userId || auth.orgId) && hasScope(auth, 'read');
  const access: RegistryRepoAccess = {
    userId: canReadPrivate ? auth.userId : null,
    orgId: canReadPrivate ? auth.orgId : null,
    now: Date.now(),
  };

  const canCachePublic = canCachePublicRegistryRepo(input, canReadPrivate);

  if (canCachePublic) {
    const cacheKey = getRegistryRepoCacheKey(input.owner, input.repo);
    const cached = await getCached(
      cacheKey,
      async () => fetchRepoSkills(db, {
        ...input,
        access: { userId: null, orgId: null, now: Date.now() },
      }),
      PUBLIC_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    let data = cached.data;
    let cacheStatus: ResolvedRegistryRepo['cacheStatus'] = cached.hit ? 'HIT' : 'MISS';
    if (cached.hit) {
      const current = await db.prepare(`
        SELECT slug
        FROM skills
        WHERE repo_owner = ? AND repo_name = ? AND visibility = 'public'
      `)
        .bind(input.owner, input.repo)
        .all<{ slug: string }>();
      const currentSlugs = new Set((current.results || []).map((row) => row.slug));
      const cachedSlugs = new Set(cached.data.skills.map((skill) => skill.slug));
      const samePublicSet = currentSlugs.size === cachedSlugs.size
        && [...currentSlugs].every((slug) => cachedSlugs.has(slug));

      if (!samePublicSet) {
        data = await fetchRepoSkills(db, {
          ...input,
          access: { userId: null, orgId: null, now: Date.now() },
        });
        await invalidateCache(cacheKey);
        cacheStatus = 'MISS';
      }
    }

    return {
      data,
      // Shared caching is owned by the Worker Cache API. Generic edge caches
      // cannot be invalidated when a skill becomes private.
      cacheControl: 'private, no-cache',
      cacheStatus,
    };
  }

  if (!canReadPrivate) {
    return {
      data: await fetchRepoSkills(db, { ...input, access }),
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
    };
  }

  return {
    data: await fetchRepoSkills(db, { ...input, access }),
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
    access,
  }: RegistryRepoInput & { access: RegistryRepoAccess }
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

  if (access.userId) {
    sql += `
        OR (s.owner_id = ? AND s.org_id IS NULL)
        OR s.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
        OR s.id IN (
          SELECT skill_id
          FROM skill_permissions
          WHERE (
            (grantee_type = 'user' AND grantee_id = ?)
            OR (
              grantee_type = 'email'
              AND LOWER(grantee_id) = (
                SELECT LOWER(email) FROM user WHERE id = ? LIMIT 1
              )
            )
          )
          AND (expires_at IS NULL OR expires_at > ?)
        )`;
    bindValues.push(access.userId, access.userId, access.userId, access.userId, access.now);
  }

  if (access.orgId) {
    sql += ' OR s.org_id = ?';
    bindValues.push(access.orgId);
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
