import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ApiResponse, SkillCardData } from '$lib/types';
import { getCached, invalidateCache } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/auth/permissions';
import { getRecommendedSkills } from '$lib/server/db/business/recommend';
import { isOpenClawUserAgent } from '$lib/server/openclaw/agent-markdown';
import { isCrawlerLikeRequest } from '$lib/server/request-client';
import { buildSkillSlug, normalizeSkillName, normalizeSkillOwner } from '$lib/skill-path';
import {
  buildRecommendPrecomputedCacheKey,
  type RecommendRefreshStateRow,
  readCachedRecommendSkills,
  RECOMMEND_ONLINE_CACHE_TTL_SECONDS,
  shouldRefreshPrecomputedRecommend,
} from '$lib/server/ranking/recommend-cache';
import {
  markRecommendFallbackServed,
  normalizeRecommendAlgoVersion,
  upsertRecommendStateFailure,
  upsertRecommendStateSuccess,
  writeRecommendPrecomputedPayload,
} from '$lib/server/ranking/recommend-precompute';

const RECOMMEND_RESPONSE_LIMIT = 6;
const RECOMMEND_CACHE_LIMIT = 10;
const PUBLIC_RECOMMEND_MAX_AGE_SECONDS = 1800; // 30 minutes
const PUBLIC_RECOMMEND_STALE_WHILE_REVALIDATE_SECONDS = 86400; // 1 day

function buildPublicRecommendCacheControl(): string {
  return `public, max-age=${PUBLIC_RECOMMEND_MAX_AGE_SECONDS}, stale-while-revalidate=${PUBLIC_RECOMMEND_STALE_WHILE_REVALIDATE_SECONDS}`;
}

function shouldSuppressRealtimeFallback(request: Request, tier: string | null | undefined): boolean {
  if (!isCrawlerLikeRequest(request)) {
    return false;
  }

  return tier !== 'hot' && tier !== 'warm';
}

interface RuntimeEnv {
  DB?: D1Database;
  R2?: R2Bucket;
  WORKER_SECRET?: string;
  RECOMMEND_ALGO_VERSION?: string;
}

interface SkillContextRow {
  id: string;
  slug: string;
  repoOwner: string | null;
  visibility: 'public' | 'private' | 'unlisted' | null;
  tier: string | null;
  recommendDirty: RecommendRefreshStateRow['recommendDirty'];
  recommendNextUpdateAt: RecommendRefreshStateRow['recommendNextUpdateAt'];
  recommendPrecomputedAt: RecommendRefreshStateRow['recommendPrecomputedAt'];
  recommendAlgoVersion: RecommendRefreshStateRow['recommendAlgoVersion'];
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
      { name: 'total', dur: Math.max(0, performance.now() - perfStart), desc: 'recommend api' }
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
  const algoVersion = normalizeRecommendAlgoVersion(env?.RECOMMEND_ALGO_VERSION);
  const now = Date.now();
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const isOpenClawRequest = isOpenClawUserAgent(request.headers.get('user-agent'));

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
        rs.dirty as recommendDirty,
        rs.next_update_at as recommendNextUpdateAt,
        rs.precomputed_at as recommendPrecomputedAt,
        rs.algo_version as recommendAlgoVersion
      FROM skills s
      LEFT JOIN skill_recommend_state rs ON rs.skill_id = s.id
      WHERE s.slug = ?
      LIMIT 1
    `)
        .bind(slug)
        .first<SkillContextRow>(),
      'skill context + recommend state'
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

    let skillCategories: string[] | null = null;
    let skillTags: string[] | null = null;
    const suppressRealtimeFallback = !forceRefresh
      && skill.visibility === 'public'
      && shouldSuppressRealtimeFallback(request, skill.tier);
    const loadSkillSignals = async (): Promise<{ categories: string[]; tags: string[] }> => {
      if (skillCategories && skillTags) {
        return { categories: skillCategories, tags: skillTags };
      }

      const signals = await timed(
        'ctx_signals',
        () => db.prepare(`
          SELECT
            (
              SELECT json_group_array(sc.category_slug)
              FROM skill_categories sc
              WHERE sc.skill_id = ?
            ) as categoriesJson,
            (
              SELECT json_group_array(st.tag)
              FROM skill_tags st
              WHERE st.skill_id = ?
            ) as tagsJson
        `)
          .bind(skill.id, skill.id)
          .first<{ categoriesJson: string | null; tagsJson: string | null }>(),
        'skill categories + tags'
      );

      skillCategories = parseJsonStringArray(signals?.categoriesJson ?? null);
      skillTags = parseJsonStringArray(signals?.tagsJson ?? null);
      return { categories: skillCategories, tags: skillTags };
    };

    const precomputedCacheKey = buildRecommendPrecomputedCacheKey(skill.id, algoVersion);

    const computeRecommendOnline = async (useOnlineCache: boolean): Promise<SkillCardData[]> => {
      const runCompute = async () => {
        const signals = await loadSkillSignals();
        return getRecommendedSkills(
          { DB: db },
          skill.id,
          signals.categories,
          skill.repoOwner || '',
          RECOMMEND_CACHE_LIMIT,
          (name, dur, desc) => {
            serverTimings.push({ name, dur, desc });
          },
          false,
          signals.tags
        );
      };

      if (!useOnlineCache) {
        return runCompute();
      }

      const { data } = await getCached(
        `recommend:${skill.id}`,
        runCompute,
        RECOMMEND_ONLINE_CACHE_TTL_SECONDS
      );
      return data;
    };

    const persistPrecomputed = async (recommendSkills: SkillCardData[]): Promise<void> => {
      if (skill.visibility !== 'public') return;
      const computedAt = Date.now();

      try {
        await writeRecommendPrecomputedPayload(env?.R2, {
          version: 'v1',
          algoVersion,
          skillId: skill.id,
          computedAt,
          recommendSkills: recommendSkills.slice(0, RECOMMEND_RESPONSE_LIMIT).map((item) => ({
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
        console.error('Failed to persist recommend precompute:', persistError);
        try {
          await upsertRecommendStateFailure(db, { skillId: skill.id, now: computedAt });
        } catch (stateFailureError) {
          console.warn('Failed to record recommend precompute failure state:', stateFailureError);
        }
        throw persistError;
      }

      try {
        await upsertRecommendStateSuccess(db, {
          skillId: skill.id,
          tier: skill.tier,
          algoVersion,
          now: computedAt,
        });
      } catch (stateError) {
        console.warn('Failed to update recommend precompute success state:', stateError);
      }

      try {
        await invalidateCache(precomputedCacheKey);
      } catch (cacheError) {
        console.warn('Failed to invalidate precomputed recommend cache:', cacheError);
      }
    };

    const refreshInBackground = (): void => {
      if (!waitUntil) return;
      serverTimings.push({ name: 'backfill_scheduled', dur: 0, desc: 'stale-hit' });
      waitUntil(
        (async () => {
          try {
            const refreshed = await computeRecommendOnline(false);
            await persistPrecomputed(refreshed);
          } catch (refreshError) {
            console.error('Failed background refresh for recommend precompute:', refreshError);
          }
        })()
      );
    };

    if (!forceRefresh && skill.visibility === 'public') {
      const { recommendSkills: precomputedRecommendSkills, hit: precomputedCacheHit } = await timed(
        'precomputed_read',
        async () => {
          try {
            return await readCachedRecommendSkills({
              skillId: skill.id,
              r2: env?.R2,
              algoVersion,
              waitUntil,
              limit: RECOMMEND_RESPONSE_LIMIT,
            });
          } catch (precomputedReadError) {
            console.warn('Failed to read precomputed recommend payload:', precomputedReadError);
            return {
              recommendSkills: null,
              hit: false,
              algoVersion,
            };
          }
        },
        'cache+r2'
      );

      if (precomputedRecommendSkills !== null) {
        if (
          shouldRefreshPrecomputedRecommend(skill, algoVersion, now)
          && !suppressRealtimeFallback
        ) {
          refreshInBackground();
        } else if (suppressRealtimeFallback) {
          serverTimings.push({ name: 'refresh_suppressed', dur: 0, desc: 'crawler-cold-skip' });
        }

        return json({
          success: true,
          data: {
            recommendSkills: precomputedRecommendSkills,
          },
        } satisfies ApiResponse<{ recommendSkills: SkillCardData[] }>, {
          headers: {
            'Cache-Control': buildPublicRecommendCacheControl(),
            'X-Cache': precomputedCacheHit ? 'HIT' : 'MISS',
            'Server-Timing': buildServerTimingHeader(),
          },
        });
      }

      if (isOpenClawRequest || suppressRealtimeFallback) {
        const headers: Record<string, string> = {
          'Cache-Control': buildPublicRecommendCacheControl(),
          'X-Cache': precomputedCacheHit ? 'HIT' : 'MISS',
          'Server-Timing': buildServerTimingHeader(),
        };
        if (suppressRealtimeFallback) {
          headers.Vary = 'User-Agent';
        }

        serverTimings.push({
          name: 'fallback_online',
          dur: 0,
          desc: isOpenClawRequest ? 'openclaw-cache-only' : 'crawler-cold-skip'
        });
        return json({
          success: true,
          data: {
            recommendSkills: [],
          },
        } satisfies ApiResponse<{ recommendSkills: SkillCardData[] }>, {
          headers,
        });
      }
    }

    const recommendSkills = await timed(
      'fallback_online',
      () => computeRecommendOnline(!forceRefresh),
      forceRefresh ? 'force refresh' : 'online fallback'
    );

    if (forceRefresh) {
      await persistPrecomputed(recommendSkills);
    } else if (waitUntil) {
      serverTimings.push({ name: 'backfill_scheduled', dur: 0, desc: 'fallback' });
      waitUntil(
        (async () => {
          try {
            await Promise.all([
              persistPrecomputed(recommendSkills),
              markRecommendFallbackServed(db, skill.id),
            ]);
          } catch (backfillError) {
            console.error('Failed fallback backfill for recommend precompute:', backfillError);
          }
        })()
      );
    } else {
      try {
        await Promise.all([
          persistPrecomputed(recommendSkills),
          markRecommendFallbackServed(db, skill.id),
        ]);
      } catch (backfillError) {
        console.error('Failed synchronous fallback backfill for recommend precompute:', backfillError);
      }
    }

    return json({
      success: true,
      data: {
        recommendSkills: recommendSkills.slice(0, RECOMMEND_RESPONSE_LIMIT),
      },
    } satisfies ApiResponse<{ recommendSkills: SkillCardData[] }>, {
      headers: {
        'Cache-Control': skill.visibility === 'private'
          ? 'private, max-age=30, stale-while-revalidate=60'
          : buildPublicRecommendCacheControl(),
        'X-Cache': 'MISS',
        'Server-Timing': buildServerTimingHeader(),
      },
    });
  } catch (err) {
    console.error('Error fetching recommend skills:', err);
    if (hasStatus(err)) throw err;
    return json({
      success: false,
      error: 'Failed to fetch recommend skills',
    } satisfies ApiResponse<never>, {
      status: 500,
      headers: {
        'Server-Timing': buildServerTimingHeader(),
      }
    });
  }
};
