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

    // Get user's tokens (no org_id)
    const results = await db.prepare(`
    SELECT id, name, token_prefix, scopes, last_used_at, expires_at, created_at
    FROM api_tokens
    WHERE user_id = ? AND org_id IS NULL AND revoked_at IS NULL
    ORDER BY created_at DESC
  `)
        .bind(session.user.id)
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
