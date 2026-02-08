import type { LayoutServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw redirect(302, '/');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const slug = params.slug;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  const membership = await db.prepare(`
    SELECT om.role
    FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string }>();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw error(403, 'Only organization owners and admins can access settings');
  }

  return {
    orgRole: membership.role as 'owner' | 'admin',
  };
};
