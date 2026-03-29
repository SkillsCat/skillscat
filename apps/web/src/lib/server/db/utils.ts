/**
 * Database utilities exports.
 */
export type { DbEnv } from '$lib/server/db/shared/types';
export { loadSkillReadmeFromR2 } from '$lib/server/db/business/readme';
export { getSkillBySlug } from '$lib/server/db/business/detail';
export { getRecommendedSkills } from '$lib/server/db/business/recommend';
export {
  getCachedList,
  getTrendingSkills,
  getTrendingSkillsPaginated,
  getRecentSkills,
  getRecentSkillsPaginated,
  getTopSkills,
  getTopSkillsPaginated,
  getSkillsByCategory,
  getSkillsByCategoryPaginated,
} from '$lib/server/db/business/lists';
export { searchSkills } from '$lib/server/db/business/search';
export { getStats, getCategoryStats } from '$lib/server/db/business/stats';
export { recordSkillAccess, resetAccessCounts } from '$lib/server/db/business/access';
