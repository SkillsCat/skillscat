import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { invalidateCache } from '$lib/server/cache';
import { getOrgPageSnapshotCacheKey } from '$lib/server/cache/keys';

interface OrganizationUpdate {
  hasDisplayName: boolean;
  displayName: string | null;
  hasDescription: boolean;
  description: string | null;
  hasAvatarUrl: boolean;
  avatarUrl: string | null;
}

async function readOrganizationUpdate(request: Request): Promise<OrganizationUpdate> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw error(400, 'Organization update must be a JSON object');
  }

  const body = rawBody as Record<string, unknown>;
  const hasDisplayName = Object.hasOwn(body, 'displayName');
  const hasDescription = Object.hasOwn(body, 'description');
  const hasAvatarUrl = Object.hasOwn(body, 'avatarUrl');

  let displayName: string | null = null;
  if (hasDisplayName) {
    if (typeof body.displayName !== 'string' || !body.displayName.trim()) {
      throw error(400, 'displayName must be a non-empty string');
    }
    displayName = body.displayName.trim();
    if (displayName.length > 100) {
      throw error(400, 'displayName must be 100 characters or less');
    }
  }

  let description: string | null = null;
  if (hasDescription) {
    if (body.description !== null && typeof body.description !== 'string') {
      throw error(400, 'description must be a string or null');
    }
    description = typeof body.description === 'string' ? body.description.trim() || null : null;
    if (description && description.length > 500) {
      throw error(400, 'description must be 500 characters or less');
    }
  }

  let avatarUrl: string | null = null;
  if (hasAvatarUrl) {
    if (body.avatarUrl !== null && typeof body.avatarUrl !== 'string') {
      throw error(400, 'avatarUrl must be an HTTPS URL or null');
    }
    avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() || null : null;
    if (avatarUrl) {
      let parsed: URL;
      try {
        parsed = new URL(avatarUrl);
      } catch {
        throw error(400, 'avatarUrl must be an HTTPS URL or null');
      }
      if (parsed.protocol !== 'https:' || avatarUrl.length > 2048) {
        throw error(400, 'avatarUrl must be an HTTPS URL or null');
      }
    }
  }

  if (!hasDisplayName && !hasDescription && !hasAvatarUrl) {
    throw error(400, 'At least one organization field is required');
  }

  return {
    hasDisplayName,
    displayName,
    hasDescription,
    description,
    hasAvatarUrl,
    avatarUrl,
  };
}

/**
 * GET /api/orgs/[slug] - Get organization details
 */
export const GET: RequestHandler = async ({ locals, platform, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  const org = await db.prepare(`
    SELECT id, name, slug, display_name, description, avatar_url, github_org_id, verified_at, owner_id, created_at, updated_at
    FROM organizations
    WHERE slug = ? COLLATE NOCASE
  `)
    .bind(slug)
    .first<{
      id: string;
      name: string;
      slug: string;
      display_name: string | null;
      description: string | null;
      avatar_url: string | null;
      github_org_id: number | null;
      verified_at: number | null;
      owner_id: string;
      created_at: number;
      updated_at: number;
    }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  // Get member count
  const memberCount = await db.prepare(`
    SELECT COUNT(*) as count FROM org_members WHERE org_id = ?
  `)
    .bind(org.id)
    .first<{ count: number }>();

  // Check if current user is a member
  const session = await locals.auth?.();
  let userRole: string | null = null;

  if (session?.user) {
    const membership = await db.prepare(`
      SELECT role FROM org_members WHERE org_id = ? AND user_id = ?
    `)
      .bind(org.id, session.user.id)
      .first<{ role: string }>();

    userRole = membership?.role || null;
  }

  // Non-members should only see public skill counts
  const skillCountQuery = userRole
    ? `SELECT COUNT(*) as count FROM skills INDEXED BY skills_org_stars_created_idx WHERE org_id = ?`
    : `SELECT COUNT(*) as count FROM skills INDEXED BY skills_org_visibility_stars_created_idx WHERE org_id = ? AND visibility = 'public'`;
  const skillCount = await db.prepare(skillCountQuery)
    .bind(org.id)
    .first<{ count: number }>();

  return json({
    success: true,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: org.display_name,
      description: org.description,
      avatarUrl: org.avatar_url,
      githubConnected: org.github_org_id !== null,
      verified: org.verified_at !== null,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
      memberCount: memberCount?.count || 0,
      skillCount: skillCount?.count || 0,
      userRole: userRole === 'owner' ? 'owner' : userRole ? 'member' : null,
    },
  });
};

/**
 * PUT /api/orgs/[slug] - Update organization
 */
export const PUT: RequestHandler = async ({ locals, platform, params, request }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Check if user is the organization owner
  const membership = await db.prepare(`
    SELECT om.role FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string }>();

  if (membership?.role !== 'owner') {
    throw error(403, 'Only the organization owner can update the organization');
  }

  const update = await readOrganizationUpdate(request);
  const now = Date.now();

  await db.prepare(`
    UPDATE organizations
    SET display_name = CASE WHEN ? = 1 THEN ? ELSE display_name END,
        description = CASE WHEN ? = 1 THEN ? ELSE description END,
        avatar_url = CASE WHEN ? = 1 THEN ? ELSE avatar_url END,
        updated_at = CASE WHEN updated_at >= ? THEN updated_at + 1 ELSE ? END
    WHERE slug = ? COLLATE NOCASE
  `)
    .bind(
      update.hasDisplayName ? 1 : 0,
      update.displayName,
      update.hasDescription ? 1 : 0,
      update.description,
      update.hasAvatarUrl ? 1 : 0,
      update.avatarUrl,
      now,
      now,
      slug
    )
    .run();

  await invalidateCache(getOrgPageSnapshotCacheKey(slug));

  return json({
    success: true,
    message: 'Organization updated successfully',
  });
};

/**
 * DELETE /api/orgs/[slug] - Delete organization
 */
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Only owner can delete
  const org = await db.prepare(`
    SELECT id, owner_id FROM organizations WHERE slug = ? COLLATE NOCASE
  `)
    .bind(slug)
    .first<{ id: string; owner_id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  if (org.owner_id !== session.user.id) {
    throw error(403, 'Only the organization owner can delete it');
  }

  // Keep the skill guard and delete in one statement so a concurrent publish
  // cannot leave an orphaned skill or a half-deleted organization.
  const deleted = await db.prepare(`
    DELETE FROM organizations
    WHERE id = ?
      AND NOT EXISTS (
        SELECT 1 FROM skills WHERE org_id = ? LIMIT 1
      )
  `)
    .bind(org.id, org.id)
    .run();

  if (deleted.meta.changes === 0) {
    throw error(409, 'Cannot delete organization with existing skills. Remove or transfer skills first.');
  }

  await invalidateCache(getOrgPageSnapshotCacheKey(slug));

  return json({
    success: true,
    message: 'Organization deleted successfully',
  });
};
