/**
 * Permissions Module
 *
 * Handles skill access control and permission checks
 */

import type { D1Database } from '@cloudflare/workers-types';

export type Permission = 'read' | 'write';
export type Visibility = 'public' | 'private' | 'unlisted';

interface SkillAccessInfo {
  id: string;
  visibility: Visibility;
  ownerId: string | null;
  orgId: string | null;
}

export interface SkillAccessPrincipal {
  userId: string | null;
  orgId: string | null;
}

type SkillPrincipalInput = string | null | SkillAccessPrincipal;

function normalizePrincipal(input: SkillPrincipalInput): SkillAccessPrincipal {
  if (typeof input === 'string' || input === null) {
    return { userId: input, orgId: null };
  }

  return {
    userId: input.userId ?? null,
    orgId: input.orgId ?? null,
  };
}

/**
 * Check if a user has access to a skill
 */
export async function checkSkillAccess(
  skillId: string,
  principalInput: SkillPrincipalInput,
  db: D1Database
): Promise<boolean> {
  const principal = normalizePrincipal(principalInput);
  // Get skill info
  const skill = await db.prepare(`
    SELECT
      id,
      visibility,
      owner_id as ownerId,
      org_id as orgId
    FROM skills
    WHERE id = ?
  `)
    .bind(skillId)
    .first<SkillAccessInfo>();

  if (!skill) {
    return false;
  }

  // Public skills are accessible to everyone
  if (skill.visibility === 'public') {
    return true;
  }

  // Unlisted skills are accessible via direct link (no auth required)
  if (skill.visibility === 'unlisted') {
    return true;
  }

  // Private skills require authentication
  if (!principal.userId && !principal.orgId) {
    return false;
  }

  // Personal skill owners retain direct access. Organization skills require
  // current membership so a former member cannot keep access via owner_id.
  if (principal.userId && !skill.orgId && skill.ownerId === principal.userId) {
    return true;
  }

  // Organization tokens represent the organization directly.
  if (principal.orgId && skill.orgId === principal.orgId) {
    return true;
  }

  // Check organization membership
  if (skill.orgId && principal.userId) {
    const membership = await db.prepare(`
      SELECT 1 FROM org_members
      WHERE org_id = ? AND user_id = ?
    `)
      .bind(skill.orgId, principal.userId)
      .first();

    if (membership) {
      return true;
    }
  }

  // Check explicit permissions
  if (!principal.userId) {
    return false;
  }

  const permission = await db.prepare(`
    SELECT 1 FROM skill_permissions
    WHERE skill_id = ?
      AND (
        (grantee_type = 'user' AND grantee_id = ?)
        OR (
          grantee_type = 'email'
          AND LOWER(grantee_id) = (
            SELECT LOWER(email) FROM user WHERE id = ? LIMIT 1
          )
        )
      )
      AND (expires_at IS NULL OR expires_at > ?)
  `)
    .bind(skillId, principal.userId, principal.userId, Date.now())
    .first();

  return permission !== null;
}

/**
 * Check if a user is the owner of a skill
 */
export async function isSkillOwner(
  skillId: string,
  userId: string,
  db: D1Database
): Promise<boolean> {
  const skill = await db.prepare(`
    SELECT owner_id FROM skills WHERE id = ?
  `)
    .bind(skillId)
    .first<{ owner_id: string | null }>();

  return skill?.owner_id === userId;
}

/**
 * Check if a user can write to a skill (skill owner or organization owner)
 */
export async function canWriteSkill(
  skillId: string,
  principalInput: SkillPrincipalInput,
  db: D1Database
): Promise<boolean> {
  const principal = normalizePrincipal(principalInput);
  const skill = await db.prepare(`
    SELECT owner_id, org_id FROM skills WHERE id = ?
  `)
    .bind(skillId)
    .first<{ owner_id: string | null; org_id: string | null }>();

  if (!skill) {
    return false;
  }

  // Personal skill owners can always write.
  if (principal.userId && !skill.org_id && skill.owner_id === principal.userId) {
    return true;
  }

  if (principal.orgId && skill.org_id === principal.orgId) {
    return true;
  }

  // Check organization owner role
  if (skill.org_id && principal.userId) {
    const membership = await db.prepare(`
      SELECT role FROM org_members
      WHERE org_id = ? AND user_id = ?
    `)
      .bind(skill.org_id, principal.userId)
      .first<{ role: string }>();

    if (
      membership?.role === 'owner'
      || (membership && skill.owner_id === principal.userId)
    ) {
      return true;
    }
  }

  // Check explicit write permission
  if (!principal.userId) {
    return false;
  }

  const permission = await db.prepare(`
    SELECT 1 FROM skill_permissions
    WHERE skill_id = ?
      AND (
        (grantee_type = 'user' AND grantee_id = ?)
        OR (
          grantee_type = 'email'
          AND LOWER(grantee_id) = (
            SELECT LOWER(email) FROM user WHERE id = ? LIMIT 1
          )
        )
      )
      AND permission = 'write'
      AND (expires_at IS NULL OR expires_at > ?)
  `)
    .bind(skillId, principal.userId, principal.userId, Date.now())
    .first();

  return permission !== null;
}

/**
 * Grant permission to a user for a skill
 */
export async function grantSkillPermission(
  skillId: string,
  granteeType: 'user' | 'email',
  granteeId: string,
  permission: Permission,
  grantedBy: string,
  db: D1Database,
  expiresInDays?: number
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = expiresInDays === undefined || expiresInDays === null
    ? null
    : now + expiresInDays * 24 * 60 * 60 * 1000;

  await db.prepare(`
    INSERT INTO skill_permissions (id, skill_id, grantee_type, grantee_id, permission, granted_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_id, grantee_type, grantee_id) DO UPDATE SET
      permission = excluded.permission,
      granted_by = excluded.granted_by,
      expires_at = excluded.expires_at
  `)
    .bind(id, skillId, granteeType, granteeId, permission, grantedBy, now, expiresAt)
    .run();

  return id;
}

/**
 * Revoke permission from a user for a skill
 */
export async function revokeSkillPermission(
  skillId: string,
  granteeType: 'user' | 'email',
  granteeId: string,
  db: D1Database
): Promise<boolean> {
  const granteePredicate = granteeType === 'email'
    ? 'LOWER(grantee_id) = LOWER(?)'
    : 'grantee_id = ?';
  const result = await db.prepare(`
    DELETE FROM skill_permissions
    WHERE skill_id = ? AND grantee_type = ? AND ${granteePredicate}
  `)
    .bind(skillId, granteeType, granteeId)
    .run();

  return result.meta.changes > 0;
}

/**
 * List all permissions for a skill
 */
export async function listSkillPermissions(
  skillId: string,
  db: D1Database
): Promise<Array<{
  id: string;
  granteeType: string;
  granteeId: string;
  permission: string;
  grantedBy: string;
  createdAt: number;
  expiresAt: number | null;
}>> {
  const results = await db.prepare(`
    SELECT id, grantee_type, grantee_id, permission, granted_by, created_at, expires_at
    FROM skill_permissions
    WHERE skill_id = ?
    ORDER BY created_at DESC
  `)
    .bind(skillId)
    .all<{
      id: string;
      grantee_type: string;
      grantee_id: string;
      permission: string;
      granted_by: string;
      created_at: number;
      expires_at: number | null;
    }>();

  return results.results.map(row => ({
    id: row.id,
    granteeType: row.grantee_type,
    granteeId: row.grantee_id,
    permission: row.permission,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}
