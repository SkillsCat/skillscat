import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listOrgTokens } from '$lib/server/auth/api';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
    const session = await locals.auth?.();
    if (!session?.user) {
        throw error(401, 'Authentication required');
    }

    const db = platform?.env?.DB;
    if (!db) {
        throw error(500, 'Database not available');
    }

    const slug = params.slug?.trim().toLowerCase();
    if (!slug) {
        throw error(400, 'Organization slug is required');
    }

    // Get org and check permissions
    const membership = await db.prepare(`
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
  `)
        .bind(slug, session.user.id)
        .first<{ role: string; org_id: string }>();

    if (membership?.role !== 'owner') {
        throw error(403, 'Only the organization owner can view tokens');
    }

    return {
        tokens: await listOrgTokens(membership.org_id, db),
    };
};
