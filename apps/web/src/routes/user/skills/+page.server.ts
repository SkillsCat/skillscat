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

    // Get user's skills (owned by user directly)
    const results = await db.prepare(`
    SELECT id, name, slug, description, visibility, stars, updated_at
    FROM skills
    WHERE owner_id = ?
    ORDER BY created_at DESC
  `)
        .bind(session.user.id)
        .all<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            visibility: string;
            stars: number;
            updated_at: number;
        }>();

    return {
        skills: results.results.map(s => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            description: s.description ?? '',
            visibility: s.visibility as 'public' | 'private' | 'unlisted',
            stars: s.stars,
            updatedAt: s.updated_at,
        })),
    };
};
