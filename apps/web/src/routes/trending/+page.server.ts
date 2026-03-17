import type { PageServerLoad } from './$types';
import { getTrendingSkillsPaginated } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/cache/page';

const ITEMS_PER_PAGE = 24;
function parsePage(raw: string | null): number {
  const parsed = Number.parseInt(raw || '1', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

export const load: PageServerLoad = async ({ url, platform, setHeaders, locals, request }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 60,
    staleWhileRevalidate: 180,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const page = parsePage(url.searchParams.get('page'));
  const { data } = await getCached(
    `page:trending:v1:${page}`,
    () => getTrendingSkillsPaginated(env, page, ITEMS_PER_PAGE),
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
      baseUrl: '/trending',
    },
  };
};
