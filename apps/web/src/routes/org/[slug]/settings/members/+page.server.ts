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

    // Get org info and user's role
    const orgData = await db.prepare(`
    SELECT o.id, o.slug, om.role as user_role
    FROM organizations o
    LEFT JOIN org_members om ON o.id = om.org_id AND om.user_id = ?
    WHERE o.slug = ?
  `)
        .bind(session.user.id, slug)
        .first<{ id: string; slug: string; user_role: string | null }>();

    if (!orgData) {
        throw error(404, 'Organization not found');
    }

    // Check permissions
    if (!orgData.user_role || !['owner', 'admin'].includes(orgData.user_role)) {
        throw error(403, 'Only organization owners and admins can view members');
    }

    // Get members
    const results = await db.prepare(`
    SELECT om.user_id, om.role, om.joined_at, u.name, u.email, u.image
    FROM org_members om
    LEFT JOIN user u ON om.user_id = u.id
    WHERE om.org_id = ?
    ORDER BY om.joined_at
  `)
        .bind(orgData.id)
        .all<{
            user_id: string;
            role: string;
            joined_at: number;
            name: string | null;
            email: string | null;
            image: string | null;
        }>();

    return {
        org: {
            userRole: orgData.user_role,
        },
        members: results.results.map(m => ({
            userId: m.user_id,
            role: m.role as 'owner' | 'admin' | 'member',
            joinedAt: m.joined_at,
            name: m.name ?? '',
            email: m.email ?? '',
            image: m.image ?? '',
        })),
    };
};
