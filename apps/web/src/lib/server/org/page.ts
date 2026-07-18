import { getCached, invalidateCache } from '$lib/server/cache';
import { getOrgPageSnapshotCacheKey } from '$lib/server/cache/keys';

const PUBLIC_ORG_PAGE_CACHE_TTL_SECONDS = 30 * 60;
const ORG_PAGE_SKILLS_LIMIT = 20;

type WaitUntilFn = (promise: Promise<unknown>) => void;

export interface OrgPageOrg {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  verified: boolean;
  createdAt?: number;
  updatedAt?: number;
  memberCount: number;
  skillCount: number;
  userRole: string | null;
}

export interface OrgPageMember {
  userId: string;
  name: string | null;
  image: string | null;
  role: string;
  githubUsername?: string | null;
}

export interface OrgPageSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'public' | 'private' | 'unlisted';
  stars: number;
  updatedAt?: number;
}

export type OrgPageErrorKind = 'not_found' | 'temporary_failure';

export interface OrgPagePayload {
  slug: string;
  org: OrgPageOrg | null;
  members: OrgPageMember[];
  skills: OrgPageSkill[];
  error: string | null;
  errorKind: OrgPageErrorKind | null;
}

export interface ResolvedOrgPagePayload {
  data: OrgPagePayload;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  status: number;
}

interface OrgBaseRow {
  id: string;
  name: string;
  slug: string;
  display_name: string | null;
  description: string | null;
  avatar_url: string | null;
  verified_at: number | null;
  created_at: number;
  updated_at: number;
  member_count: number | null;
  public_skill_count: number | null;
}

interface MemberRow {
  user_id: string;
  role: string;
  name: string | null;
  image: string | null;
  github_username: string | null;
}

interface SkillRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'public' | 'private' | 'unlisted';
  stars: number | null;
  updated_at: number | null;
}

function buildNotFoundPayload(slug: string): OrgPagePayload {
  return {
    slug,
    org: null,
    members: [],
    skills: [],
    error: 'Organization not found',
    errorKind: 'not_found',
  };
}

function buildTemporaryFailurePayload(slug: string): OrgPagePayload {
  return {
    slug,
    org: null,
    members: [],
    skills: [],
    error: 'Failed to load organization',
    errorKind: 'temporary_failure',
  };
}

async function fetchOrgBase(db: D1Database, slug: string): Promise<OrgBaseRow | null> {
  return db.prepare(`
    SELECT
      o.id,
      o.name,
      o.slug,
      o.display_name,
      o.description,
      o.avatar_url,
      o.verified_at,
      o.created_at,
      o.updated_at,
      (
        SELECT COUNT(*)
        FROM org_members om
        WHERE om.org_id = o.id
      ) as member_count,
      (
        SELECT COUNT(*)
        FROM skills s
        WHERE s.org_id = o.id
          AND s.visibility = 'public'
      ) as public_skill_count
    FROM organizations o
    WHERE o.slug = ?
    LIMIT 1
  `)
    .bind(slug)
    .first<OrgBaseRow>();
}

function mapMembers(rows: MemberRow[]): OrgPageMember[] {
  return rows.map((member) => ({
    userId: member.user_id,
    role: member.role,
    name: member.name,
    githubUsername: member.github_username,
    image: member.image,
  }));
}

function mapSkills(rows: SkillRow[]): OrgPageSkill[] {
  return rows.map((skill) => ({
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    visibility: skill.visibility,
    stars: Number(skill.stars || 0),
    updatedAt: skill.updated_at ?? undefined,
  }));
}

async function fetchPublicOrgSnapshot(db: D1Database, slug: string): Promise<OrgPagePayload | null> {
  const orgRow = await fetchOrgBase(db, slug);
  if (!orgRow) {
    return null;
  }

  const [membersResult, skillsResult] = await Promise.all([
    db.prepare(`
      SELECT
        om.user_id,
        om.role,
        u.name,
        u.image,
        a.username as github_username
      FROM org_members om
      LEFT JOIN user u ON om.user_id = u.id
      LEFT JOIN authors a ON a.user_id = u.id
      WHERE om.org_id = ?
      ORDER BY om.joined_at
    `)
      .bind(orgRow.id)
      .all<MemberRow>(),
    db.prepare(`
      SELECT
        id,
        name,
        slug,
        description,
        visibility,
        stars,
        CASE WHEN last_commit_at IS NULL THEN updated_at ELSE last_commit_at END as updated_at
      FROM skills INDEXED BY skills_org_visibility_stars_created_idx
      WHERE org_id = ?
        AND visibility = 'public'
      ORDER BY stars DESC, created_at DESC
      LIMIT ?
    `)
      .bind(orgRow.id, ORG_PAGE_SKILLS_LIMIT)
      .all<SkillRow>(),
  ]);

  return {
    slug,
    org: {
      id: orgRow.id,
      name: orgRow.name,
      slug: orgRow.slug,
      displayName: orgRow.display_name,
      description: orgRow.description,
      avatarUrl: orgRow.avatar_url,
      verified: orgRow.verified_at !== null,
      createdAt: orgRow.created_at,
      updatedAt: orgRow.updated_at,
      memberCount: Number(orgRow.member_count || 0),
      skillCount: Number(orgRow.public_skill_count || 0),
      userRole: null,
    },
    members: mapMembers(membersResult.results || []),
    skills: mapSkills(skillsResult.results || []),
    error: null,
    errorKind: null,
  };
}

async function isCachedPublicOrgSnapshotCurrent(
  db: D1Database,
  payload: OrgPagePayload
): Promise<boolean> {
  if (!payload.org) return false;

  const skillIds = payload.skills.map((skill) => skill.id);
  if (skillIds.length === 0) {
    const org = await db.prepare(`
      SELECT id, updated_at as updatedAt
      FROM organizations
      WHERE slug = ?
      LIMIT 1
    `)
      .bind(payload.slug)
      .first<{ id: string; updatedAt: number }>();

    return Boolean(
      org
      && org.id === payload.org.id
      && Number(org.updatedAt) === Number(payload.org.updatedAt)
    );
  }

  const placeholders = skillIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT
      o.id as orgId,
      o.updated_at as orgUpdatedAt,
      s.id as skillId
    FROM organizations o
    LEFT JOIN skills s INDEXED BY skills_visibility_id_idx
      ON s.visibility = 'public'
      AND s.id IN (${placeholders})
      AND s.org_id = o.id
    WHERE o.slug = ?
    LIMIT ?
  `)
    .bind(...skillIds, payload.slug, skillIds.length + 1)
    .all<{ orgId: string; orgUpdatedAt: number; skillId: string | null }>();

  const rows = result.results || [];
  const orgRow = rows[0];
  if (
    !orgRow
    || orgRow.orgId !== payload.org.id
    || Number(orgRow.orgUpdatedAt) !== Number(payload.org.updatedAt)
  ) {
    return false;
  }

  const currentPublicSkillIds = new Set(
    rows.map((row) => row.skillId).filter((id): id is string => Boolean(id))
  );
  return currentPublicSkillIds.size === new Set(skillIds).size;
}

async function applyMemberOverlay(
  db: D1Database,
  payload: OrgPagePayload,
  userId: string
): Promise<OrgPagePayload> {
  if (!payload.org) {
    return payload;
  }

  const membership = await db.prepare(`
    SELECT role
    FROM org_members
    WHERE org_id = ?
      AND user_id = ?
    LIMIT 1
  `)
    .bind(payload.org.id, userId)
    .first<{ role: string }>();

  if (!membership?.role) {
    return payload;
  }

  const [skillCountResult, skillsResult] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as count
      FROM skills INDEXED BY skills_org_stars_created_idx
      WHERE org_id = ?
    `)
      .bind(payload.org.id)
      .first<{ count: number }>(),
    db.prepare(`
      SELECT
        id,
        name,
        slug,
        description,
        visibility,
        stars,
        CASE WHEN last_commit_at IS NULL THEN updated_at ELSE last_commit_at END as updated_at
      FROM skills INDEXED BY skills_org_stars_created_idx
      WHERE org_id = ?
      ORDER BY stars DESC, created_at DESC
      LIMIT ?
    `)
      .bind(payload.org.id, ORG_PAGE_SKILLS_LIMIT)
      .all<SkillRow>(),
  ]);

  return {
    ...payload,
    org: {
      ...payload.org,
      userRole: membership.role,
      skillCount: Number(skillCountResult?.count || 0),
    },
    skills: mapSkills(skillsResult.results || []),
  };
}

export async function resolveOrgPagePayload(
  {
    db,
    locals,
    waitUntil,
  }: {
    db: D1Database | undefined;
    locals: App.Locals;
    waitUntil?: WaitUntilFn;
  },
  slug: string
): Promise<ResolvedOrgPagePayload> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!db) {
    return {
      data: buildTemporaryFailurePayload(normalizedSlug),
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      status: 503,
    };
  }

  try {
    const cacheKey = getOrgPageSnapshotCacheKey(normalizedSlug);
    const cached = await getCached(
      cacheKey,
      () => fetchPublicOrgSnapshot(db, normalizedSlug),
      PUBLIC_ORG_PAGE_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    let publicPayload = cached.data;
    let cacheHit = cached.hit;

    // Cache API entries are data-center local. Recheck misses for newly created
    // organizations and validate positive snapshots before exposing cached
    // public skill metadata.
    if (!publicPayload && cached.hit) {
      const exists = await db.prepare(`
        SELECT 1
        FROM organizations
        WHERE slug = ?
        LIMIT 1
      `)
        .bind(normalizedSlug)
        .first();

      if (exists) {
        publicPayload = await fetchPublicOrgSnapshot(db, normalizedSlug);
        cacheHit = false;
        await invalidateCache(cacheKey);
      }
    } else if (
      publicPayload
      && cached.hit
      && !await isCachedPublicOrgSnapshotCurrent(db, publicPayload)
    ) {
      publicPayload = await fetchPublicOrgSnapshot(db, normalizedSlug);
      cacheHit = false;
      await invalidateCache(cacheKey);
    }

    if (!publicPayload) {
      return {
        data: buildNotFoundPayload(normalizedSlug),
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
        status: 404,
      };
    }

    const session = await locals.auth?.();
    if (!session?.user?.id) {
      return {
        data: publicPayload,
        cacheControl: 'private, no-cache',
        cacheStatus: cacheHit ? 'HIT' : 'MISS',
        status: 200,
      };
    }

    try {
      const overlayPayload = await applyMemberOverlay(db, publicPayload, session.user.id);
      return {
        data: overlayPayload,
        cacheControl: 'private, no-cache',
        cacheStatus: overlayPayload.org?.userRole ? 'BYPASS' : (cacheHit ? 'HIT' : 'MISS'),
        status: 200,
      };
    } catch (error) {
      console.error(`Failed to apply org member overlay for ${normalizedSlug}:`, error);
      return {
        data: publicPayload,
        cacheControl: 'private, no-cache',
        cacheStatus: cacheHit ? 'HIT' : 'MISS',
        status: 200,
      };
    }
  } catch (error) {
    console.error(`Failed to resolve org page payload for ${normalizedSlug}:`, error);
    return {
      data: buildTemporaryFailurePayload(normalizedSlug),
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      status: 500,
    };
  }
}
