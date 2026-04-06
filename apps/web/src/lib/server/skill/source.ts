import { getCached } from '$lib/server/cache';
import { getSkillSourceCacheKey } from '$lib/server/cache/keys';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/auth/permissions';

const PUBLIC_SKILL_SOURCE_CACHE_TTL_SECONDS = 300;

type WaitUntilFn = (promise: Promise<unknown>) => void;

export interface SkillSourceInfo {
  id: string;
  name: string;
  slug: string;
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
  readme: string | null;
  visibility: 'public' | 'private' | 'unlisted';
  updated_at: number;
}

export interface ResolvedSkillSource {
  skill: SkillSourceInfo | null;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  error?: string;
  status: number;
}

class PublicSkillSourceCacheBypass extends Error {
  skill: SkillSourceInfo | null;
  reason: 'not_found' | 'private' | 'unlisted';

  constructor(reason: 'not_found' | 'private' | 'unlisted', skill: SkillSourceInfo | null = null) {
    super(reason);
    this.reason = reason;
    this.skill = skill;
  }
}

async function fetchSkillSourceInfo(db: D1Database, slug: string): Promise<SkillSourceInfo | null> {
  return db.prepare(`
    SELECT
      id,
      name,
      slug,
      source_type,
      repo_owner,
      repo_name,
      skill_path,
      readme,
      visibility,
      updated_at
    FROM skills
    WHERE slug = ?
    LIMIT 1
  `)
    .bind(slug)
    .first<SkillSourceInfo>();
}

export async function resolveSkillSourceInfo(
  {
    db,
    request,
    locals,
    waitUntil,
  }: {
    db: D1Database | undefined;
    request: Request;
    locals: App.Locals;
    waitUntil?: WaitUntilFn;
  },
  slug: string
): Promise<ResolvedSkillSource> {
  if (!db) {
    return {
      skill: null,
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      error: 'Database not available',
      status: 503,
    };
  }

  let skill: SkillSourceInfo | null = null;
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';

  try {
    const cached = await getCached(
      getSkillSourceCacheKey(slug),
      async () => {
        const row = await fetchSkillSourceInfo(db, slug);
        if (!row) {
          throw new PublicSkillSourceCacheBypass('not_found');
        }
        if (row.visibility !== 'public') {
          throw new PublicSkillSourceCacheBypass(row.visibility, row);
        }
        return row;
      },
      PUBLIC_SKILL_SOURCE_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    skill = cached.data;
    cacheStatus = cached.hit ? 'HIT' : 'MISS';
  } catch (err) {
    if (err instanceof PublicSkillSourceCacheBypass) {
      skill = err.skill;
    } else {
      throw err;
    }
  }

  if (!skill) {
    return {
      skill: null,
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      error: 'Skill not found',
      status: 404,
    };
  }

  if (skill.visibility === 'private') {
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId) {
      return {
        skill: null,
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
        error: 'Authentication required',
        status: 401,
      };
    }
    requireScope(auth, 'read');
    const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
    if (!hasAccess) {
      return {
        skill: null,
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
        error: 'You do not have permission to access this skill',
        status: 403,
      };
    }

    return {
      skill,
      cacheControl: 'private, no-cache',
      cacheStatus: 'BYPASS',
      status: 200,
    };
  }

  if (skill.visibility === 'unlisted') {
    return {
      skill,
      cacheControl: 'private, no-cache',
      cacheStatus: 'BYPASS',
      status: 200,
    };
  }

  return {
    skill,
    cacheControl: `public, max-age=${PUBLIC_SKILL_SOURCE_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
    cacheStatus,
    status: 200,
  };
}
