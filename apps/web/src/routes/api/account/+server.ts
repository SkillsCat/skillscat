import { json, error } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import type { RequestHandler } from './$types';
import { deleteSkillArtifactsAndInvalidateCaches } from '$lib/server/skill/delete';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';

interface OwnedOrganizationRow {
  id: string;
  slug: string;
}

interface ReplacementOwnerRow {
  org_id: string;
  user_id: string;
}

interface AccountSkillRow {
  id: string;
  slug: string;
  visibility: 'public' | 'private' | 'unlisted';
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
  org_id: string | null;
}

async function loadOwnedOrganizations(
  db: D1Database,
  userId: string
): Promise<OwnedOrganizationRow[]> {
  const result = await db.prepare(`
    SELECT o.id, o.slug
    FROM organizations o
    WHERE o.owner_id = ?
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
            CASE om.role WHEN 'owner' THEN 0 ELSE 1 END,
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

async function loadPersonalSkills(
  db: D1Database,
  userId: string
): Promise<AccountSkillRow[]> {
  const result = await db.prepare(`
    SELECT
      id,
      slug,
      visibility,
      source_type,
      repo_owner,
      repo_name,
      skill_path,
      org_id
    FROM skills
    WHERE owner_id = ?
      AND org_id IS NULL
  `)
    .bind(userId)
    .all<AccountSkillRow>();

  return result.results || [];
}

async function loadOrganizationSkillsByOrg(
  db: D1Database,
  orgIds: string[]
): Promise<Map<string, AccountSkillRow[]>> {
  if (orgIds.length === 0) {
    return new Map();
  }

  const placeholders = orgIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT
      id,
      slug,
      visibility,
      source_type,
      repo_owner,
      repo_name,
      skill_path,
      org_id
    FROM skills
    WHERE org_id IN (${placeholders})
  `)
    .bind(...orgIds)
    .all<AccountSkillRow>();

  const skillsByOrg = new Map<string, AccountSkillRow[]>();
  for (const row of result.results || []) {
    if (!row.org_id) continue;
    const existing = skillsByOrg.get(row.org_id);
    if (existing) {
      existing.push(row);
    } else {
      skillsByOrg.set(row.org_id, [row]);
    }
  }

  return skillsByOrg;
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
    // Keep the current session alive until all resource ownership work has
    // completed. If an R2 or D1 operation fails before the final batch, the
    // user can retry instead of being locked out with a half-deleted account.

    // 1. Delete private/unlisted skills completely
    const personalSkills = await loadPersonalSkills(db, userId);
    for (const skill of personalSkills) {
      if (skill.visibility === 'public') continue;
      await deleteSkillArtifactsAndInvalidateCaches({
        db,
        r2: platform?.env?.R2,
        skill: {
          id: skill.id,
          slug: skill.slug,
          sourceType: skill.source_type,
          repoOwner: skill.repo_owner,
          repoName: skill.repo_name,
          skillPath: skill.skill_path,
        },
      });
    }

    // 2. Orphan public skills (set owner_id = NULL)
    // The github_user_id is stored in the authors table for re-linking
    // Always unlink the local user reference. GitHub-backed author rows retain
    // their github_id even when the Better Auth account row is missing.
    await db.prepare(`
      UPDATE authors SET user_id = NULL WHERE user_id = ?
    `).bind(userId).run();

    // Orphan public skills
    await db.prepare(`
      UPDATE skills SET owner_id = NULL WHERE owner_id = ? AND org_id IS NULL AND visibility = 'public'
    `).bind(userId).run();

    for (const skill of personalSkills) {
      if (skill.visibility === 'public') {
        await invalidateOpenClawSkillCaches(skill.id, skill.slug);
      }
    }

    // Organization skills belong to the organization. Remove the historical
    // uploader link before deleting the account; membership/organization role
    // remains the authority for those skills.
    await db.prepare(`
      UPDATE skills SET owner_id = NULL WHERE owner_id = ? AND org_id IS NOT NULL
    `).bind(userId).run();

    // 3. Handle organizations
    const ownedOrganizations = await loadOwnedOrganizations(db, userId);
    const ownedOrgIds = ownedOrganizations.map((org) => org.id);
    const replacementOwnersByOrg = await loadReplacementOwnersByOrg(db, ownedOrgIds, userId);
    const orgIdsWithoutReplacement = ownedOrgIds.filter((orgId) => !replacementOwnersByOrg.has(orgId));
    const orgSkillsByOrg = await loadOrganizationSkillsByOrg(db, orgIdsWithoutReplacement);

    for (const org of ownedOrganizations) {
      const replacementOwnerUserId = replacementOwnersByOrg.get(org.id) || null;
      const transferAt = Date.now();

      if (replacementOwnerUserId) {
          // Preserve the organization and all of its skills when another member
          // can take ownership, regardless of current skill visibility.
          await db.prepare(`
            UPDATE organizations
            SET owner_id = ?,
                updated_at = CASE WHEN updated_at >= ? THEN updated_at + 1 ELSE ? END
            WHERE id = ?
          `)
            .bind(replacementOwnerUserId, transferAt, transferAt, org.id)
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
          const orgSkills = orgSkillsByOrg.get(org.id) || [];
          for (const skill of orgSkills) {
            if (skill.visibility === 'public') continue;
            await deleteSkillArtifactsAndInvalidateCaches({
              db,
              r2: platform?.env?.R2,
              skill: {
                id: skill.id,
                slug: skill.slug,
                sourceType: skill.source_type,
                repoOwner: skill.repo_owner,
                repoName: skill.repo_name,
                skillPath: skill.skill_path,
              },
            });
          }

          // Once the organization is removed, its surviving public skills
          // become ownerless records. Historical uploaders must not regain
          // personal control through ON DELETE SET NULL on skills.org_id.
          await db.prepare(`
            UPDATE skills
            SET owner_id = NULL
            WHERE org_id = ? AND visibility = 'public'
          `).bind(org.id).run();

          // Delete org members first (explicit), then org.
          // Public skills are preserved and detached via ON DELETE SET NULL (skills.org_id).
          await db.prepare(`DELETE FROM org_members WHERE org_id = ?`).bind(org.id).run();
          await db.prepare(`DELETE FROM organizations WHERE id = ?`).bind(org.id).run();

          for (const skill of orgSkills) {
            if (skill.visibility === 'public') {
              await invalidateOpenClawSkillCaches(skill.id, skill.slug, org.slug);
            }
          }
      }
    }

    // Advance the organization marker before removing the remaining
    // memberships. Other data centers validate public snapshots against this
    // marker, so a departed user is not shown until the local cache TTL ends.
    const membershipRemovalAt = Date.now();
    await db.prepare(`
      UPDATE organizations
      SET updated_at = CASE WHEN updated_at >= ? THEN updated_at + 1 ELSE ? END
      WHERE id IN (
        SELECT org_id FROM org_members WHERE user_id = ?
      )
    `)
      .bind(membershipRemovalAt, membershipRemovalAt, userId)
      .run();

    // Remove user from organizations they don't own
    await db.prepare(`DELETE FROM org_members WHERE user_id = ?`).bind(userId).run();

    // 4. Atomically remove authentication and user-owned private state last.
    // D1 batch executes transactionally, so a failure keeps the account and
    // current session available for a safe retry.
    await db.batch([
      db.prepare(`DELETE FROM session WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM api_tokens WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM device_codes WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM favorites WHERE user_id = ?`).bind(userId),
      db.prepare(`UPDATE user_actions SET user_id = NULL WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM account WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM user WHERE id = ?`).bind(userId),
    ]);

    return json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (e) {
    console.error('Account deletion error:', e);
    throw error(500, 'Failed to delete account');
  }
};
