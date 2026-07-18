import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
  buildOpenClawStats,
} from '$lib/server/openclaw/registry';
import {
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '$lib/server/openclaw/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';
import {
  buildOpenClawSkillDetailCacheKey,
  getOpenClawVersionsStateToken,
  invalidateOpenClawSkillCaches,
  resolveOpenClawJsonCache,
} from '$lib/server/openclaw/cache';
import { invalidateCategoryCaches } from '$lib/server/cache/categories';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/auth/permissions';
import {
  acquireOpenClawPublishLock,
  readOpenClawManifest,
  releaseOpenClawPublishLock,
  writeOpenClawManifest,
} from '$lib/server/openclaw/compat-store';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';
import { buildTouchOrganizationStatement } from '$lib/server/org/mutations';

interface SkillStatsRow {
  stars: number | null;
  downloadCount30d: number | null;
  downloadCount90d: number | null;
}

interface SkillDeleteRow {
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

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const slug = decodeClawHubCompatSlug(params.slug);
  if (!slug) {
    return json(
      { error: 'Invalid compatibility slug.' },
      {
        status: 400,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const resolved = await resolveSkillDetail({
    db,
    r2,
    request,
    locals,
    waitUntil,
    includeRecommendSkills: false,
  }, slug);

  if (!resolved.data) {
    return json(
      { error: resolved.error || 'Skill not found.' },
      {
        status: resolved.status,
        headers: buildOpenClawResponseHeaders({
          cacheControl: resolved.cacheControl,
          cacheStatus: resolved.cacheStatus,
        }),
      }
    );
  }

  const skill = resolved.data.skill;
  const compatSlug = encodeClawHubCompatSlug(skill.slug);
  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug,
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
  });

  const buildPayload = async () => {
    const statsRow = await db
      ?.prepare(`
      SELECT
        stars,
        download_count_30d as downloadCount30d,
        download_count_90d as downloadCount90d
      FROM skills
      WHERE slug = ?
      LIMIT 1
    `)
      .bind(slug)
      .first<SkillStatsRow>();

    return {
      skill: {
        slug: compatSlug,
        displayName: skill.name,
        summary: skill.description || null,
        tags: versionState.tags,
        stats: buildOpenClawStats({
          stars: statsRow?.stars ?? skill.stars,
          downloadCount30d: statsRow?.downloadCount30d,
          downloadCount90d: statsRow?.downloadCount90d,
          versions: versionState.versions.length,
        }),
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      },
      latestVersion: versionState.latestVersion,
      owner: {
        handle: skill.authorUsername || skill.repoOwner || null,
        displayName: skill.authorDisplayName || skill.repoOwner || null,
        image: skill.authorAvatar || null,
      },
      moderation: null,
    };
  };

  const cached = await resolveOpenClawJsonCache({
    cacheKey: buildOpenClawSkillDetailCacheKey({
      compatSlug,
      skillUpdatedAt: skill.updatedAt,
      versionsStateToken: getOpenClawVersionsStateToken(versionState),
    }),
    load: buildPayload,
    waitUntil,
    cacheControl: resolved.cacheControl,
    cacheStatus: resolved.cacheStatus,
  });

  return json(cached.data, {
    headers: cached.headers,
  });
};

export const DELETE: RequestHandler = async ({ params, platform, request, locals }) => {
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
  requireScope(auth, 'write');

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
    .first<SkillDeleteRow>();

  if (!skill) {
    throw error(404, 'Skill not found.');
  }
  if (skill.sourceType !== 'upload') {
    throw error(400, 'Only uploaded SkillsCat skills can be soft-deleted through the ClawHub compatibility API.');
  }

  const canWrite = await canWriteSkill(skill.id, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to delete this skill.');
  }

  const publishLock = await acquireOpenClawPublishLock(r2, params.slug);
  if (!publishLock) {
    throw error(409, 'Another publish is already in progress for this skill');
  }

  try {
    const manifest = await readOpenClawManifest(r2, params.slug);
    if (!manifest) {
      throw error(409, 'Only skills published through the ClawHub compatibility API can be soft-deleted.');
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
      deleted: true,
      deletedAt: manifest.deletedAt || now,
      updatedAt: now,
    });

    try {
      const updateStatement = db
        .prepare(`UPDATE skills SET visibility = 'private', updated_at = ? WHERE id = ?`)
        .bind(now, skill.id);
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
        console.error(`Failed to roll back OpenClaw deletion ${skill.slug}:`, rollbackError);
      }
      throw dbError;
    }

    if (categorySlugs.length > 0) {
      try {
        await syncCategoryPublicStats(db, categorySlugs, now);
      } catch (statsError) {
        console.error(`Failed to sync category stats for deleted skill ${skill.slug}:`, statsError);
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
      console.error(`Failed to invalidate caches for deleted skill ${skill.slug}:`, cacheError);
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
