import type { PageServerLoad } from './$types';
import { getSkillBySlug, getRelatedSkills, recordSkillAccess } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';

export const load: PageServerLoad = async ({ params, platform, locals }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    KV: platform?.env?.KV,
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

    // Record access asynchronously (don't block response)
    // This updates access counts and marks for update if needed
    if (skill.visibility === 'public') {
      recordSkillAccess(env, skill.id).catch((err) => {
        console.error('Failed to record skill access:', err);
      });
    }

    // Get related skills based on categories (multi-signal scoring, cached 1h)
    const { data: relatedSkills } = await getCached(
      `related:${skill.id}`,
      () => getRelatedSkills(env, skill.id, skill.categories || [], skill.repoOwner || '', 10),
      3600
    );

    // Check if user has bookmarked this skill
    let isBookmarked = false;
    if (userId && env.DB) {
      const bookmark = await env.DB.prepare(
        'SELECT 1 FROM favorites WHERE user_id = ? AND skill_id = ?'
      ).bind(userId, skill.id).first();
      isBookmarked = !!bookmark;
    }

    return {
      skill,
      relatedSkills,
      isOwner: skill.ownerId === userId,
      isBookmarked,
      isAuthenticated: !!userId,
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
