import type { PageServerLoad } from './$types';
import { getTopSkillsPaginated } from '$lib/server/db/utils';

const ITEMS_PER_PAGE = 24;

export const load: PageServerLoad = async ({ url, platform }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { skills, total } = await getTopSkillsPaginated(env, page, ITEMS_PER_PAGE);
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return {
    skills,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: ITEMS_PER_PAGE,
      baseUrl: '/top',
    },
  };
};
