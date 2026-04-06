import type { PageServerLoad } from './$types';
import { getTrendingSkills, getRecentSkills, getTopSkills } from '$lib/server/db/business/lists';
import { getStats } from '$lib/server/db/business/stats';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/cache/page';
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

  const { data: critical } = await getCached(
    HOME_CRITICAL_CACHE_KEY,
    async () => {
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
    },
    30
  );

  return {
    ...critical,
    recent: getCached(
      HOME_RECENT_CACHE_KEY,
      () => getRecentSkills(env, 12),
      HOME_LIST_CACHE_TTL_SECONDS
    )
      .then(({ data }) => data)
      .catch(() => []),
    top: getCached(
      HOME_TOP_CACHE_KEY,
      () => getTopSkills(env, 12),
      HOME_LIST_CACHE_TTL_SECONDS
    )
      .then(({ data }) => data)
      .catch(() => []),
  };
};
