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

    const slug = params.slug?.trim().toLowerCase();
    if (!slug) {
        throw error(400, 'Organization slug is required');
    }

    // Get org info and user's role
    const orgData = await db.prepare(`
    SELECT o.id, o.slug, o.owner_id, om.role as user_role
    FROM organizations o
    LEFT JOIN org_members om ON o.id = om.org_id AND om.user_id = ?
    WHERE o.slug = ? COLLATE NOCASE
  `)
        .bind(session.user.id, slug)
        .first<{ id: string; slug: string; owner_id: string; user_role: string | null }>();

    if (!orgData) {
        throw error(404, 'Organization not found');
    }

    // Check permissions
    if (orgData.user_role !== 'owner') {
        throw error(403, 'Only the organization owner can view members');
    }

    // Get members
    const results = await db.prepare(`
    SELECT om.user_id, om.role, om.joined_at, u.name, u.email, u.image,
           a.username as github_username
    FROM org_members om
    LEFT JOIN user u ON om.user_id = u.id
    LEFT JOIN authors a ON a.user_id = u.id
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
            github_username: string | null;
        }>();

    return {
        org: {
            userRole: orgData.user_role,
            ownerId: orgData.owner_id,
        },
        currentUserId: session.user.id,
        members: results.results.map(m => ({
            userId: m.user_id,
            role: (m.role === 'owner' ? 'owner' : 'member') as 'owner' | 'member',
            joinedAt: m.joined_at,
            name: m.name ?? '',
            githubUsername: m.github_username,
            email: m.email ?? '',
            image: m.image ?? '',
        })),
    };
};
