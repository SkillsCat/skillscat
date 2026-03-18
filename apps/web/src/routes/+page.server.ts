import type { PageServerLoad } from './$types';
import {
  getTrendingSkills,
  getRecentSkills,
  getTopSkills,
  getStats,
} from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/cache/page';

export const load: PageServerLoad = async ({ platform, setHeaders, locals, request }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 30,
    staleWhileRevalidate: 120,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    CACHE_VERSION: platform?.env?.CACHE_VERSION,
  };

  const { data: critical } = await getCached(
    'page:home:critical:v1',
    async () => {
      const [stats, trending] = await Promise.all([
        getStats(env),
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
    recent: getRecentSkills(env, 12).catch(() => []),
    top: getTopSkills(env, 12).catch(() => []),
  };
};
