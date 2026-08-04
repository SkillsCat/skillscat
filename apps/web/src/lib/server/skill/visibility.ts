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

type WaitUntilFn = (promise: Promise<unknown>) => void;

/**
 * Schedule a best-effort async visibility recheck for cached public skill
 * lists. Cached data is served immediately; this runs off the critical path
 * (via waitUntil) and invalidates the affected cache entries when a skill has
 * since become non-public or been deleted, so the next request reloads fresh
 * data. Failures are swallowed: they must never affect the response or cause
 * an unhandled rejection.
 */
export function schedulePublicSkillVisibilityRecheck(input: {
  db: D1Database;
  entries: Array<{
    ids: string[];
    invalidate: () => Promise<unknown>;
  }>;
  waitUntil?: WaitUntilFn;
}): void {
  const entries = input.entries.filter((entry) => entry.ids.length > 0);
  if (entries.length === 0) {
    return;
  }

  const allIds = Array.from(new Set(entries.flatMap((entry) => entry.ids)));
  const task = (async () => {
    try {
      const currentPublicIds = await getCurrentPublicSkillIds(input.db, allIds);
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.ids.some((id) => !currentPublicIds.has(id))) {
            await entry.invalidate();
          }
        })
      );
    } catch (error) {
      console.warn('Async public skill visibility recheck failed:', error);
    }
  })();

  if (input.waitUntil) {
    input.waitUntil(task);
    return;
  }

  void task;
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
