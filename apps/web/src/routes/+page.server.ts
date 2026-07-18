import type { PageServerLoad } from './$types';
import { getTrendingSkills, getRecentSkills, getTopSkills } from '$lib/server/db/business/lists';
import { getStats } from '$lib/server/db/business/stats';
import { getCached, invalidateCache } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/cache/page';
import { getCurrentPublicSkillIds } from '$lib/server/skill/visibility';
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

  let critical = criticalCached.data;
  let recent = recentCached.data;
  let top = topCached.data;

  if (env.DB) {
    const cachedLists = [
      ...(criticalCached.hit ? critical.trending : []),
      ...(recentCached.hit ? recent : []),
      ...(topCached.hit ? top : []),
    ];
    const cachedIds = cachedLists.map((skill) => skill.id);
    const currentPublicIds = await getCurrentPublicSkillIds(env.DB, cachedIds);

    const refreshes: Promise<void>[] = [];
    if (
      criticalCached.hit
      && critical.trending.some((skill) => !currentPublicIds.has(skill.id))
    ) {
      refreshes.push((async () => {
        await invalidateCache(HOME_CRITICAL_CACHE_KEY);
        critical = await loadCritical();
      })());
    }
    if (recentCached.hit && recent.some((skill) => !currentPublicIds.has(skill.id))) {
      refreshes.push((async () => {
        await invalidateCache(HOME_RECENT_CACHE_KEY);
        recent = await loadRecent();
      })());
    }
    if (topCached.hit && top.some((skill) => !currentPublicIds.has(skill.id))) {
      refreshes.push((async () => {
        await invalidateCache(HOME_TOP_CACHE_KEY);
        top = await loadTop();
      })());
    }
    await Promise.all(refreshes);
  }

  return {
    ...critical,
    recent: Promise.resolve(recent),
    top: Promise.resolve(top),
  };
};
