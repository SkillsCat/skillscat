import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import type { ApiResponse } from '$lib/types';

export const GET: RequestHandler = async ({ platform }) => {
  try {
    // TODO: Get actual skill counts from D1 database
    // const db = platform?.env?.DB;
    // SELECT category_slug, COUNT(*) FROM skill_categories GROUP BY category_slug

    const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
      ...cat,
      skillCount: 0
    }));

    return json({
      success: true,
      data: { categories }
    } satisfies ApiResponse<{ categories: CategoryWithCount[] }>);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return json({
      success: false,
      error: 'Failed to fetch categories'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
