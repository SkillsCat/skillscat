import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ApiResponse, SkillCardData } from '$lib/types';
import { getCached, invalidateCache } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';
import { getRelatedSkills } from '$lib/server/db/utils';
import { buildSkillSlug, normalizeSkillName, normalizeSkillOwner } from '$lib/skill-path';
import {
  markRelatedFallbackServed,
  normalizeRelatedAlgoVersion,
  readRelatedPrecomputedPayload,
  upsertRelatedStateFailure,
  upsertRelatedStateSuccess,
  writeRelatedPrecomputedPayload,
} from '$lib/server/related-precompute';

const RELATED_RESPONSE_LIMIT = 6;
const RELATED_CACHE_LIMIT = 10;
const RELATED_CACHE_TTL = 3600;
const PRECOMPUTED_READ_CACHE_TTL = 120;

interface RuntimeEnv {
  DB?: D1Database;
  R2?: R2Bucket;
  WORKER_SECRET?: string;
  RELATED_ALGO_VERSION?: string;
}

interface SkillContextRow {
  id: string;
  slug: string;
  repoOwner: string | null;
  visibility: 'public' | 'private' | 'unlisted' | null;
  tier: string | null;
  categoriesJson: string | null;
  tagsJson: string | null;
  relatedDirty: number | null;
  relatedNextUpdateAt: number | null;
  relatedPrecomputedAt: number | null;
  relatedAlgoVersion: string | null;
}

function hasStatus(errorValue: unknown): errorValue is { status: number } {
  return typeof errorValue === 'object' && errorValue !== null && 'status' in errorValue;
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function shouldRefreshPrecomputed(
  skill: SkillContextRow,
  algoVersion: string,
  now: number
): boolean {
  if ((skill.relatedDirty ?? 0) === 1) return true;
  if (skill.relatedAlgoVersion && skill.relatedAlgoVersion !== algoVersion) return true;
  if (skill.relatedNextUpdateAt !== null && skill.relatedNextUpdateAt <= now) return true;

  const hasState = skill.relatedDirty !== null
    || skill.relatedNextUpdateAt !== null
    || skill.relatedPrecomputedAt !== null
    || skill.relatedAlgoVersion !== null;
  if (!hasState) return true;

  return false;
}

function isAuthorizedWorkerRefresh(request: Request, env: RuntimeEnv | undefined): boolean {
  const secret = env?.WORKER_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export const GET: RequestHandler = async ({ params, platform, request, locals, url }) => {
  const perfStart = performance.now();
  const serverTimings: Array<{ name: string; dur: number; desc?: string }> = [];
  const pushTiming = (name: string, start: number, desc?: string) => {
    serverTimings.push({ name, dur: Math.max(0, performance.now() - start), desc });
  };
  const timed = async <T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      pushTiming(name, start, desc);
    }
  };
  const buildServerTimingHeader = () => {
    const entries = [
      ...serverTimings,
      { name: 'total', dur: Math.max(0, performance.now() - perfStart), desc: 'related api' }
    ];
    return entries
      .map((entry) => {
        const dur = Number(entry.dur.toFixed(1));
        const descPart = entry.desc ? `;desc="${entry.desc.replace(/"/g, '')}"` : '';
        return `${entry.name};dur=${dur}${descPart}`;
      })
      .join(', ');
  };

  const owner = normalizeSkillOwner(params.owner);
  const name = normalizeSkillName(params.name);
  if (!owner || !name) {
    throw error(400, 'Invalid skill identifier');
  }

  const env = platform?.env as RuntimeEnv | undefined;
  const db = env?.DB;
  if (!db) {
    return json({
      success: false,
      error: 'Database not available',
    } satisfies ApiResponse<never>, { status: 503 });
  }

  const slug = buildSkillSlug(owner, name);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const algoVersion = normalizeRelatedAlgoVersion(env?.RELATED_ALGO_VERSION);
  const now = Date.now();

  if (forceRefresh && !isAuthorizedWorkerRefresh(request, env)) {
    return json({
      success: false,
      error: 'Forbidden',
    } satisfies ApiResponse<never>, { status: 403 });
  }

  try {
    const skill = await timed(
      'ctx_skill',
      () => db.prepare(`
      SELECT
        s.id,
        s.slug,
        s.repo_owner as repoOwner,
        s.visibility,
        s.tier,
        (
          SELECT json_group_array(sc.category_slug)
          FROM skill_categories sc
          WHERE sc.skill_id = s.id
        ) as categoriesJson,
        (
          SELECT json_group_array(st.tag)
          FROM skill_tags st
          WHERE st.skill_id = s.id
        ) as tagsJson,
        rs.dirty as relatedDirty,
        rs.next_update_at as relatedNextUpdateAt,
        rs.precomputed_at as relatedPrecomputedAt,
        rs.algo_version as relatedAlgoVersion
      FROM skills s
      LEFT JOIN skill_related_state rs ON rs.skill_id = s.id
      WHERE s.slug = ?
      LIMIT 1
    `)
        .bind(slug)
        .first<SkillContextRow>(),
      'skill context + related state'
    );

    if (!skill) {
      return json({
        success: false,
        error: 'Skill not found',
      } satisfies ApiResponse<never>, { status: 404 });
    }

    if (skill.visibility === 'private') {
      const auth = await getAuthContext(request, locals, db);
      if (!auth.userId) {
        return json({
          success: false,
          error: 'Authentication required',
        } satisfies ApiResponse<never>, { status: 401 });
      }
      requireScope(auth, 'read');
      const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
      if (!hasAccess) {
        return json({
          success: false,
          error: 'You do not have permission to access this skill',
        } satisfies ApiResponse<never>, { status: 403 });
      }
    }

    const categories = parseJsonStringArray(skill.categoriesJson);
    const preloadedTags = parseJsonStringArray(skill.tagsJson);
    const precomputedCacheKey = `related:precomputed:${skill.id}:${algoVersion}`;

    const computeRelatedOnline = async (useOnlineCache: boolean): Promise<SkillCardData[]> => {
      const runCompute = () => getRelatedSkills(
        { DB: db },
        skill.id,
        categories,
        skill.repoOwner || '',
        RELATED_CACHE_LIMIT,
        (name, dur, desc) => {
          serverTimings.push({ name, dur, desc });
        },
        false,
        preloadedTags
      );

      if (!useOnlineCache) {
        return runCompute();
      }

      const { data } = await getCached(
        `related:${skill.id}`,
        runCompute,
        RELATED_CACHE_TTL
      );
      return data;
    };

    const persistPrecomputed = async (relatedSkills: SkillCardData[]): Promise<void> => {
      if (skill.visibility !== 'public') return;
      const computedAt = Date.now();

      try {
        await writeRelatedPrecomputedPayload(env?.R2, {
          version: 'v1',
          algoVersion,
          skillId: skill.id,
          computedAt,
          relatedSkills: relatedSkills.slice(0, RELATED_RESPONSE_LIMIT).map((item) => ({
            id: item.id,
            name: item.name,
            slug: item.slug,
            description: item.description,
            repoOwner: item.repoOwner,
            repoName: item.repoName,
            stars: item.stars,
            forks: item.forks,
            trendingScore: item.trendingScore,
            updatedAt: item.updatedAt,
            authorAvatar: item.authorAvatar ?? null,
            categories: [],
          })),
        });
      } catch (persistError) {
        console.error('Failed to persist related precompute:', persistError);
        try {
          await upsertRelatedStateFailure(db, { skillId: skill.id, now: computedAt });
        } catch (stateFailureError) {
          console.warn('Failed to record related precompute failure state:', stateFailureError);
        }
        throw persistError;
      }

      try {
        await upsertRelatedStateSuccess(db, {
          skillId: skill.id,
          tier: skill.tier,
          algoVersion,
          now: computedAt,
        });
      } catch (stateError) {
        console.warn('Failed to update related precompute success state:', stateError);
      }

      try {
        await invalidateCache(precomputedCacheKey);
      } catch (cacheError) {
        console.warn('Failed to invalidate precomputed related cache:', cacheError);
      }
    };

    const refreshInBackground = (): void => {
      if (!platform?.context?.waitUntil) return;
      serverTimings.push({ name: 'backfill_scheduled', dur: 0, desc: 'stale-hit' });
      platform.context.waitUntil(
        (async () => {
          try {
            const refreshed = await computeRelatedOnline(false);
            await persistPrecomputed(refreshed);
          } catch (refreshError) {
            console.error('Failed background refresh for related precompute:', refreshError);
          }
        })()
      );
    };

    if (!forceRefresh && skill.visibility === 'public') {
      const { data: precomputedPayload, hit: precomputedCacheHit } = await timed(
        'precomputed_read',
        () => getCached(
          precomputedCacheKey,
          () => readRelatedPrecomputedPayload(env?.R2, skill.id, algoVersion),
          PRECOMPUTED_READ_CACHE_TTL
        ),
        'cache+r2'
      );

      if (precomputedPayload?.relatedSkills?.length) {
        if (shouldRefreshPrecomputed(skill, algoVersion, now)) {
          refreshInBackground();
        }

        return json({
          success: true,
          data: {
            relatedSkills: precomputedPayload.relatedSkills.slice(0, RELATED_RESPONSE_LIMIT).map((item) => ({
              ...item,
              categories: item.categories ?? [],
            })) as SkillCardData[],
          },
        } satisfies ApiResponse<{ relatedSkills: SkillCardData[] }>, {
          headers: {
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
            'X-Cache': precomputedCacheHit ? 'HIT' : 'MISS',
            'Server-Timing': buildServerTimingHeader(),
          },
        });
      }
    }

    const relatedSkills = await timed(
      'fallback_online',
      () => computeRelatedOnline(!forceRefresh),
      forceRefresh ? 'force refresh' : 'online fallback'
    );

    if (forceRefresh) {
      await persistPrecomputed(relatedSkills);
    } else if (platform?.context?.waitUntil) {
      serverTimings.push({ name: 'backfill_scheduled', dur: 0, desc: 'fallback' });
      platform.context.waitUntil(
        (async () => {
          try {
            await Promise.all([
              persistPrecomputed(relatedSkills),
              markRelatedFallbackServed(db, skill.id),
            ]);
          } catch (backfillError) {
            console.error('Failed fallback backfill for related precompute:', backfillError);
          }
        })()
      );
    } else {
      try {
        await Promise.all([
          persistPrecomputed(relatedSkills),
          markRelatedFallbackServed(db, skill.id),
        ]);
      } catch (backfillError) {
        console.error('Failed synchronous fallback backfill for related precompute:', backfillError);
      }
    }

    return json({
      success: true,
      data: {
        relatedSkills: relatedSkills.slice(0, RELATED_RESPONSE_LIMIT),
      },
    } satisfies ApiResponse<{ relatedSkills: SkillCardData[] }>, {
      headers: {
        'Cache-Control': skill.visibility === 'private'
          ? 'private, max-age=30, stale-while-revalidate=60'
          : 'public, max-age=300, stale-while-revalidate=3600',
        'X-Cache': 'MISS',
        'Server-Timing': buildServerTimingHeader(),
      },
    });
  } catch (err) {
    console.error('Error fetching related skills:', err);
    if (hasStatus(err)) throw err;
    return json({
      success: false,
      error: 'Failed to fetch related skills',
    } satisfies ApiResponse<never>, {
      status: 500,
      headers: {
        'Server-Timing': buildServerTimingHeader(),
      }
    });
  }
};
