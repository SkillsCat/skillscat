import {
  buildGithubSkillR2Key,
  buildGithubSkillR2Prefix,
  buildGithubSkillR2Keys,
  buildUploadSkillR2Prefix,
} from '$lib/skill-path';
import { invalidateCache } from '$lib/server/cache';
import {
  getOrgPageSnapshotCacheKey,
  getSkillPageCacheInvalidationKeys,
  getSkillSourceCacheKey,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '$lib/server/cache/keys';
import { getCategoryPageCacheInvalidationKeys } from '$lib/server/cache/categories';
import { getSkillDetailCacheKeys } from '$lib/server/skill/detail';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';
import {
  buildIndexNowSkillUrls,
  resolveIndexNowOwnerHandle,
  scheduleIndexNowSubmission,
} from '$lib/server/seo/indexnow';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';

export interface DeleteSkillArtifactsInput {
  db: D1Database;
  r2: R2Bucket | undefined;
  indexNow?: {
    env:
      | {
          PUBLIC_APP_URL?: string;
          INDEXNOW_ENABLED?: string;
          INDEXNOW_KEY?: string;
          INDEXNOW_KEY_LOCATION?: string;
          INDEXNOW_API_URL?: string;
          INDEXNOW_DEDUPE_TTL_SECONDS?: string;
          KV?: KVNamespace;
        }
      | undefined;
    waitUntil?: (promise: Promise<unknown>) => void;
  };
  skill: {
    id: string;
    slug: string;
    sourceType: string;
    repoOwner: string | null;
    repoName: string | null;
    skillPath: string | null;
  };
}

function buildSkillR2Prefix(skill: DeleteSkillArtifactsInput['skill']): string {
  if (skill.sourceType === 'upload') {
    return buildUploadSkillR2Prefix(skill.slug);
  }

  if (!skill.repoOwner || !skill.repoName) {
    return '';
  }

  return buildGithubSkillR2Prefix(skill.repoOwner, skill.repoName, skill.skillPath);
}

function parseCachedFilePaths(fileStructureRaw: string | null): string[] {
  if (!fileStructureRaw) {
    return ['SKILL.md'];
  }

  try {
    const parsed = JSON.parse(fileStructureRaw) as {
      files?: Array<{ path?: string | null }>;
    };
    const filePaths = new Set<string>();

    for (const file of parsed.files || []) {
      const normalizedPath = String(file.path || '').trim().replace(/^\/+/, '');
      if (normalizedPath) {
        filePaths.add(normalizedPath);
      }
    }

    if (filePaths.size === 0) {
      filePaths.add('SKILL.md');
    }

    return [...filePaths];
  } catch {
    return ['SKILL.md'];
  }
}

function buildSkillR2DeletePlan(
  skill: DeleteSkillArtifactsInput['skill'],
  fileStructureRaw: string | null
): { prefixes: string[]; keys: string[] } {
  if (skill.sourceType === 'upload') {
    const prefix = buildUploadSkillR2Prefix(skill.slug);
    return {
      prefixes: prefix ? [prefix] : [],
      keys: [],
    };
  }

  if (!skill.repoOwner || !skill.repoName) {
    return { prefixes: [], keys: [] };
  }

  const prefixes = [buildGithubSkillR2Prefix(skill.repoOwner, skill.repoName, skill.skillPath)].filter(Boolean);
  const keys = new Set<string>();

  for (const filePath of parseCachedFilePaths(fileStructureRaw)) {
    for (const candidateKey of buildGithubSkillR2Keys(
      skill.repoOwner,
      skill.repoName,
      skill.skillPath,
      filePath
    )) {
      if (candidateKey !== buildGithubSkillR2Key(skill.repoOwner, skill.repoName, skill.skillPath, filePath)) {
        keys.add(candidateKey);
      }
    }
  }

  return {
    prefixes,
    keys: [...keys],
  };
}

async function listAllObjects(r2: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const listed = await r2.list({ prefix, cursor });
    objects.push(...listed.objects);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return objects;
}

async function deleteR2Artifacts(
  r2: R2Bucket | undefined,
  plan: { prefixes: string[]; keys: string[] }
): Promise<void> {
  if (!r2) return;

  const keysToDelete = new Set<string>(plan.keys);

  for (const prefix of plan.prefixes) {
    if (!prefix) continue;
    const objects = await listAllObjects(r2, prefix);
    for (const object of objects) {
      keysToDelete.add(object.key);
    }
  }

  await Promise.all([...keysToDelete].map((key) => r2.delete(key)));
}

export async function deleteSkillArtifactsAndInvalidateCaches(
  input: DeleteSkillArtifactsInput
): Promise<void> {
  const { db, r2, skill, indexNow } = input;
  let skillRow:
    | {
        file_structure: string | null;
        visibility: string | null;
        repo_owner: string | null;
        org_slug: string | null;
        owner_username: string | null;
      }
    | null = null;
  try {
    skillRow = await db.prepare(`
      SELECT
        s.file_structure AS file_structure,
        s.visibility AS visibility,
        s.repo_owner AS repo_owner,
        o.slug AS org_slug,
        a.username AS owner_username
      FROM skills s
      LEFT JOIN organizations o ON o.id = s.org_id
      LEFT JOIN authors a ON a.user_id = s.owner_id
      WHERE s.id = ?
      LIMIT 1
    `)
      .bind(skill.id)
      .first<{
        file_structure: string | null;
        visibility: string | null;
        repo_owner: string | null;
        org_slug: string | null;
        owner_username: string | null;
      }>();
  } catch (error) {
    console.error(`Failed to load IndexNow metadata for deleted skill ${skill.id}:`, error);
  }
  const categoryResult = await db
    .prepare('SELECT category_slug FROM skill_categories WHERE skill_id = ?')
    .bind(skill.id)
    .all<{ category_slug: string }>();
  const categorySlugs = (categoryResult.results || []).map((row) => row.category_slug);
  const indexNowUrls = skillRow?.visibility === 'public'
    ? buildIndexNowSkillUrls({
        slug: skill.slug,
        visibility: skillRow.visibility,
        orgSlug: skillRow.org_slug,
        ownerHandle: skillRow.org_slug ? null : resolveIndexNowOwnerHandle(skillRow.repo_owner, skillRow.owner_username),
      }, indexNow?.env)
    : [];

  await db.prepare('DELETE FROM skills WHERE id = ?').bind(skill.id).run();

  if (categorySlugs.length > 0) {
    try {
      await syncCategoryPublicStats(db, categorySlugs);
    } catch (error) {
      console.error(`Failed to sync category public stats for deleted skill ${skill.id}:`, error);
    }
  }

  try {
    await deleteR2Artifacts(r2, buildSkillR2DeletePlan(skill, skillRow?.file_structure || null));
  } catch (error) {
    console.error(`Failed to delete R2 artifacts for skill ${skill.id}:`, error);
  }

  try {
    const cacheKeys = new Set<string>([
      ...getSkillDetailCacheKeys(skill.slug),
      `api:skill-files:${skill.slug}`,
      `skill:${skill.id}`,
      `recommend:${skill.id}`,
      getSkillSourceCacheKey(skill.slug),
      ...getSkillPageCacheInvalidationKeys(skill.slug),
      ...PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
    ]);

    if (skillRow?.org_slug) {
      cacheKeys.add(getOrgPageSnapshotCacheKey(skillRow.org_slug));
    }

    for (const categorySlug of categorySlugs) {
      for (const cacheKey of getCategoryPageCacheInvalidationKeys(categorySlug)) {
        cacheKeys.add(cacheKey);
      }
    }

    await Promise.all(Array.from(cacheKeys, (cacheKey) => invalidateCache(cacheKey)));
    await invalidateOpenClawSkillCaches(skill.id, skill.slug);
  } catch (error) {
    console.error(`Failed to invalidate caches for deleted skill ${skill.id}:`, error);
  }

  if (indexNowUrls.length > 0) {
    try {
      const indexNowTask = scheduleIndexNowSubmission({
        env: indexNow?.env,
        waitUntil: indexNow?.waitUntil,
        urls: indexNowUrls,
        action: 'delete',
        source: `delete-skill:${skill.slug}`,
      });

      if (indexNowTask) {
        await indexNowTask;
      }
    } catch (error) {
      console.error(`Failed to enqueue IndexNow deletion for skill ${skill.slug}:`, error);
    }
  }
}
