import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(raw: string | null): number {
  const parsed = Number.parseInt(raw || '0', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * GET /api/notifications - List user notifications
 */
export const GET: RequestHandler = async ({ locals, platform, url }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const limit = parseLimit(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'));
  const offset = parseOffset(url.searchParams.get('offset'));
  const unreadOnly = url.searchParams.get('unread') === 'true';

  let query = `
    SELECT id, type, title, message, metadata, read, processed, created_at, processed_at
    FROM notifications
    WHERE user_id = ?
  `;
  const params: (string | number)[] = [session.user.id];

  if (unreadOnly) {
    query += ' AND read = 0';
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await db.prepare(query)
    .bind(...params)
    .all<{
      id: string;
      type: string;
      title: string;
      message: string | null;
      metadata: string | null;
      read: number;
      processed: number;
      created_at: number;
      processed_at: number | null;
    }>();

  return json({
    success: true,
    notifications: results.results.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      metadata: n.metadata ? JSON.parse(n.metadata) : null,
      read: Boolean(n.read),
      processed: Boolean(n.processed),
      createdAt: n.created_at,
      processedAt: n.processed_at,
    })),
  });
};
