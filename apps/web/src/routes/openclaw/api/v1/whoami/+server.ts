import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '$lib/server/auth/middleware';
import { resolveOpenClawUserHandle } from '$lib/server/openclaw/identity';

interface UserRow {
  id: string;
  name: string | null;
  image: string | null;
}

export const GET: RequestHandler = async ({ platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: 'Database not available.' }, { status: 503 });
  }

  const auth = await getAuthContext(request, locals, db);
  if (auth.authMethod !== 'token' || !auth.userId) {
    return json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  const user = await db
    .prepare(`
      SELECT id, name, image
      FROM user
      WHERE id = ?
      LIMIT 1
    `)
    .bind(auth.userId)
    .first<UserRow>();

  if (!user) {
    return json({ error: 'Invalid token user.' }, { status: 401 });
  }

  const handle = await resolveOpenClawUserHandle(db, auth.userId);

  return json(
    {
      user: {
        handle,
        displayName: user.name || null,
        image: user.image || null,
      },
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    }
  );
};
