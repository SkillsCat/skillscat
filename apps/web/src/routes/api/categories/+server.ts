import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import type { ApiResponse } from '$lib/types';
import { getCached } from '$lib/server/cache';

const PREDEFINED_CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug);

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
            const categoryPlaceholders = PREDEFINED_CATEGORY_SLUGS.map(() => '?').join(',');
            const result = await db.prepare(`
              SELECT sc.category_slug, COUNT(*) as count
              FROM skill_categories sc
              CROSS JOIN skills s
              WHERE s.id = sc.skill_id
                AND s.visibility = 'public'
                AND sc.category_slug IN (${categoryPlaceholders})
              GROUP BY sc.category_slug
            `)
              .bind(...PREDEFINED_CATEGORY_SLUGS)
              .all<{ category_slug: string; count: number }>();

            for (const row of result.results || []) {
              categoryCounts[row.category_slug] = row.count;
            }

            // Fetch AI-suggested categories
            const dynamicResult = await db.prepare(`
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
