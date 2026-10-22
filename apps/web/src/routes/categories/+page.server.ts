import type { PageServerLoad } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import { getCategoryStats, getDynamicCategories } from '$lib/server/db/business/stats';
import { getCached } from '$lib/server/cache';
import { CATEGORIES_PAGE_CACHE_KEY } from '$lib/server/cache/keys';
import { setPublicPageCache } from '$lib/server/cache/page';

interface DynamicCategory {
  slug: string;
  name: string;
  description: string | null;
  type: string;
  skillCount: number;
}

export const load: PageServerLoad = async ({ platform, setHeaders, locals, request }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 3600,
    staleWhileRevalidate: 21600,
    varyByLanguageHeader: false,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const { data } = await getCached(
    CATEGORIES_PAGE_CACHE_KEY,
    async () => {
      const [stats, dynamicCategories] = await Promise.all([
        getCategoryStats(env),
        getDynamicCategories(env.DB) as Promise<DynamicCategory[]>,
      ]);

      const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
        ...cat,
        skillCount: stats[cat.slug] || 0,
      }));

      return { categories, dynamicCategories };
    },
    3600,
    { waitUntil: platform?.context?.waitUntil?.bind(platform.context), staleWhileRevalidate: 21600 }
  );

  return data;
};
