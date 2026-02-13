import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
    const session = await locals.auth?.();
    if (!session?.user) {
        throw error(401, 'Authentication required');
    }

    const db = platform?.env?.DB;
    if (!db) {
        throw error(500, 'Database not available');
    }

    const itemsPerPage = 20;
    const currentPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const offset = (currentPage - 1) * itemsPerPage;

    const [results, countResult] = await Promise.all([
        db.prepare(`
            SELECT id, name, slug, description, visibility, stars, COALESCE(last_commit_at, updated_at) as updated_at
            FROM skills
            WHERE owner_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `)
            .bind(session.user.id, itemsPerPage, offset)
            .all<{
                id: string;
                name: string;
                slug: string;
                description: string | null;
                visibility: string;
                stars: number;
                updated_at: number;
            }>(),
        db.prepare(`SELECT COUNT(*) as count FROM skills WHERE owner_id = ?`)
            .bind(session.user.id)
            .first<{ count: number }>(),
    ]);

    const totalItems = countResult?.count ?? 0;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

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
        pagination: {
            currentPage,
            totalPages,
            totalItems,
            itemsPerPage,
            baseUrl: '/user/skills',
        },
    };
};
