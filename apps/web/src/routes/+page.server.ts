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

  const loadCritical = async () => {
    const [stats, trending] = await Promise.all([
      getCached(
        PUBLIC_SKILLS_STATS_CACHE_KEY,
        () => getStats(env),
        PUBLIC_SKILLS_STATS_TTL_SECONDS
      ).then(({ data }) => data),
      getTrendingSkills(env, 12),
    ]);

    return {
      stats,
      trending,
    };
  };
  const loadRecent = () => getRecentSkills(env, 12);
  const loadTop = () => getTopSkills(env, 12);
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const [criticalCached, recentCached, topCached] = await Promise.all([
    getCached(HOME_CRITICAL_CACHE_KEY, loadCritical, 30, { waitUntil }),
    getCached(HOME_RECENT_CACHE_KEY, loadRecent, HOME_LIST_CACHE_TTL_SECONDS, { waitUntil }),
    getCached(HOME_TOP_CACHE_KEY, loadTop, HOME_LIST_CACHE_TTL_SECONDS, { waitUntil }),
  ]);

  const critical = criticalCached.data;
  const recent = recentCached.data;
  const top = topCached.data;

  // Cached payloads are served as-is. Visibility is re-confirmed off the
  // critical path: a stale entry is invalidated so the next request reloads.
  if (env.DB) {
    schedulePublicSkillVisibilityRecheck({
      db: env.DB,
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

  return {
    ...critical,
    recent: Promise.resolve(recent),
    top: Promise.resolve(top),
  };
};
