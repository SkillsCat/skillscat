import type { PageServerLoad } from './$types';
import { getSkillBySlug, getRelatedSkills } from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ params, platform, locals }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  // Get current user session
  const session = await locals.auth?.();
  const userId = session?.user?.id || null;

  try {
    const skill = await getSkillBySlug(env, params.slug, userId);

    if (!skill) {
      return {
        skill: null,
        relatedSkills: [],
        error: 'Skill not found or you do not have permission to view it.',
      };
    }

    // Get related skills based on categories (only public ones)
    const relatedSkills = await getRelatedSkills(
      env,
      skill.id,
      skill.categories || [],
      10
    );

    return {
      skill,
      relatedSkills,
      isOwner: skill.ownerId === userId,
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
