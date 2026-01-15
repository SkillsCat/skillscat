import type { PageServerLoad } from './$types';
import { getCategoryBySlug } from '$lib/constants/categories';
import { getSkillsByCategory } from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ params, platform }) => {
  const category = getCategoryBySlug(params.slug);

  if (!category) {
    return {
      category: null,
      skills: [],
    };
  }

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const { skills } = await getSkillsByCategory(env, params.slug, 100);

  return {
    category,
    skills,
  };
};
