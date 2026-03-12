import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decodeClawHubCompatSlug } from '$lib/server/clawhub-compat';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { canWriteSkill } from '$lib/server/permissions';
import { invalidateCache } from '$lib/server/cache';
import { buildOpenClawResponseHeaders } from '$lib/server/openclaw-registry';
import { readOpenClawManifest, writeOpenClawManifest } from '$lib/server/openclaw-compat-store';

interface SkillRow {
  id: string;
  slug: string;
  sourceType: string;
}

async function invalidateOpenClawSkillCaches(skillId: string, nativeSlug: string): Promise<void> {
  const cacheKeys = [
    `api:skill:${nativeSlug}`,
    `api:skill-files:${nativeSlug}`,
    `skill:${skillId}`,
    `recommend:${skillId}`,
    'page:home:v1',
    'page:trending:v1:1',
    'page:recent:v1:1',
    'page:top:v1:1',
    'page:categories:v1',
  ];

  await Promise.all(cacheKeys.map((cacheKey) => invalidateCache(cacheKey)));
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
  await db.prepare(`UPDATE skills SET visibility = 'public', updated_at = ? WHERE id = ?`).bind(now, skill.id).run();

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
