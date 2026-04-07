import type { SkillDetail } from '$lib/types';
import { buildSkillSecuritySummary } from '$lib/server/skill/security-summary';
import { loadSkillReadmeFromR2 } from '$lib/server/db/business/readme';
import { parseFileTree } from '$lib/server/db/shared/skills';
import { collectTiming, timedTask } from '$lib/server/db/shared/timing';
import type { DbEnv, TimingCollector } from '$lib/server/db/shared/types';

interface SkillDetailRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  github_url: string | null;
  skill_path: string | null;
  stars: number | null;
  forks: number | null;
  trending_score: number | null;
  last_commit_at: number | null;
  updated_at: number;
  created_at: number | null;
  indexed_at: number;
  readme: string | null;
  file_structure: string | null;
  visibility: SkillDetail['visibility'] | null;
  source_type: SkillDetail['sourceType'] | null;
  tier: string | null;
  owner_id: string | null;
  org_id: string | null;
  authorAvatar: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorBio: string | null;
  authorSkillsCount: number | null;
  authorTotalStars: number | null;
  ownerName: string | null;
  ownerAvatar: string | null;
  orgName: string | null;
  orgSlug: string | null;
  orgAvatar: string | null;
  categoriesJson: string | null;
  classification_method: SkillDetail['classificationMethod'];
  currentRiskLevel: string | null;
  vtLastStats: string | null;
}

/**
 * 获取 skill 详情
 */
export async function getSkillBySlug(
  env: DbEnv,
  slug: string,
  userId?: string | null,
  timingCollector?: TimingCollector,
  skipR2Readme: boolean = false
): Promise<SkillDetail | null> {
  if (!env.DB) return null;

  const result = await timedTask(
    timingCollector,
    'sd_row',
    () => env.DB!.prepare(`
      SELECT
        s.*,
        (
          SELECT json_group_array(sc.category_slug)
          FROM skill_categories sc
          WHERE sc.skill_id = s.id
        ) as categoriesJson,
        a.username as authorUsername,
        a.display_name as authorDisplayName,
        a.avatar_url as authorAvatar,
        a.bio as authorBio,
        a.skills_count as authorSkillsCount,
        a.total_stars as authorTotalStars,
        u.name as ownerName,
        u.image as ownerAvatar,
        o.name as orgName,
        o.slug as orgSlug,
        o.avatar_url as orgAvatar,
        ss.current_risk_level as currentRiskLevel,
        ss.vt_last_stats as vtLastStats
      FROM skills s
      LEFT JOIN authors a ON s.repo_owner = a.username
      LEFT JOIN user u ON s.owner_id = u.id
      LEFT JOIN organizations o ON s.org_id = o.id
      LEFT JOIN skill_security_state ss ON ss.skill_id = s.id
      WHERE s.slug = ?
    `)
      .bind(slug)
      .first<SkillDetailRow>(),
    'skill row'
  );

  if (!result) return null;

  const skillData = result;

  // 权限检查
  if (skillData.visibility === 'private') {
    if (!userId) {
      return null; // 未登录用户无法访问私有 skill
    }

    // 检查是否是所有者
    const isOwner = skillData.owner_id === userId;

    // 检查是否是组织成员
    let isOrgMember = false;
    if (skillData.org_id) {
      const membership = await timedTask(
        timingCollector,
        'sd_perm_org',
        () => env.DB!.prepare(`
          SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?
        `)
          .bind(skillData.org_id, userId)
          .first(),
        'private org membership'
      );
      isOrgMember = !!membership;
    }

    // 检查是否有显式权限
    let hasPermission = false;
    if (!isOwner && !isOrgMember) {
      const permission = await timedTask(
        timingCollector,
        'sd_perm_user',
        () => env.DB!.prepare(`
          SELECT 1 FROM skill_permissions
          WHERE skill_id = ? AND grantee_type = 'user' AND grantee_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
        `)
          .bind(skillData.id, userId, Date.now())
          .first(),
        'private explicit permission'
      );
      hasPermission = !!permission;
    }

    if (!isOwner && !isOrgMember && !hasPermission) {
      return null; // 无权限访问
    }
  }

  const readmePromise = (async (): Promise<string | null> => {
    let readme = skillData.readme;
    if (!env.R2 || readme || skipR2Readme) return readme;

    const r2Start = performance.now();
    try {
      readme = await loadSkillReadmeFromR2(env, {
        slug: skillData.slug,
        name: skillData.name,
        repoOwner: skillData.repo_owner,
        repoName: skillData.repo_name,
        skillPath: skillData.skill_path || '',
        sourceType: skillData.source_type || 'github',
      });
    } catch (error) {
      console.error('Error reading SKILL.md from R2:', error);
    } finally {
      collectTiming(timingCollector, 'sd_readme_r2', r2Start, 'readme R2');
    }

    return readme;
  })();

  const readme = await readmePromise;

  let categories: string[] = [];
  if (skillData.categoriesJson) {
    try {
      const parsed = JSON.parse(skillData.categoriesJson) as unknown;
      if (Array.isArray(parsed)) {
        categories = parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch {
      categories = [];
    }
  }

  // 解析文件结构 (直接使用预构建的 fileTree)
  const fileTreeParseStart = performance.now();
  const fileStructure = parseFileTree(skillData.file_structure);
  collectTiming(timingCollector, 'sd_filetree', fileTreeParseStart, 'file tree parse');
  const security = buildSkillSecuritySummary({
    aiRiskLevel: skillData.currentRiskLevel,
    vtLastStats: skillData.vtLastStats,
  });

  return {
    id: skillData.id,
    name: skillData.name,
    slug: skillData.slug,
    description: skillData.description,
    repoOwner: skillData.repo_owner,
    repoName: skillData.repo_name,
    githubUrl: skillData.github_url || (skillData.repo_owner ? `https://github.com/${skillData.repo_owner}/${skillData.repo_name}` : null),
    skillPath: skillData.skill_path || '',
    stars: skillData.stars || 0,
    forks: skillData.forks || 0,
    trendingScore: skillData.trending_score || 0,
    updatedAt: skillData.last_commit_at ?? skillData.updated_at,
    lastCommitAt: skillData.last_commit_at || null,
    createdAt: skillData.created_at || skillData.indexed_at,
    indexedAt: skillData.indexed_at,
    readme,
    fileStructure,
    categories,
    classificationMethod: skillData.classification_method ?? null,
    security,
    authorAvatar: skillData.authorAvatar,
    authorUsername: skillData.authorUsername,
    authorDisplayName: skillData.authorDisplayName,
    authorBio: skillData.authorBio,
    authorSkillsCount: skillData.authorSkillsCount,
    authorTotalStars: skillData.authorTotalStars,
    // 新增字段
    visibility: skillData.visibility || 'public',
    sourceType: skillData.source_type || 'github',
    tier: skillData.tier,
    ownerId: skillData.owner_id,
    ownerName: skillData.ownerName,
    ownerAvatar: skillData.ownerAvatar,
    orgId: skillData.org_id,
    orgName: skillData.orgName,
    orgSlug: skillData.orgSlug,
    orgAvatar: skillData.orgAvatar,
  };
}
