import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

const ITEMS_PER_PAGE = 20;

function parsePage(raw: string | null): number {
    const parsed = Number.parseInt(raw || '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
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

    // Get org ID
    const org = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ? COLLATE NOCASE
  `)
        .bind(slug)
        .first<{ id: string }>();

    if (!org) {
        throw error(404, 'Organization not found');
    }

    // Only the owner can access the organization settings skill list.
    const membership = await db.prepare(`
    SELECT role FROM org_members WHERE org_id = ? AND user_id = ?
  `)
        .bind(org.id, session.user.id)
        .first<{ role: string }>();

    if (membership?.role !== 'owner') {
        throw error(403, 'Only the organization owner can view this page');
    }

    const currentPage = parsePage(url.searchParams.get('page'));
    const offset = (currentPage - 1) * ITEMS_PER_PAGE;
    const queryLimit = offset === 0 ? ITEMS_PER_PAGE + 1 : ITEMS_PER_PAGE;

    const results = await db.prepare(`
    SELECT id, name, slug, description, visibility, stars
    FROM skills INDEXED BY skills_org_stars_created_idx
    WHERE org_id = ?
    ORDER BY stars DESC, created_at DESC
    LIMIT ? OFFSET ?
  `)
        .bind(org.id, queryLimit, offset)
        .all<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            visibility: string;
            stars: number;
        }>();

    const hasMoreOnFirstPage = offset === 0 && results.results.length > ITEMS_PER_PAGE;
    const pageRows = hasMoreOnFirstPage ? results.results.slice(0, ITEMS_PER_PAGE) : results.results;
    let totalItems = pageRows.length;

    if (offset > 0 || hasMoreOnFirstPage) {
        const count = await db.prepare(`
        SELECT COUNT(*) as count
        FROM skills INDEXED BY skills_org_stars_created_idx
        WHERE org_id = ?
      `)
            .bind(org.id)
            .first<{ count: number }>();
        totalItems = count?.count ?? 0;
    }

    return {
        org: {
            userRole: 'owner' as const,
        },
        skills: pageRows.map(s => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            description: s.description ?? '',
            visibility: s.visibility as 'public' | 'private' | 'unlisted',
            stars: s.stars,
        })),
        totalItems,
        totalPages: Math.ceil(totalItems / ITEMS_PER_PAGE),
        currentPage,
    };
};
