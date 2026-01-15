import type { PageServerLoad } from './$types';
import { getSkillBySlug, getRelatedSkills } from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ params, platform }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  try {
    const skill = await getSkillBySlug(env, params.slug);

    if (!skill) {
      return {
        skill: null,
        relatedSkills: [],
      };
    }

    // Get related skills based on categories
    const relatedSkills = await getRelatedSkills(
      env,
      skill.id,
      skill.categories || [],
      10
    );

    return {
      skill,
      relatedSkills,
    };
  } catch (error) {
    console.error('Error loading skill:', error);
    return {
      skill: null,
      relatedSkills: [],
      error: 'Failed to load skill',
    };
  }
};
