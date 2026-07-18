export type SkillVisibility = 'public' | 'private' | 'unlisted';

/**
 * Shared Cache API entries are local to a Cloudflare data center. Always
 * confirm the authoritative visibility before serving cached skill content so
 * a public-to-private transition cannot be bypassed by a stale edge entry.
 */
export async function getCurrentSkillVisibility(
  db: D1Database,
  slug: string
): Promise<SkillVisibility | null> {
  const row = await db.prepare(`
    SELECT visibility
    FROM skills
    WHERE slug = ?
    LIMIT 1
  `)
    .bind(slug)
    .first<{ visibility: string | null }>();

  if (!row) {
    return null;
  }

  if (row.visibility === 'public' || row.visibility === 'private' || row.visibility === 'unlisted') {
    return row.visibility;
  }

  return null;
}

export async function getCurrentPublicSkillSlugs(
  db: D1Database,
  slugs: string[]
): Promise<Set<string>> {
  const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
  if (uniqueSlugs.length === 0) {
    return new Set();
  }

  const placeholders = uniqueSlugs.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT slug
    FROM skills INDEXED BY skills_visibility_slug_idx
    WHERE visibility = 'public'
      AND slug IN (${placeholders})
  `)
    .bind(...uniqueSlugs)
    .all<{ slug: string }>();

  return new Set((result.results || []).map((row) => row.slug));
}

export async function getCurrentPublicSkillIds(
  db: D1Database,
  ids: string[]
): Promise<Set<string>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Set();
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT id
    FROM skills INDEXED BY skills_visibility_id_idx
    WHERE visibility = 'public'
      AND id IN (${placeholders})
  `)
    .bind(...uniqueIds)
    .all<{ id: string }>();

  return new Set((result.results || []).map((row) => row.id));
}
