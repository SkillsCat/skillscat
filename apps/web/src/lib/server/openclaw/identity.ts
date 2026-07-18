interface OpenClawOwnerContext {
  ownerHandle: string;
  orgId: string | null;
  orgVerifiedWithGithub: boolean;
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
  userId: string | null,
  owner: string,
  orgId: string | null = null
): Promise<OpenClawOwnerContext | null> {
  const normalizedOwner = normalizeHandle(owner);
  if (!normalizedOwner) return null;

  if (orgId) {
    const org = await db
      .prepare(`
        SELECT id, slug, github_org_id, verified_at
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `)
      .bind(orgId)
      .first<{ id: string; slug: string; github_org_id: number | null; verified_at: number | null }>();

    if (org?.slug && org.slug.toLowerCase() === normalizedOwner.toLowerCase()) {
      return {
        ownerHandle: org.slug,
        orgId: org.id,
        orgVerifiedWithGithub: org.github_org_id !== null && org.verified_at !== null,
      };
    }
    return null;
  }

  if (!userId) return null;

  const userHandle = await resolveOpenClawUserHandle(db, userId);
  if (userHandle && userHandle.toLowerCase() === normalizedOwner.toLowerCase()) {
    return {
      ownerHandle: userHandle,
      orgId: null,
      orgVerifiedWithGithub: false,
    };
  }

  const org = await db
    .prepare(`
      SELECT o.id, o.slug, o.github_org_id, o.verified_at
      FROM organizations o
      INNER JOIN org_members om ON o.id = om.org_id
      WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
      LIMIT 1
    `)
    .bind(normalizedOwner, userId)
    .first<{ id: string; slug: string; github_org_id: number | null; verified_at: number | null }>();

  if (!org?.id || !org.slug) {
    return null;
  }

  return {
    ownerHandle: org.slug,
    orgId: org.id,
    orgVerifiedWithGithub: org.github_org_id !== null && org.verified_at !== null,
  };
}
