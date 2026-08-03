export const DEFAULT_USER_SKILLS_PAGE = 1;
export const DEFAULT_USER_SKILLS_LIMIT = 20;
export const MAX_USER_SKILLS_LIMIT = 100;

export type UserSkillsView = 'owned' | 'submitted';

interface UserSkillRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  stars: number | null;
  updated_at: number;
}

export interface UserSkillListItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: 'public' | 'private' | 'unlisted';
  stars: number;
  updatedAt: number;
}

export interface UserSkillsPageResult {
  skills: UserSkillListItem[];
  view: UserSkillsView;
  totalSubmitted: number;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
}

export function parseUserSkillsPage(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_USER_SKILLS_PAGE), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_USER_SKILLS_PAGE;
  return parsed;
}

export function parseUserSkillsLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_USER_SKILLS_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_USER_SKILLS_LIMIT;
  return Math.min(parsed, MAX_USER_SKILLS_LIMIT);
}

export function parseUserSkillsView(raw: string | null): UserSkillsView {
  return raw === 'submitted' ? 'submitted' : 'owned';
}

function mapSkillRow(row: UserSkillRow): UserSkillListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    visibility: row.visibility as UserSkillListItem['visibility'],
    stars: row.stars ?? 0,
    updatedAt: row.updated_at,
  };
}

async function loadSubmittedCount(db: D1Database, userId: string): Promise<number> {
  const result = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM skill_submissions
    WHERE user_id = ?
  `)
    .bind(userId)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

export async function loadUserSkillsPage(
  db: D1Database,
  userId: string,
  options: {
    page: number;
    limit: number;
    view: UserSkillsView;
  }
): Promise<UserSkillsPageResult> {
  const { page, limit, view } = options;
  const offset = (page - 1) * limit;

  if (view === 'submitted') {
    const [results, totalSubmitted] = await Promise.all([
      db.prepare(`
        SELECT
          s.id,
          s.name,
          s.slug,
          s.description,
          s.visibility,
          s.stars,
          COALESCE(s.last_commit_at, s.updated_at) AS updated_at
        FROM skill_submissions ss
        INNER JOIN skills s ON s.id = ss.skill_id
        WHERE ss.user_id = ?
        ORDER BY ss.indexed_at DESC, ss.skill_id DESC
        LIMIT ? OFFSET ?
      `)
        .bind(userId, limit, offset)
        .all<UserSkillRow>(),
      loadSubmittedCount(db, userId),
    ]);

    return {
      skills: results.results.map(mapSkillRow),
      view,
      totalSubmitted,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalSubmitted / limit),
        totalItems: totalSubmitted,
        itemsPerPage: limit,
      },
    };
  }

  const queryLimit = offset === 0 ? limit + 1 : limit;
  const [results, totalSubmitted] = await Promise.all([
    db.prepare(`
      SELECT id, name, slug, description, visibility, stars,
        COALESCE(last_commit_at, updated_at) AS updated_at
      FROM skills
      WHERE owner_id = ? AND org_id IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
      .bind(userId, queryLimit, offset)
      .all<UserSkillRow>(),
    loadSubmittedCount(db, userId),
  ]);

  const hasMoreOnFirstPage = offset === 0 && results.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? results.results.slice(0, limit) : results.results;
  let totalItems = pageRows.length;

  if (offset !== 0 || hasMoreOnFirstPage) {
    const countResult = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM skills
      WHERE owner_id = ? AND org_id IS NULL
    `)
      .bind(userId)
      .first<{ count: number }>();
    totalItems = countResult?.count ?? 0;
  }

  return {
    skills: pageRows.map(mapSkillRow),
    view,
    totalSubmitted,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalItems / limit),
      totalItems,
      itemsPerPage: limit,
    },
  };
}
