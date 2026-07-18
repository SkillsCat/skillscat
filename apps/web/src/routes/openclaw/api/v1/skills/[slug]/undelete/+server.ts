import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decodeClawHubCompatSlug } from '$lib/server/openclaw/clawhub-compat';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/auth/permissions';
import { buildOpenClawResponseHeaders } from '$lib/server/openclaw/registry';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';
import {
  acquireOpenClawPublishLock,
  readOpenClawManifest,
  releaseOpenClawPublishLock,
  writeOpenClawManifest,
} from '$lib/server/openclaw/compat-store';
import { invalidateCategoryCaches } from '$lib/server/cache/categories';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';
import { buildTouchOrganizationStatement } from '$lib/server/org/mutations';

interface SkillRow {
  id: string;
  slug: string;
  sourceType: string;
  orgId: string | null;
  orgSlug: string | null;
  repoOwner: string | null;
  repoName: string | null;
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
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const skill = await db
    .prepare(`
      SELECT
        s.id,
        s.slug,
        s.source_type as sourceType,
        s.org_id as orgId,
        s.repo_owner as repoOwner,
        s.repo_name as repoName,
        o.slug as orgSlug
      FROM skills s
      LEFT JOIN organizations o ON o.id = s.org_id
      WHERE s.slug = ?
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

  const canWrite = await canWriteSkill(skill.id, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to restore this skill.');
  }

  const publishLock = await acquireOpenClawPublishLock(r2, params.slug);
  if (!publishLock) {
    throw error(409, 'Another publish is already in progress for this skill');
  }

  try {
    const manifest = await readOpenClawManifest(r2, params.slug);
    if (!manifest?.deleted) {
      throw error(409, 'Only a skill soft-deleted through the ClawHub compatibility API can be restored.');
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

    await writeOpenClawManifest(r2, {
      ...manifest,
      deleted: false,
      deletedAt: null,
      updatedAt: now,
    });

    try {
      const updateStatement = db.prepare(`
        UPDATE skills
        SET visibility = 'public', updated_at = ?, indexed_at = ?
        WHERE id = ?
      `).bind(now, now, skill.id);
      if (skill.orgId) {
        await db.batch([
          updateStatement,
          buildTouchOrganizationStatement(db, skill.orgId, now),
        ]);
      } else {
        await updateStatement.run();
      }
    } catch (dbError) {
      try {
        await writeOpenClawManifest(r2, manifest);
      } catch (rollbackError) {
        console.error(`Failed to roll back OpenClaw restore ${skill.slug}:`, rollbackError);
      }
      throw dbError;
    }

    if (categorySlugs.length > 0) {
      try {
        await syncCategoryPublicStats(db, categorySlugs, now);
      } catch (statsError) {
        console.error(`Failed to sync category stats for restored skill ${skill.slug}:`, statsError);
      }
    }

    try {
      await invalidateOpenClawSkillCaches(skill.id, skill.slug, skill.orgSlug, {
        owner: skill.repoOwner,
        name: skill.repoName,
      });
      if (categorySlugs.length > 0) {
        await invalidateCategoryCaches(categorySlugs);
      }
    } catch (cacheError) {
      console.error(`Failed to invalidate caches for restored skill ${skill.slug}:`, cacheError);
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
  } finally {
    try {
      await releaseOpenClawPublishLock(r2, publishLock);
    } catch (lockError) {
      console.error(`Failed to release OpenClaw publish lock for ${skill.slug}:`, lockError);
    }
  }
};
