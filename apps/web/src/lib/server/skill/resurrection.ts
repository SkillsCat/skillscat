import { buildGithubSkillR2Key, buildUploadSkillR2Key } from '$lib/skill-path';
import { invalidateCategoryCaches } from '$lib/server/cache/categories';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';
import { findSkillArchiveObjectKey } from '$lib/server/skill/archive';

interface ArchiveData {
  categories?: string[];
  skillMdContent?: string | null;
}

interface SkillStorageLocation {
  slug: string;
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
}

function getSkillReadmeKey(skillLocation: SkillStorageLocation | null): string {
  if (!skillLocation) return '';

  if (skillLocation.source_type === 'upload') {
    return buildUploadSkillR2Key(skillLocation.slug, 'SKILL.md');
  }

  if (skillLocation.repo_owner && skillLocation.repo_name) {
    return buildGithubSkillR2Key(
      skillLocation.repo_owner,
      skillLocation.repo_name,
      skillLocation.skill_path,
      'SKILL.md'
    );
  }

  return '';
}

export async function restoreArchivedSkillFromR2(params: {
  db: D1Database;
  r2: R2Bucket;
  skillId: string;
  now?: number;
  nextTier?: string;
  stars?: number | null;
}): Promise<boolean> {
  const {
    db,
    r2,
    skillId,
    now = Date.now(),
    nextTier = 'cold',
    stars = null,
  } = params;

  const archivePath = await findSkillArchiveObjectKey(r2, skillId);
  if (!archivePath) {
    return false;
  }

  const archiveObj = await r2.get(archivePath);
  if (!archiveObj) {
    return false;
  }

  const archiveData = await archiveObj.json() as ArchiveData;
  const categorySlugs = Array.from(
    new Set(
      (archiveData.categories || [])
        .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    )
  );
  const skillLocation = await db.prepare(`
    SELECT slug, source_type, repo_owner, repo_name, skill_path
    FROM skills
    WHERE id = ?
    LIMIT 1
  `)
    .bind(skillId)
    .first<SkillStorageLocation>();

  if (archiveData.skillMdContent) {
    const skillMdPath = getSkillReadmeKey(skillLocation);
    if (skillMdPath) {
      await r2.put(skillMdPath, archiveData.skillMdContent, {
        httpMetadata: { contentType: 'text/markdown' },
      });
    }
  }

  await db.prepare(`
    UPDATE skills
    SET tier = ?,
        stars = COALESCE(?, stars),
        last_accessed_at = ?,
        updated_at = ?
    WHERE id = ?
  `)
    .bind(nextTier, stars, now, now, skillId)
    .run();

  for (const categorySlug of categorySlugs) {
    await db.prepare(`
      INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
      VALUES (?, ?)
    `)
      .bind(skillId, categorySlug)
      .run();
  }

  if (categorySlugs.length > 0) {
    await syncCategoryPublicStats(db, categorySlugs, now);
    await invalidateCategoryCaches(categorySlugs);
  }

  await r2.delete(archivePath);
  return true;
}
