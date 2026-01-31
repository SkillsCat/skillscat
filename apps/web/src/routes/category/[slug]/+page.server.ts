import type { PageServerLoad } from './$types';
import { getCategoryBySlug } from '$lib/constants/categories';
import { getSkillsByCategoryPaginated } from '$lib/server/db/utils';

const ITEMS_PER_PAGE = 24;

export const load: PageServerLoad = async ({ params, url, platform }) => {
  const category = getCategoryBySlug(params.slug);

  if (!category) {
    return {
      category: null,
      skills: [],
      pagination: null,
    };
  }

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { skills, total } = await getSkillsByCategoryPaginated(env, params.slug, page, ITEMS_PER_PAGE);
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return {
    category,
    skills,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: ITEMS_PER_PAGE,
      baseUrl: `/category/${params.slug}`,
    },
  };
};
