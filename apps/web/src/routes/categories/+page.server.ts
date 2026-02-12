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
            SELECT
              c.slug,
              c.name,
              c.description,
              c.type,
              COUNT(s.id) as skillCount
            FROM categories c
            LEFT JOIN skill_categories sc ON c.slug = sc.category_slug
            LEFT JOIN skills s ON sc.skill_id = s.id AND s.visibility = 'public'
            WHERE c.type = 'ai-suggested'
            GROUP BY c.id, c.slug, c.name, c.description, c.type
            HAVING COUNT(s.id) > 0
            ORDER BY skillCount DESC
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
