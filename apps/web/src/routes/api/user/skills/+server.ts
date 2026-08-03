import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import {
  loadUserSkillsPage,
  parseUserSkillsLimit,
  parseUserSkillsPage,
  parseUserSkillsView,
} from '$lib/server/user-skill-list';

export const GET: RequestHandler = async ({ locals, platform, request, url }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId || !auth.user) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'read');

  const page = parseUserSkillsPage(url.searchParams.get('page'));
  const limit = parseUserSkillsLimit(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'));
  const view = parseUserSkillsView(url.searchParams.get('view'));
  const result = await loadUserSkillsPage(db, auth.userId, { page, limit, view });

  return json({
    skills: result.skills,
    total: result.pagination.totalItems,
    page,
    totalPages: result.pagination.totalPages,
    totalSubmitted: result.totalSubmitted,
    view: result.view,
  }, {
    headers: {
      'cache-control': 'private, no-store',
    },
  });
};
