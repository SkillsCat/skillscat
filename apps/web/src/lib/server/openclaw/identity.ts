interface OpenClawOwnerContext {
  ownerHandle: string;
  orgId: string | null;
}

function normalizeHandle(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().replace(/^@+/, '');
  return normalized ? normalized : null;
}

export async function resolveOpenClawUserHandle(
  db: D1Database,
  userId: string
): Promise<string | null> {
  const author = await db
    .prepare(`
      SELECT username
      FROM authors
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(userId)
    .first<{ username: string | null }>();

  const authorHandle = normalizeHandle(author?.username);
  if (authorHandle) {
    return authorHandle;
  }

  const user = await db
    .prepare(`
      SELECT name
      FROM user
      WHERE id = ?
      LIMIT 1
    `)
    .bind(userId)
    .first<{ name: string | null }>();

  return normalizeHandle(user?.name);
}

export async function resolveOpenClawOwnerContext(
  db: D1Database,
  userId: string,
  owner: string
): Promise<OpenClawOwnerContext | null> {
  const normalizedOwner = normalizeHandle(owner);
  if (!normalizedOwner) return null;

  const userHandle = await resolveOpenClawUserHandle(db, userId);
  if (userHandle && userHandle.toLowerCase() === normalizedOwner.toLowerCase()) {
    return {
      ownerHandle: userHandle,
      orgId: null,
    };
  }

  const org = await db
    .prepare(`
      SELECT o.id, o.slug
      FROM organizations o
      INNER JOIN org_members om ON o.id = om.org_id
      WHERE o.slug = ? AND om.user_id = ?
      LIMIT 1
    `)
    .bind(normalizedOwner, userId)
    .first<{ id: string; slug: string }>();

  if (!org?.id || !org.slug) {
    return null;
  }

  return {
    ownerHandle: org.slug,
    orgId: org.id,
  };
}
