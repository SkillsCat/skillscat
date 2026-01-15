import type { PageServerLoad } from './$types';
import { CATEGORIES } from '$lib/constants';
import { searchSkills } from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ url, platform }) => {
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

  const skills = await searchSkills(env, query, 50);

  return {
    query,
    skills,
    matchedCategories,
  };
};
