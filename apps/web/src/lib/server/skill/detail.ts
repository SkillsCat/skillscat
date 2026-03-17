import type { D1Database } from '@cloudflare/workers-types';
import type { FileNode, SkillCardData, SkillDetail } from '$lib/types';
import { getCached } from '$lib/server/cache';
import { getAuthContext } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/permissions';

const PUBLIC_CACHE_TTL_SECONDS = 300;

type WaitUntilFn = (promise: Promise<unknown>) => void;

interface SkillDetailRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoOwner: string;
  repoName: string;
  githubUrl: string;
  skillPath: string;
  stars: number;
  forks: number;
  trendingScore: number;
  updatedAt: number;
  readme: string | null;
  fileStructure: string | null;
  lastCommitAt: number | null;
  createdAt: number;
  indexedAt: number;
  sourceType: string;
  visibility: string;
  categories: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  authorBio: string | null;
  authorSkillsCount: number | null;
  authorTotalStars: number | null;
}

export interface SkillDetailPayload {
  skill: SkillDetail;
  recommendSkills: SkillCardData[];
}

export interface ResolvedSkillDetail {
  data: SkillDetailPayload | null;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  error?: string;
  status: number;
}

class PublicSkillDetailCacheBypass extends Error {
  data: SkillDetailPayload | null;
  reason: 'not_found' | 'private' | 'unlisted';

  constructor(reason: 'not_found' | 'private' | 'unlisted', data: SkillDetailPayload | null = null) {
    super(reason);
    this.reason = reason;
    this.data = data;
  }
}

function parseFileStructure(fileStructure: string | null): FileNode[] | null {
  if (!fileStructure) {
    return null;
  }

  try {
    const parsed = JSON.parse(fileStructure);
    return parsed.fileTree && Array.isArray(parsed.fileTree) ? parsed.fileTree : null;
  } catch {
    return null;
  }
}

async function fetchRecommendedSkills(db: D1Database, skill: SkillDetail): Promise<SkillCardData[]> {
  if (skill.categories.length === 0) {
    return [];
  }

  const recommendResult = await db.prepare(`
    WITH matched AS (
      SELECT
        s.id,
        s.name,
        s.slug,
        s.description,
        s.repo_owner as repoOwner,
        s.repo_name as repoName,
        s.stars,
        s.forks,
        s.trending_score as trendingScore,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt
      FROM skill_categories sc
      CROSS JOIN skills s
      WHERE s.id = sc.skill_id
        AND sc.category_slug IN (${skill.categories.map(() => '?').join(',')})
        AND s.id != ?
        AND s.visibility = 'public'
      GROUP BY s.id
      ORDER BY s.trending_score DESC
      LIMIT 6
    )
    SELECT
      matched.*,
      (
        SELECT GROUP_CONCAT(sc2.category_slug)
        FROM skill_categories sc2
        WHERE sc2.skill_id = matched.id
      ) as categories,
      a.avatar_url as authorAvatar
    FROM matched
    LEFT JOIN authors a ON matched.repoOwner = a.username
    ORDER BY matched.trendingScore DESC
  `).bind(...skill.categories, skill.id).all<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    repoOwner: string;
    repoName: string;
    stars: number;
    forks: number;
    trendingScore: number;
    updatedAt: number;
    categories: string | null;
    authorAvatar: string | null;
  }>();

  return (recommendResult.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    stars: row.stars,
    forks: row.forks,
    trendingScore: row.trendingScore,
    updatedAt: row.updatedAt,
    categories: row.categories ? row.categories.split(',') : [],
    authorAvatar: row.authorAvatar || undefined
  }));
}

async function fetchSkillDetailPayload(db: D1Database, slug: string): Promise<SkillDetailPayload | null> {
  const row = await db.prepare(`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.github_url as githubUrl,
      s.skill_path as skillPath,
      s.stars,
      s.forks,
      s.trending_score as trendingScore,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      s.readme,
      s.file_structure as fileStructure,
      s.last_commit_at as lastCommitAt,
      s.created_at as createdAt,
      s.indexed_at as indexedAt,
      s.source_type as sourceType,
      s.visibility,
      GROUP_CONCAT(sc.category_slug) as categories,
      a.username as authorUsername,
      a.display_name as authorDisplayName,
      a.avatar_url as authorAvatar,
      a.bio as authorBio,
      a.skills_count as authorSkillsCount,
      a.total_stars as authorTotalStars
    FROM skills s
    LEFT JOIN skill_categories sc ON s.id = sc.skill_id
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.slug = ?
    GROUP BY s.id
  `).bind(slug).first<SkillDetailRow>();

  if (!row) {
    return null;
  }

  const skill: SkillDetail = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    githubUrl: row.githubUrl,
    skillPath: row.skillPath,
    stars: row.stars,
    forks: row.forks,
    trendingScore: row.trendingScore,
    updatedAt: row.updatedAt,
    readme: row.readme,
    fileStructure: parseFileStructure(row.fileStructure),
    lastCommitAt: row.lastCommitAt,
    createdAt: row.createdAt,
    indexedAt: row.indexedAt,
    categories: row.categories ? row.categories.split(',') : [],
    authorAvatar: row.authorAvatar || undefined,
    authorUsername: row.authorUsername || undefined,
    authorDisplayName: row.authorDisplayName || undefined,
    authorBio: row.authorBio || undefined,
    authorSkillsCount: row.authorSkillsCount || undefined,
    authorTotalStars: row.authorTotalStars || undefined,
    visibility: (row.visibility as 'public' | 'private' | 'unlisted') || 'public',
    sourceType: (row.sourceType as 'github' | 'upload') || 'github',
  };

  return {
    skill,
    recommendSkills: await fetchRecommendedSkills(db, skill),
  };
}

export async function resolveSkillDetail(
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
): Promise<ResolvedSkillDetail> {
  if (!db) {
    return {
      data: null,
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      error: 'Database not available',
      status: 503,
    };
  }

  let data: SkillDetailPayload | null = null;
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';

  try {
    const cached = await getCached(
      `api:skill:${slug}`,
      async () => {
        const payload = await fetchSkillDetailPayload(db, slug);
        if (!payload) {
          throw new PublicSkillDetailCacheBypass('not_found');
        }
        if (payload.skill.visibility !== 'public') {
          throw new PublicSkillDetailCacheBypass(payload.skill.visibility, payload);
        }
        return payload;
      },
      PUBLIC_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    data = cached.data;
    cacheStatus = cached.hit ? 'HIT' : 'MISS';
  } catch (err) {
    if (err instanceof PublicSkillDetailCacheBypass) {
      data = err.data;
    } else {
      throw err;
    }
  }

  if (!data) {
    return {
      data: null,
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      error: 'Skill not found',
      status: 404,
    };
  }

  if (data.skill.visibility === 'private') {
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId) {
      return {
        data: null,
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
        error: 'Authentication required',
        status: 401,
      };
    }
    if (!auth.scopes.includes('read')) {
      return {
        data: null,
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
        error: "Scope 'read' required",
        status: 403,
      };
    }
    const hasAccess = await checkSkillAccess(data.skill.id, auth.userId, db);
    if (!hasAccess) {
      return {
        data: null,
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
        error: 'You do not have permission to access this skill',
        status: 403,
      };
    }

    return {
      data,
      cacheControl: 'private, no-cache',
      cacheStatus: 'BYPASS',
      status: 200,
    };
  }

  if (data.skill.visibility === 'unlisted') {
    return {
      data,
      cacheControl: 'private, no-cache',
      cacheStatus: 'BYPASS',
      status: 200,
    };
  }

  return {
    data,
    cacheControl: `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
    cacheStatus,
    status: 200,
  };
}
