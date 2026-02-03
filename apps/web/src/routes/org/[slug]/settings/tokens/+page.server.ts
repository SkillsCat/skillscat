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

    // Get org and check permissions
    const membership = await db.prepare(`
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
        .bind(slug, session.user.id)
        .first<{ role: string; org_id: string }>();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw error(403, 'Only organization owners and admins can view tokens');
    }

    // Get tokens
    const results = await db.prepare(`
    SELECT id, name, token_prefix, scopes, last_used_at, expires_at, created_at
    FROM api_tokens
    WHERE org_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `)
        .bind(membership.org_id)
        .all<{
            id: string;
            name: string;
            token_prefix: string;
            scopes: string;
            last_used_at: number | null;
            expires_at: number | null;
            created_at: number;
        }>();

    return {
        tokens: results.results.map(row => ({
            id: row.id,
            name: row.name,
            tokenPrefix: row.token_prefix,
            scopes: JSON.parse(row.scopes) as string[],
            lastUsedAt: row.last_used_at,
            expiresAt: row.expires_at,
            createdAt: row.created_at,
        })),
    };
};
