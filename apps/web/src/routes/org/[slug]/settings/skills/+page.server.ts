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
