import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import type { ApiResponse } from '$lib/types';
import { getCached } from '$lib/server/cache';

export const GET: RequestHandler = async ({ platform }) => {
  try {
    const db = platform?.env?.DB;

    const { data, hit } = await getCached(
      'api:categories',
      async () => {
        // Get skill counts from D1 database
        let categoryCounts: Record<string, number> = {};

        if (db) {
          try {
            const result = await db.prepare(`
              SELECT category_slug, COUNT(*) as count
              FROM skill_categories
              GROUP BY category_slug
            `).all<{ category_slug: string; count: number }>();

            for (const row of result.results || []) {
              categoryCounts[row.category_slug] = row.count;
            }
          } catch {
            // Database not available or query failed, use defaults
          }
        }

        const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
          ...cat,
          skillCount: categoryCounts[cat.slug] || 0
        }));

        return { categories };
      },
      300
    );

    return json({
      success: true,
      data
    } satisfies ApiResponse<{ categories: CategoryWithCount[] }>, {
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
