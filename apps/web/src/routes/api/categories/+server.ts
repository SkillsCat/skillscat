import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import type { ApiResponse } from '$lib/types';
import { getCached } from '$lib/server/cache';

interface DynamicCategory {
  slug: string;
  name: string;
  description: string | null;
  type: string;
  skillCount: number;
}

interface CategoriesResponse {
  categories: CategoryWithCount[];
  dynamicCategories: DynamicCategory[];
}

export const GET: RequestHandler = async ({ platform }) => {
  try {
    const db = platform?.env?.DB;

    const { data, hit } = await getCached(
      'api:categories',
      async () => {
        // Get skill counts from D1 database
        let categoryCounts: Record<string, number> = {};
        let dynamicCategories: DynamicCategory[] = [];

        if (db) {
          try {
            const result = await db.prepare(`
              SELECT sc.category_slug, COUNT(*) as count
              FROM skill_categories sc
              INNER JOIN skills s ON sc.skill_id = s.id
              WHERE s.visibility = 'public'
              GROUP BY category_slug
            `).all<{ category_slug: string; count: number }>();

            for (const row of result.results || []) {
              categoryCounts[row.category_slug] = row.count;
            }

            // Fetch AI-suggested categories
            const dynamicResult = await db.prepare(`
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
            dynamicCategories = dynamicResult.results || [];
          } catch {
            // Database not available or query failed, use defaults
          }
        }

        const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
          ...cat,
          skillCount: categoryCounts[cat.slug] || 0
        }));

        return { categories, dynamicCategories };
      },
      300
    );

    return json({
      success: true,
      data
    } satisfies ApiResponse<CategoriesResponse>, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Cache': hit ? 'HIT' : 'MISS'
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return json({
      success: false,
      error: 'Failed to fetch categories'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
