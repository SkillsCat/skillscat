import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decodeClawHubCompatSlug } from '$lib/server/openclaw/clawhub-compat';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/auth/permissions';
import { buildOpenClawResponseHeaders } from '$lib/server/openclaw/registry';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';
import { readOpenClawManifest, writeOpenClawManifest } from '$lib/server/openclaw/compat-store';
import { invalidateCache } from '$lib/server/cache';
import { getCategoryPageCacheKey } from '$lib/server/cache/categories';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';

interface SkillRow {
  id: string;
  slug: string;
  sourceType: string;
}

interface SkillCategoryRow {
  category_slug: string;
}

export const POST: RequestHandler = async ({ params, platform, request, locals }) => {
  const nativeSlug = decodeClawHubCompatSlug(params.slug);
  if (!nativeSlug) {
    throw error(400, 'Invalid compatibility slug.');
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  if (!db || !r2) {
    throw error(503, 'Storage not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const skill = await db
    .prepare(`
      SELECT
        id,
        slug,
        source_type as sourceType
      FROM skills
      WHERE slug = ?
      LIMIT 1
    `)
    .bind(nativeSlug)
    .first<SkillRow>();

  if (!skill) {
    throw error(404, 'Skill not found.');
  }
  if (skill.sourceType !== 'upload') {
    throw error(400, 'Only uploaded SkillsCat skills can be restored through the ClawHub compatibility API.');
  }

  const canWrite = await canWriteSkill(skill.id, auth.userId, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to restore this skill.');
  }

  const now = Date.now();
  const categoryRows = await db.prepare(`
    SELECT category_slug FROM skill_categories WHERE skill_id = ?
  `)
    .bind(skill.id)
    .all<SkillCategoryRow>();
  const categorySlugs = Array.from(
    new Set(
      (categoryRows.results || [])
        .map((row) => row.category_slug)
        .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    )
  );

  await db.prepare(`UPDATE skills SET visibility = 'public', updated_at = ? WHERE id = ?`).bind(now, skill.id).run();

  if (categorySlugs.length > 0) {
    await syncCategoryPublicStats(db, categorySlugs, now);
  }

  const manifest = await readOpenClawManifest(r2, params.slug);
  if (manifest) {
    await writeOpenClawManifest(r2, {
      ...manifest,
      deleted: false,
      deletedAt: null,
      updatedAt: now,
    });
  }

  await invalidateOpenClawSkillCaches(skill.id, skill.slug);

  if (categorySlugs.length > 0) {
    await Promise.all(
      categorySlugs.map((categorySlug) => invalidateCache(getCategoryPageCacheKey(categorySlug)))
    );
  }

  return json(
    { ok: true },
    {
      headers: buildOpenClawResponseHeaders({
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
      }),
    }
  );
};
