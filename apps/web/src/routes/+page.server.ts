import type { PageServerLoad } from './$types';
import {
  getTrendingSkills,
  getRecentSkills,
  getTopSkills,
  getStats,
} from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/page-cache';

export const load: PageServerLoad = async ({ platform, setHeaders, locals, request, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 60,
    staleWhileRevalidate: 300,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    CACHE_VERSION: platform?.env?.CACHE_VERSION,
  };

  const { data } = await getCached(
    'page:home:v1',
    async () => {
      const [stats, trending, recent, top] = await Promise.all([
        getStats(env),
        getTrendingSkills(env, 12),
        getRecentSkills(env, 12),
        getTopSkills(env, 12),
      ]);

      return {
        stats,
        trending,
        recent,
        top,
      };
    },
    60
  );

  return data;
};
