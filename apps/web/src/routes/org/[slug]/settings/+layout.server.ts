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

  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  const membership = await db.prepare(`
    SELECT om.role
    FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string }>();

  if (membership?.role !== 'owner') {
    throw error(403, 'Only the organization owner can access settings');
  }

  return {
    orgRole: 'owner' as const,
  };
};
