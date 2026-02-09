import type { PageServerLoad } from './$types';
import { CATEGORIES } from '$lib/constants';
import { searchSkills } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/page-cache';

export const load: PageServerLoad = async ({ url, platform, setHeaders, locals, request, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 60,
    staleWhileRevalidate: 300,
  });

  const query = url.searchParams.get('q') || '';

  if (!query) {
    return {
      query: '',
      skills: [],
      matchedCategories: [],
    };
  }

  const lowerQuery = query.toLowerCase();

  // Search categories (from constants)
  const matchedCategories = CATEGORIES.filter(
    (c) =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.description.toLowerCase().includes(lowerQuery) ||
      c.keywords.some((k) => k.includes(lowerQuery))
  );

  // Search skills from D1 database
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  const { data: skills } = await getCached(
    `page:search:v1:${lowerQuery}`,
    () => searchSkills(env, query, 50),
    60
  );

  return {
    query,
    skills,
    matchedCategories,
  };
};
