import type { PageServerLoad } from './$types';
import {
  getTrendingSkills,
  getRecentSkills,
  getTopSkills,
  getStats,
} from '$lib/server/db/utils';

export const load: PageServerLoad = async ({ platform }) => {
  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };

  // 并行获取所有数据
  const [stats, trending, recent, top] = await Promise.all([
    getStats(env),
    getTrendingSkills(env, 12),
    getRecentSkills(env, 12),
    getTopSkills(env, 12),
  ]);

  return {
    stats,
    trending,
    recent,
    top,
  };
};
