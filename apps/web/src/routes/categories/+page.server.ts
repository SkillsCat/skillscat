import type { PageServerLoad } from './$types';
import { CATEGORIES, type CategoryWithCount } from '$lib/constants/categories';
import { getCategoryStats } from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ platform }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  // Get skill counts from D1 database
  const stats = await getCategoryStats(env);

  // Merge with category definitions
  const categories: CategoryWithCount[] = CATEGORIES.map((cat) => ({
    ...cat,
    skillCount: stats[cat.slug] || 0,
  }));

  return { categories };
};
