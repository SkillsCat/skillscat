import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
  DEFAULT_USER_SKILLS_LIMIT,
  loadUserSkillsPage,
  parseUserSkillsPage,
  parseUserSkillsView,
} from '$lib/server/user-skill-list';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const view = parseUserSkillsView(url.searchParams.get('view'));
  const result = await loadUserSkillsPage(db, session.user.id, {
    page: parseUserSkillsPage(url.searchParams.get('page')),
    limit: DEFAULT_USER_SKILLS_LIMIT,
    view,
  });

  return {
    ...result,
    pagination: {
      ...result.pagination,
      baseUrl: view === 'submitted' ? '/user/skills?view=submitted' : '/user/skills',
    },
  };
};
