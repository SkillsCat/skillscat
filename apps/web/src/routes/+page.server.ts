import { readHomeSnapshot, storeHomeSnapshot } from '$lib/server/cache/home-snapshot';
import type { PageServerLoad } from './$types';
import { getTrendingSkills, getRecentSkills, getTopSkills } from '$lib/server/db/business/lists';
import { getStats } from '$lib/server/db/business/stats';
import { getCached, invalidateCache } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/cache/page';
import { schedulePublicSkillVisibilityRecheck } from '$lib/server/skill/visibility';
import {
  HOME_CRITICAL_CACHE_KEY,
  HOME_RECENT_CACHE_KEY,
  HOME_TOP_CACHE_KEY,
  PUBLIC_SKILLS_STATS_CACHE_KEY,
} from '$lib/server/cache/keys';

const PUBLIC_SKILLS_STATS_TTL_SECONDS = 120;
const HOME_LIST_CACHE_TTL_SECONDS = 30;

export const load: PageServerLoad = async ({ platform, setHeaders, locals, request }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 30,
    staleWhileRevalidate: 120,
    varyByLanguageHeader: false,
    varyByCookie: false,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    CACHE_VERSION: platform?.env?.CACHE_VERSION,
  };

  const startedAt = performance.now();
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const cacheOptions = { waitUntil, staleWhileRevalidate: 120 };
  let snapshot: ReturnType<typeof readHomeSnapshot> | undefined;
  const readSnapshot = () => snapshot ??= readHomeSnapshot(env);
  const loadCritical = async () => {
    const cachedSnapshot = await readSnapshot();
    if (cachedSnapshot) return { stats: cachedSnapshot.stats, trending: cachedSnapshot.trending };
    const [stats, trending] = await Promise.all([
      getCached(
        PUBLIC_SKILLS_STATS_CACHE_KEY,
        () => getStats(env),
        PUBLIC_SKILLS_STATS_TTL_SECONDS,
        cacheOptions
      ).then(({ data }) => data),
      getTrendingSkills(env, 12),
    ]);

    return {
      stats,
      trending,
    };
  };
  const loadRecent = async () => (await readSnapshot())?.recent ?? getRecentSkills(env, 12);
  const loadTop = async () => (await readSnapshot())?.top ?? getTopSkills(env, 12);
  const [criticalCached, recentCached, topCached] = await Promise.all([
    getCached(HOME_CRITICAL_CACHE_KEY, loadCritical, 30, cacheOptions),
    getCached(HOME_RECENT_CACHE_KEY, loadRecent, HOME_LIST_CACHE_TTL_SECONDS, cacheOptions),
    getCached(HOME_TOP_CACHE_KEY, loadTop, HOME_LIST_CACHE_TTL_SECONDS, cacheOptions),
  ]);

  const statuses = [criticalCached, recentCached, topCached].map((entry) => entry.stale ? 'STALE' : entry.hit ? 'HIT' : 'MISS');
  setHeaders({ 'Server-Timing': `home_data;dur=${(performance.now() - startedAt).toFixed(1)};desc="${statuses.join('/')}"` });
  const critical = criticalCached.data;
  const recent = recentCached.data;
  const top = topCached.data;

  // Fill the same snapshot after a completely cold live load. Do not extend
  // the age of an existing snapshot or republish a partially stale payload.
  const r2 = env.R2;
  if (r2 && waitUntil && !criticalCached.hit && !recentCached.hit && !topCached.hit) {
    waitUntil((async () => {
      if (await readSnapshot()) return;
      await storeHomeSnapshot(r2, { ...critical, recent, top, generatedAt: Date.now() }, env.CACHE_VERSION);
    })().catch((error: unknown) => console.warn('Failed to store home snapshot:', error)));
  }

  // Cached payloads are served as-is. Visibility is re-confirmed off the
  // critical path: a stale entry is invalidated so the next request reloads.
  if (env.DB) {
    schedulePublicSkillVisibilityRecheck({
      db: env.DB,
      requireQuality: true,
      waitUntil,
      entries: [
        ...(criticalCached.hit
          ? [{
            ids: critical.trending.map((skill) => skill.id),
            invalidate: () => invalidateCache(HOME_CRITICAL_CACHE_KEY),
          }]
          : []),
        ...(recentCached.hit
          ? [{
            ids: recent.map((skill) => skill.id),
            invalidate: () => invalidateCache(HOME_RECENT_CACHE_KEY),
          }]
          : []),
        ...(topCached.hit
          ? [{
            ids: top.map((skill) => skill.id),
            invalidate: () => invalidateCache(HOME_TOP_CACHE_KEY),
          }]
          : []),
      ],
    });
  }

  // All payloads are already resolved above; return plain arrays so SSR can
  // render the sections directly instead of a client-side {#await} swap.
  return {
    ...critical,
    recent,
    top,
  };
};
