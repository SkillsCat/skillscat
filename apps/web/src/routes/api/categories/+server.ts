import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import type { ApiResponse } from '$lib/types';
import { getCached } from '$lib/server/cache';
import { getCategoryStats, getDynamicCategories } from '$lib/server/db/business/stats';

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
    const env = {
      DB: db,
      R2: platform?.env?.R2,
    };

    const { data, hit } = await getCached(
      'api:categories',
      async () => {
        const categoryCounts = await getCategoryStats(env);
        const dynamicCategories = await getDynamicCategories(db) as DynamicCategory[];

        const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
          ...cat,
          skillCount: categoryCounts[cat.slug] || 0
        }));

        return { categories, dynamicCategories };
      },
      3600
    );

    return json({
      success: true,
      data
    } satisfies ApiResponse<CategoriesResponse>, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=21600',
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
