import { json, error } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import type { RequestHandler } from './$types';

interface OwnedOrganizationRow {
  id: string;
  public_skills_count: number;
}

interface ReplacementOwnerRow {
  org_id: string;
  user_id: string;
}

interface OrganizationPrivateSkillRow {
  org_id: string;
  id: string;
}

async function loadOwnedOrganizations(
  db: D1Database,
  userId: string
): Promise<OwnedOrganizationRow[]> {
  const result = await db.prepare(`
    SELECT
      o.id,
      COUNT(s.id) AS public_skills_count
    FROM organizations o
    LEFT JOIN skills s
      ON s.org_id = o.id
     AND s.visibility = 'public'
    WHERE o.owner_id = ?
    GROUP BY o.id
  `)
    .bind(userId)
    .all<OwnedOrganizationRow>();

  return result.results || [];
}

async function loadReplacementOwnersByOrg(
  db: D1Database,
  orgIds: string[],
  excludedUserId: string
): Promise<Map<string, string>> {
  if (orgIds.length === 0) {
    return new Map();
  }

  const placeholders = orgIds.map(() => '?').join(',');
  const result = await db.prepare(`
    WITH ranked_members AS (
      SELECT
        om.org_id,
        om.user_id,
        ROW_NUMBER() OVER (
          PARTITION BY om.org_id
          ORDER BY
            CASE om.role
              WHEN 'owner' THEN 0
              WHEN 'admin' THEN 1
              ELSE 2
            END,
            om.joined_at ASC
        ) AS rn
      FROM org_members om
      WHERE om.org_id IN (${placeholders})
        AND om.user_id != ?
    )
    SELECT org_id, user_id
    FROM ranked_members
    WHERE rn = 1
  `)
    .bind(...orgIds, excludedUserId)
    .all<ReplacementOwnerRow>();

  return new Map((result.results || []).map((row) => [row.org_id, row.user_id]));
}

async function loadOrganizationPrivateSkillIds(
  db: D1Database,
  orgIds: string[]
): Promise<Map<string, string[]>> {
  if (orgIds.length === 0) {
    return new Map();
  }

  const placeholders = orgIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT org_id, id
    FROM skills
    WHERE org_id IN (${placeholders})
      AND visibility != 'public'
  `)
    .bind(...orgIds)
    .all<OrganizationPrivateSkillRow>();

  const privateSkillIdsByOrg = new Map<string, string[]>();
  for (const row of result.results || []) {
    const existing = privateSkillIdsByOrg.get(row.org_id);
    if (existing) {
      existing.push(row.id);
    } else {
      privateSkillIdsByOrg.set(row.org_id, [row.id]);
    }
  }

  return privateSkillIdsByOrg;
}

/**
 * DELETE /api/account - Soft delete user account
 *
 * This implements a soft delete approach:
 * 1. Delete private data (sessions, tokens, favorites, private skills)
 * 2. Orphan public data (set owner_id = NULL, store github_user_id for re-linking)
 * 3. Delete user record
 *
 * When user logs in again with same GitHub account, public skills are re-linked.
 */
export const DELETE: RequestHandler = async ({ locals, platform }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const userId = session.user.id;

  try {
    // Get user's GitHub account ID for re-linking support
    const accountResult = await db.prepare(`
      SELECT account_id FROM account WHERE user_id = ? AND provider_id = 'github'
    `).bind(userId).first<{ account_id: string }>();

    const githubUserId = accountResult?.account_id;

    // Start deletion process
    // 1. Delete sessions (logs user out)
    await db.prepare(`DELETE FROM session WHERE user_id = ?`).bind(userId).run();

    // 2. Delete API tokens
    await db.prepare(`DELETE FROM api_tokens WHERE user_id = ?`).bind(userId).run();

    // 3. Delete refresh tokens
    await db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).bind(userId).run();

    // 4. Delete device codes
    await db.prepare(`DELETE FROM device_codes WHERE user_id = ?`).bind(userId).run();

    // 5. Delete favorites
    await db.prepare(`DELETE FROM favorites WHERE user_id = ?`).bind(userId).run();

    // 6. Delete private/unlisted skills completely
    // First get the IDs of private skills to delete related data
    const privateSkillsResult = await db.prepare(`
      SELECT id FROM skills WHERE owner_id = ? AND visibility != 'public'
    `).bind(userId).all<{ id: string }>();

    const privateSkillIds = privateSkillsResult.results.map(s => s.id);

    if (privateSkillIds.length > 0) {
      // Delete skill categories for private skills
      for (const skillId of privateSkillIds) {
        await db.prepare(`DELETE FROM skill_categories WHERE skill_id = ?`).bind(skillId).run();
        await db.prepare(`DELETE FROM skill_tags WHERE skill_id = ?`).bind(skillId).run();
        await db.prepare(`DELETE FROM skill_permissions WHERE skill_id = ?`).bind(skillId).run();
        await db.prepare(`DELETE FROM content_hashes WHERE skill_id = ?`).bind(skillId).run();
      }

      // Delete the private skills themselves
      await db.prepare(`
        DELETE FROM skills WHERE owner_id = ? AND visibility != 'public'
      `).bind(userId).run();
    }

    // 7. Orphan public skills (set owner_id = NULL)
    // The github_user_id is stored in the authors table for re-linking
    if (githubUserId) {
      // Update authors table to preserve the link for re-linking
      await db.prepare(`
        UPDATE authors SET user_id = NULL WHERE user_id = ?
      `).bind(userId).run();
    }

    // Orphan public skills
    await db.prepare(`
      UPDATE skills SET owner_id = NULL WHERE owner_id = ? AND visibility = 'public'
    `).bind(userId).run();

    // 8. Handle organizations
    const ownedOrganizations = await loadOwnedOrganizations(db, userId);
    const orgIdsWithPublicSkills = ownedOrganizations
      .filter((org) => Number(org.public_skills_count) > 0)
      .map((org) => org.id);
    const replacementOwnersByOrg = await loadReplacementOwnersByOrg(db, orgIdsWithPublicSkills, userId);
    const orgPrivateSkillIdsByOrg = await loadOrganizationPrivateSkillIds(db, orgIdsWithPublicSkills);

    for (const org of ownedOrganizations) {
      if (org.public_skills_count > 0) {
        // Keep orgs with public skills: transfer ownership if possible.
        const replacementOwnerUserId = replacementOwnersByOrg.get(org.id) || null;
        const transferAt = Date.now();

        if (replacementOwnerUserId) {
          await db.prepare(`
            UPDATE organizations
            SET owner_id = ?, updated_at = ?
            WHERE id = ?
          `)
            .bind(replacementOwnerUserId, transferAt, org.id)
            .run();

          await db.prepare(`
            UPDATE org_members
            SET role = 'owner'
            WHERE org_id = ? AND user_id = ?
          `)
            .bind(org.id, replacementOwnerUserId)
            .run();
        } else {
          // No remaining member to transfer to.
          // Treat org as deleted: remove non-public org skills, keep public skills.
          const orgPrivateSkillIds = orgPrivateSkillIdsByOrg.get(org.id) || [];
          if (orgPrivateSkillIds.length > 0) {
            for (const skillId of orgPrivateSkillIds) {
              await db.prepare(`DELETE FROM skill_categories WHERE skill_id = ?`).bind(skillId).run();
              await db.prepare(`DELETE FROM skill_tags WHERE skill_id = ?`).bind(skillId).run();
              await db.prepare(`DELETE FROM skill_permissions WHERE skill_id = ?`).bind(skillId).run();
              await db.prepare(`DELETE FROM content_hashes WHERE skill_id = ?`).bind(skillId).run();
            }

            await db.prepare(`
              DELETE FROM skills WHERE org_id = ? AND visibility != 'public'
            `).bind(org.id).run();
          }

          // Delete org members first (explicit), then org.
          // Public skills are preserved and detached via ON DELETE SET NULL (skills.org_id).
          await db.prepare(`DELETE FROM org_members WHERE org_id = ?`).bind(org.id).run();
          await db.prepare(`DELETE FROM organizations WHERE id = ?`).bind(org.id).run();
        }
      } else {
        // Delete organization without public skills
        await db.prepare(`DELETE FROM org_members WHERE org_id = ?`).bind(org.id).run();
        await db.prepare(`DELETE FROM organizations WHERE id = ?`).bind(org.id).run();
      }
    }

    // Remove user from organizations they don't own
    await db.prepare(`DELETE FROM org_members WHERE user_id = ?`).bind(userId).run();

    // 9. Delete OAuth accounts
    await db.prepare(`DELETE FROM account WHERE user_id = ?`).bind(userId).run();

    // 10. Delete user record
    await db.prepare(`DELETE FROM user WHERE id = ?`).bind(userId).run();

    return json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (e) {
    console.error('Account deletion error:', e);
    throw error(500, 'Failed to delete account');
  }
};
