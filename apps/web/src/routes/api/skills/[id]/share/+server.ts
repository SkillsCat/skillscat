import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import {
  canWriteSkill,
  grantSkillPermission,
  revokeSkillPermission,
  listSkillPermissions,
} from '$lib/server/permissions';

/**
 * POST /api/skills/[id]/share - Add a share permission
 */
export const POST: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Check write permission
  const canWrite = await canWriteSkill(skillId, auth.userId, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to share this skill');
  }

  const body = await request.json() as {
    email?: string;
    userId?: string;
    permission?: 'read' | 'write';
    expiresInDays?: number;
  };

  const { email, userId, permission = 'read', expiresInDays } = body;

  if (!email && !userId) {
    throw error(400, 'Either email or userId is required');
  }

  const granteeType = userId ? 'user' : 'email';
  const granteeId = userId || email!;

  await grantSkillPermission(
    skillId,
    granteeType,
    granteeId,
    permission,
    auth.userId,
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
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'read');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Check write permission
  const canWrite = await canWriteSkill(skillId, auth.userId, db);
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
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Check write permission
  const canWrite = await canWriteSkill(skillId, auth.userId, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to manage shares for this skill');
  }

  const body = await request.json() as {
    email?: string;
    userId?: string;
  };

  const { email, userId } = body;

  if (!email && !userId) {
    throw error(400, 'Either email or userId is required');
  }

  const granteeType = userId ? 'user' : 'email';
  const granteeId = userId || email!;

  const revoked = await revokeSkillPermission(skillId, granteeType, granteeId, db);

  if (!revoked) {
    throw error(404, 'Permission not found');
  }

  return json({
    success: true,
    message: `Permission revoked from ${granteeId}`,
  });
};
