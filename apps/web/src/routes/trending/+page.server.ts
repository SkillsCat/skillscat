import type { PageServerLoad } from './$types';
import { getTrendingSkills } from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ platform }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const skills = await getTrendingSkills(env, 100);

  return { skills };
};
