import type { PageServerLoad } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import { getCategoryStats, getDynamicCategories } from '$lib/server/db/business/stats';
import { getCached } from '$lib/server/cache';
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
    'page:categories:v1',
    async () => {
      const stats = await getCategoryStats(env);

      const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
        ...cat,
        skillCount: stats[cat.slug] || 0,
      }));

      const dynamicCategories = await getDynamicCategories(env.DB) as DynamicCategory[];

      return { categories, dynamicCategories };
    },
    3600
  );

  return data;
};
