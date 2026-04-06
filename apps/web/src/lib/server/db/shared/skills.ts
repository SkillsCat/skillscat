import type { FileNode, SkillCardData } from '$lib/types';
import type { CachedSkillCardRaw, CategoryRow, SkillListRow } from '$lib/server/db/shared/types';

export function parseFileTree(fileStructureRaw: string | null): FileNode[] {
  if (!fileStructureRaw) return [];

  try {
    const parsed = JSON.parse(fileStructureRaw) as { fileTree?: unknown };
    if (!Array.isArray(parsed.fileTree)) return [];
    return parsed.fileTree as FileNode[];
  } catch {
    return [];
  }
}

export function normalizeCachedSkill(item: CachedSkillCardRaw): SkillCardData {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description ?? null,
    repoOwner: item.repoOwner ?? item.repo_owner ?? '',
    repoName: item.repoName ?? item.repo_name ?? '',
    stars: Number(item.stars ?? 0),
    forks: Number(item.forks ?? 0),
    trendingScore: Number(item.trendingScore ?? item.trending_score ?? 0),
    updatedAt: Number(item.updatedAt ?? item.updated_at ?? 0),
    authorAvatar: (item.authorAvatar ?? item.author_avatar) || undefined,
    categories: Array.isArray(item.categories) ? item.categories : [],
  };
}

export async function hydrateCachedSkills(
  db: D1Database,
  skills: SkillCardData[]
): Promise<SkillCardData[]> {
  if (skills.length === 0) return [];

  const skillIds = skills.map((s) => s.id);
  const placeholders = skillIds.map(() => '?').join(',');

  const result = await db.prepare(`
    SELECT
      s.id,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      a.avatar_url as authorAvatar
    FROM skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<{
      id: string;
      repoOwner: string;
      repoName: string;
      updatedAt: number;
      authorAvatar: string | null;
    }>();

  const skillMap = new Map<string, {
    repoOwner: string;
    repoName: string;
    updatedAt: number;
    authorAvatar?: string;
  }>();

  for (const row of result.results || []) {
    skillMap.set(row.id, {
      repoOwner: row.repoOwner,
      repoName: row.repoName,
      updatedAt: row.updatedAt,
      authorAvatar: row.authorAvatar || undefined,
    });
  }

  return skills.map((skill) => {
    const latest = skillMap.get(skill.id);
    if (!latest) return skill;

    return {
      ...skill,
      repoOwner: latest.repoOwner || skill.repoOwner,
      repoName: latest.repoName || skill.repoName,
      updatedAt: latest.updatedAt ?? skill.updatedAt,
      authorAvatar: latest.authorAvatar ?? skill.authorAvatar,
    };
  });
}

export async function addAuthorAvatarsToSkills(
  db: D1Database,
  skills: SkillCardData[]
): Promise<SkillCardData[]> {
  if (skills.length === 0) return [];

  const repoOwners = Array.from(new Set(
    skills
      .map((skill) => skill.repoOwner)
      .filter((owner): owner is string => typeof owner === 'string' && owner.length > 0)
  ));

  if (repoOwners.length === 0) return skills;

  const placeholders = repoOwners.map(() => '?').join(',');
  const authors = await db.prepare(`
    SELECT username, avatar_url as authorAvatar
    FROM authors
    WHERE username IN (${placeholders})
  `)
    .bind(...repoOwners)
    .all<{ username: string; authorAvatar: string | null }>();

  const avatarMap = new Map<string, string>();
  for (const row of authors.results || []) {
    if (row.authorAvatar) {
      avatarMap.set(row.username, row.authorAvatar);
    }
  }

  return skills.map((skill) => {
    const authorAvatar = avatarMap.get(skill.repoOwner) ?? skill.authorAvatar ?? undefined;
    if (authorAvatar === skill.authorAvatar) {
      return skill;
    }

    return {
      ...skill,
      authorAvatar,
    };
  });
}

export async function addCategoriesToSkills(
  db: D1Database,
  skills: SkillListRow[]
): Promise<SkillCardData[]> {
  if (skills.length === 0) return [];

  const skillIds = skills.map((s) => s.id);
  const placeholders = skillIds.map(() => '?').join(',');

  const categories = await db.prepare(`
    SELECT skill_id, category_slug FROM skill_categories
    WHERE skill_id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<CategoryRow>();

  const categoriesMap: Record<string, string[]> = {};
  for (const cat of categories.results) {
    if (!categoriesMap[cat.skill_id]) {
      categoriesMap[cat.skill_id] = [];
    }
    categoriesMap[cat.skill_id].push(cat.category_slug);
  }

  return skills.map((skill) => ({
    ...skill,
    categories: categoriesMap[skill.id] || [],
  }));
}
