import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import {
  canWriteSkill,
  grantSkillPermission,
  revokeSkillPermission,
  listSkillPermissions,
} from '$lib/server/auth/permissions';

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error(400, 'JSON body must be an object');
  }

  return value as Record<string, unknown>;
}

/**
 * POST /api/skills/[id]/share - Add a share permission
 */
export const POST: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Check write permission
  const canWrite = await canWriteSkill(skillId, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to share this skill');
  }

  const body = await readJsonObject(request) as {
    email?: string;
    userId?: string;
    permission?: 'read' | 'write';
    expiresInDays?: number;
  };

  const { email, userId, permission = 'read', expiresInDays } = body;

  if ((!email && !userId) || (email && userId)) {
    throw error(400, 'Provide exactly one of email or userId');
  }

  if (!['read', 'write'].includes(permission)) {
    throw error(400, 'permission must be read or write');
  }

  if (
    expiresInDays !== undefined
    && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
  ) {
    throw error(400, 'expiresInDays must be an integer between 1 and 365');
  }

  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedUserId = userId?.trim();
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw error(400, 'Invalid email address');
  }
  if (userId && !normalizedUserId) {
    throw error(400, 'userId cannot be empty');
  }

  if (!normalizedEmail && !normalizedUserId) {
    throw error(400, 'Either email or userId is required');
  }

  const granteeType = normalizedUserId ? 'user' : 'email';
  const granteeId = normalizedUserId || normalizedEmail!;

  await grantSkillPermission(
    skillId,
    granteeType,
    granteeId,
    permission,
    auth.principalId!,
    db,
    expiresInDays
  );

  return json({
    success: true,
    message: `Permission granted to ${granteeId}`,
  });
};

/**
 * GET /api/skills/[id]/share - List share permissions
 */
export const GET: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'read');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Check write permission
  const canWrite = await canWriteSkill(skillId, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to view shares for this skill');
  }

  const permissions = await listSkillPermissions(skillId, db);

  return json({
    success: true,
    permissions,
  });
};

/**
 * DELETE /api/skills/[id]/share - Remove a share permission
 */
export const DELETE: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Check write permission
  const canWrite = await canWriteSkill(skillId, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to manage shares for this skill');
  }

  const body = await readJsonObject(request) as {
    email?: string;
    userId?: string;
  };

  const { email, userId } = body;

  if ((!email && !userId) || (email && userId)) {
    throw error(400, 'Provide exactly one of email or userId');
  }

  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedUserId = userId?.trim();
  if (!normalizedEmail && !normalizedUserId) {
    throw error(400, 'Either email or userId is required');
  }

  const granteeType = normalizedUserId ? 'user' : 'email';
  const granteeId = normalizedUserId || normalizedEmail!;

  const revoked = await revokeSkillPermission(skillId, granteeType, granteeId, db);

  if (!revoked) {
    throw error(404, 'Permission not found');
  }

  return json({
    success: true,
    message: `Permission revoked from ${granteeId}`,
  });
};
