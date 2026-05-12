import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getTopSkillsPaginated } from '$lib/server/db/business/lists';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/cache/page';

const ITEMS_PER_PAGE = 24;
const TOP_PAGE_CACHE_TTL_SECONDS = 300;
const TOP_PAGE_STALE_WHILE_REVALIDATE_SECONDS = 900;

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
    sMaxAge: TOP_PAGE_CACHE_TTL_SECONDS,
    staleWhileRevalidate: TOP_PAGE_STALE_WHILE_REVALIDATE_SECONDS,
    varyByLanguageHeader: false,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    CACHE_VERSION: platform?.env?.CACHE_VERSION,
  };

  const page = parsePage(url.searchParams.get('page'));
  const { data } = await getCached(
    `page:top:v1:${page}`,
    () => getTopSkillsPaginated(env, page, ITEMS_PER_PAGE),
    TOP_PAGE_CACHE_TTL_SECONDS
  );
  const { skills, total } = data;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const lastPage = Math.max(1, totalPages);

  if (page > lastPage) {
    throw redirect(302, lastPage === 1 ? '/top' : `/top?page=${lastPage}`);
  }

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
