import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getTopSkillsPaginated } from '$lib/server/db/business/lists';
import { PUBLIC_LIST_MAX_PAGE } from '$lib/server/db/shared/constants';
import { resolvePublicSkillDataCache } from '$lib/server/cache/public-skill-data';
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
  if (page > PUBLIC_LIST_MAX_PAGE) {
    throw error(404, 'Page not found');
  }
  const { data } = await resolvePublicSkillDataCache({
    db: env.DB,
    cacheKey: `page:top:v1:${page}`,
    load: () => getTopSkillsPaginated(env, page, ITEMS_PER_PAGE),
    ttlSeconds: TOP_PAGE_CACHE_TTL_SECONDS,
    getSkills: (value) => value.skills,
    waitUntil: platform?.context?.waitUntil?.bind(platform.context),
  });
  const { skills, total } = data;
  const totalPages = Math.min(PUBLIC_LIST_MAX_PAGE, Math.ceil(total / ITEMS_PER_PAGE));
  const lastPage = Math.max(1, totalPages);

  if (page > lastPage) {
    throw error(404, 'Page not found');
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
