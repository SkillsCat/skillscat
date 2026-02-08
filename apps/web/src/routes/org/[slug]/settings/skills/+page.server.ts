import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
    const session = await locals.auth?.();
    if (!session?.user) {
        throw error(401, 'Authentication required');
    }

    const db = platform?.env?.DB;
    if (!db) {
        throw error(500, 'Database not available');
    }

    const { slug } = params;
    if (!slug) {
        throw error(400, 'Organization slug is required');
    }

    // Get org ID
    const org = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ?
  `)
        .bind(slug)
        .first<{ id: string }>();

    if (!org) {
        throw error(404, 'Organization not found');
    }

    // Only owner/admin can access org settings skill list
    const membership = await db.prepare(`
    SELECT role FROM org_members WHERE org_id = ? AND user_id = ?
  `)
        .bind(org.id, session.user.id)
        .first<{ role: string }>();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw error(403, 'Only organization owners and admins can view this page');
    }

    // Get skills directly owned by the org
    const results = await db.prepare(`
    SELECT id, name, slug, description, visibility, stars
    FROM skills
    WHERE org_id = ?
    ORDER BY created_at DESC
  `)
        .bind(org.id)
        .all<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            visibility: string;
            stars: number;
        }>();

    return {
        org: {
            userRole: membership.role as 'owner' | 'admin',
        },
        skills: results.results.map(s => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            description: s.description ?? '',
            visibility: s.visibility as 'public' | 'private' | 'unlisted',
            stars: s.stars,
        })),
    };
};
