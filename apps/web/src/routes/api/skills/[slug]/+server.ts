import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SkillDetail, SkillCardData, ApiResponse } from '$lib/types';

export const GET: RequestHandler = async ({ params, platform }) => {
  try {
    // TODO: Replace with actual D1 database queries
    // const db = platform?.env?.DB;
    // SELECT * FROM skills WHERE slug = ?

    const skill: SkillDetail | null = null;
    const relatedSkills: SkillCardData[] = [];

    if (!skill) {
      return json({
        success: false,
        error: 'Skill not found'
      } satisfies ApiResponse<never>, { status: 404 });
    }

    return json({
      success: true,
      data: {
        skill,
        relatedSkills
      }
    } satisfies ApiResponse<{ skill: SkillDetail; relatedSkills: SkillCardData[] }>);
  } catch (err) {
    console.error('Error fetching skill:', err);
    return json({
      success: false,
      error: 'Failed to fetch skill'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
