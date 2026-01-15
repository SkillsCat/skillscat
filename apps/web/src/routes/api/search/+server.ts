import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES } from '$lib/constants';
import type { SkillCardData, ApiResponse } from '$lib/types';

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const query = url.searchParams.get('q')?.toLowerCase();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 20);

    if (!query || query.length < 2) {
      return json({
        success: true,
        data: {
          skills: [],
          categories: []
        },
        meta: { total: 0 }
      });
    }

    // Search categories (from constants)
    const matchedCategories = CATEGORIES.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.keywords.some((k) => k.includes(query))
    ).slice(0, 5);

    // TODO: Search skills from D1 database
    // const db = platform?.env?.DB;
    const skills: SkillCardData[] = [];

    return json({
      success: true,
      data: {
        skills,
        categories: matchedCategories
      },
      meta: {
        total: skills.length + matchedCategories.length
      }
    } satisfies ApiResponse<{ skills: SkillCardData[]; categories: typeof matchedCategories }>);
  } catch (error) {
    console.error('Error searching:', error);
    return json({
      success: false,
      error: 'Search failed'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
