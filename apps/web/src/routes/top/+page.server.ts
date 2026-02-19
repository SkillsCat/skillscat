import type { PageServerLoad } from './$types';
import { getTopSkillsPaginated } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/page-cache';

const ITEMS_PER_PAGE = 24;

export const load: PageServerLoad = async ({ url, platform, setHeaders, locals, request, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 60,
    staleWhileRevalidate: 180,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { data } = await getCached(
    `page:top:v1:${page}`,
    () => getTopSkillsPaginated(env, page, ITEMS_PER_PAGE),
    60
  );
  const { skills, total } = data;
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
