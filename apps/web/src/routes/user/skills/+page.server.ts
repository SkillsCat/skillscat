import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

const ITEMS_PER_PAGE = 20;

function parsePage(raw: string | null): number {
    const parsed = Number.parseInt(raw || '1', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
    const session = await locals.auth?.();
    if (!session?.user) {
        throw error(401, 'Authentication required');
    }

    const db = platform?.env?.DB;
    if (!db) {
        throw error(500, 'Database not available');
    }

    const currentPage = parsePage(url.searchParams.get('page'));
    const offset = (currentPage - 1) * ITEMS_PER_PAGE;
    const queryLimit = offset === 0 ? ITEMS_PER_PAGE + 1 : ITEMS_PER_PAGE;

    const results = await db.prepare(`
        SELECT id, name, slug, description, visibility, stars, COALESCE(last_commit_at, updated_at) as updated_at
        FROM skills
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `)
        .bind(session.user.id, queryLimit, offset)
        .all<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            visibility: string;
            stars: number;
            updated_at: number;
        }>();

    const hasMoreOnFirstPage = offset === 0 && results.results.length > ITEMS_PER_PAGE;
    const pageRows = hasMoreOnFirstPage ? results.results.slice(0, ITEMS_PER_PAGE) : results.results;

    let totalItems = 0;
    if (offset === 0 && !hasMoreOnFirstPage) {
        totalItems = pageRows.length;
    } else {
        const countResult = await db.prepare(`SELECT COUNT(*) as count FROM skills WHERE owner_id = ?`)
            .bind(session.user.id)
            .first<{ count: number }>();
        totalItems = countResult?.count ?? 0;
    }

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    return {
        skills: pageRows.map(s => ({
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
            itemsPerPage: ITEMS_PER_PAGE,
            baseUrl: '/user/skills',
        },
    };
};
