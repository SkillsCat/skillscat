import type { SkillDetail } from '$lib/types';
import { buildGithubSkillR2Keys, buildUploadSkillR2Key, parseSkillSlug } from '$lib/skill-path';
import type { DbEnv } from '$lib/server/db/shared/types';

export type SkillReadmeLookupInput = Pick<
  SkillDetail,
  'slug' | 'name' | 'repoOwner' | 'repoName' | 'skillPath' | 'sourceType'
>;

export async function loadSkillReadmeFromR2(
  env: Pick<DbEnv, 'R2'>,
  skill: SkillReadmeLookupInput
): Promise<string | null> {
  if (!env.R2) return null;

  let readme: string | null = null;

  if (skill.sourceType === 'upload') {
    const slugParts = parseSkillSlug(skill.slug);
    const candidatePaths = new Set<string>();
    const canonicalPath = buildUploadSkillR2Key(skill.slug, 'SKILL.md');
    if (canonicalPath) {
      candidatePaths.add(canonicalPath);
    }
    // Backward compatibility for older upload paths.
    if (slugParts) {
      candidatePaths.add(`skills/${slugParts.owner}/${slugParts.name.split('/')[0] || skill.name}/SKILL.md`);
      candidatePaths.add(`skills/${slugParts.owner}/${skill.name}/SKILL.md`);
    }

    for (const path of candidatePaths) {
      const object = await env.R2.get(path);
      if (object) {
        readme = await object.text();
        break;
      }
    }
  } else {
    const candidatePaths = new Set<string>(
      buildGithubSkillR2Keys(skill.repoOwner, skill.repoName, skill.skillPath, 'SKILL.md')
    );

    for (const path of candidatePaths) {
      const object = await env.R2.get(path);
      if (object) {
        readme = await object.text();
        break;
      }
    }
  }

  return readme;
}
