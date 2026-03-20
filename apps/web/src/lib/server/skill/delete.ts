import {
  buildGithubSkillR2Key,
  buildGithubSkillR2Prefix,
  buildGithubSkillR2Keys,
  buildUploadSkillR2Prefix,
} from '$lib/skill-path';
import { invalidateCache } from '$lib/server/cache';
import { PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS } from '$lib/server/cache/keys';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';

export interface DeleteSkillArtifactsInput {
  db: D1Database;
  r2: R2Bucket | undefined;
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
  const { db, r2, skill } = input;
  const fileStructure = await db
    .prepare('SELECT file_structure FROM skills WHERE id = ?')
    .bind(skill.id)
    .first<{ file_structure: string | null }>();
  const categoryResult = await db
    .prepare('SELECT category_slug FROM skill_categories WHERE skill_id = ?')
    .bind(skill.id)
    .all<{ category_slug: string }>();
  const categorySlugs = (categoryResult.results || []).map((row) => row.category_slug);

  await db.prepare('DELETE FROM skills WHERE id = ?').bind(skill.id).run();

  try {
    await deleteR2Artifacts(r2, buildSkillR2DeletePlan(skill, fileStructure?.file_structure || null));
  } catch (error) {
    console.error(`Failed to delete R2 artifacts for skill ${skill.id}:`, error);
  }

  try {
    const cacheKeys = new Set<string>([
      `api:skill:${skill.slug}`,
      `api:skill-files:${skill.slug}`,
      `skill:${skill.id}`,
      `recommend:${skill.id}`,
      ...PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
    ]);

    for (const categorySlug of categorySlugs) {
      cacheKeys.add(`page:category:v1:${categorySlug}:1`);
    }

    await Promise.all(Array.from(cacheKeys, (cacheKey) => invalidateCache(cacheKey)));
    await invalidateOpenClawSkillCaches(skill.id, skill.slug);
  } catch (error) {
    console.error(`Failed to invalidate caches for deleted skill ${skill.id}:`, error);
  }
}
