import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, platform }) => {
    const session = await locals.auth?.();
    if (!session?.user) {
        throw error(401, 'Authentication required');
    }

    const db = platform?.env?.DB;
    if (!db) {
        throw error(500, 'Database not available');
    }

    // Get user's organizations
    const results = await db.prepare(`
    SELECT o.id, o.name, o.slug, o.display_name, o.avatar_url, o.verified_at, om.role,
           (SELECT COUNT(*) FROM org_members WHERE org_id = o.id) as member_count
    FROM organizations o
    INNER JOIN org_members om ON o.id = om.org_id
    WHERE om.user_id = ?
    ORDER BY o.name
  `)
        .bind(session.user.id)
        .all<{
            id: string;
            name: string;
            slug: string;
            display_name: string | null;
            avatar_url: string | null;
            verified_at: number | null;
            role: string;
            member_count: number;
        }>();

    return {
        organizations: results.results.map(org => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            displayName: org.display_name ?? org.name,
            avatarUrl: org.avatar_url,
            verified: org.verified_at !== null,
            role: org.role,
            memberCount: org.member_count,
        })),
    };
};
