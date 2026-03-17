import type { PageServerLoad } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import { getCategoryStats } from '$lib/server/db/utils';
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
            WITH ai_categories AS (
              SELECT slug, name, description, type
              FROM categories
              WHERE type = 'ai-suggested'
            ),
            public_counts AS (
              SELECT sc.category_slug, COUNT(*) as skillCount
              FROM skill_categories sc
              CROSS JOIN skills s
              WHERE s.id = sc.skill_id
                AND s.visibility = 'public'
                AND sc.category_slug IN (SELECT slug FROM ai_categories)
              GROUP BY sc.category_slug
            )
            SELECT
              ai.slug,
              ai.name,
              ai.description,
              ai.type,
              pc.skillCount
            FROM public_counts pc
            CROSS JOIN ai_categories ai
            WHERE ai.slug = pc.category_slug
            ORDER BY pc.skillCount DESC
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
