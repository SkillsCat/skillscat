import type { PageServerLoad } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import { getCategoryStats } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/page-cache';

interface DynamicCategory {
  slug: string;
  name: string;
  description: string | null;
  type: string;
  skillCount: number;
}

export const load: PageServerLoad = async ({ platform, setHeaders, locals, request, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 300,
    staleWhileRevalidate: 900,
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

      let dynamicCategories: DynamicCategory[] = [];
      if (env.DB) {
        try {
          const result = await env.DB.prepare(`
            SELECT slug, name, description, type, skill_count as skillCount
            FROM categories
            WHERE type = 'ai-suggested' AND skill_count > 0
            ORDER BY skill_count DESC
            LIMIT 50
          `).all<DynamicCategory>();
          dynamicCategories = result.results || [];
        } catch {
          // Database not available or query failed
        }
      }

      return { categories, dynamicCategories };
    },
    300
  );

  return data;
};
