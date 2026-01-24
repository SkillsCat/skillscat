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

/**
 * Check if a user has access to a skill
 */
export async function checkSkillAccess(
  skillId: string,
  userId: string | null,
  db: D1Database
): Promise<boolean> {
  // Get skill info
  const skill = await db.prepare(`
    SELECT id, visibility, owner_id, org_id
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
  if (!userId) {
    return false;
  }

  // Owner always has access
  if (skill.ownerId === userId) {
    return true;
  }

  // Check organization membership
  if (skill.orgId) {
    const membership = await db.prepare(`
      SELECT 1 FROM org_members
      WHERE org_id = ? AND user_id = ?
    `)
      .bind(skill.orgId, userId)
      .first();

    if (membership) {
      return true;
    }
  }

  // Check explicit permissions
  const permission = await db.prepare(`
    SELECT 1 FROM skill_permissions
    WHERE skill_id = ?
      AND grantee_type = 'user'
      AND grantee_id = ?
      AND (expires_at IS NULL OR expires_at > ?)
  `)
    .bind(skillId, userId, Date.now())
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
 * Check if a user can write to a skill (owner or org admin)
 */
export async function canWriteSkill(
  skillId: string,
  userId: string,
  db: D1Database
): Promise<boolean> {
  const skill = await db.prepare(`
    SELECT owner_id, org_id FROM skills WHERE id = ?
  `)
    .bind(skillId)
    .first<{ owner_id: string | null; org_id: string | null }>();

  if (!skill) {
    return false;
  }

  // Owner can always write
  if (skill.owner_id === userId) {
    return true;
  }

  // Check org admin/owner role
  if (skill.org_id) {
    const membership = await db.prepare(`
      SELECT role FROM org_members
      WHERE org_id = ? AND user_id = ?
    `)
      .bind(skill.org_id, userId)
      .first<{ role: string }>();

    if (membership && ['owner', 'admin'].includes(membership.role)) {
      return true;
    }
  }

  // Check explicit write permission
  const permission = await db.prepare(`
    SELECT 1 FROM skill_permissions
    WHERE skill_id = ?
      AND grantee_type = 'user'
      AND grantee_id = ?
      AND permission = 'write'
      AND (expires_at IS NULL OR expires_at > ?)
  `)
    .bind(skillId, userId, Date.now())
    .first();

  return permission !== null;
}

/**
 * Get all skill IDs accessible to a user
 */
export async function getAccessibleSkillIds(
  userId: string,
  db: D1Database
): Promise<string[]> {
  // Get skills owned by user
  const ownedSkills = await db.prepare(`
    SELECT id FROM skills WHERE owner_id = ?
  `)
    .bind(userId)
    .all<{ id: string }>();

  // Get skills from user's organizations
  const orgSkills = await db.prepare(`
    SELECT s.id FROM skills s
    INNER JOIN org_members om ON s.org_id = om.org_id
    WHERE om.user_id = ?
  `)
    .bind(userId)
    .all<{ id: string }>();

  // Get skills with explicit permissions
  const permittedSkills = await db.prepare(`
    SELECT skill_id as id FROM skill_permissions
    WHERE grantee_type = 'user'
      AND grantee_id = ?
      AND (expires_at IS NULL OR expires_at > ?)
  `)
    .bind(userId, Date.now())
    .all<{ id: string }>();

  const allIds = new Set([
    ...ownedSkills.results.map(r => r.id),
    ...orgSkills.results.map(r => r.id),
    ...permittedSkills.results.map(r => r.id),
  ]);

  return Array.from(allIds);
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
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;

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
  const result = await db.prepare(`
    DELETE FROM skill_permissions
    WHERE skill_id = ? AND grantee_type = ? AND grantee_id = ?
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
