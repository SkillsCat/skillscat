import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

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
    // Get organizations owned by this user
    const ownedOrgsResult = await db.prepare(`
      SELECT o.id,
        (SELECT COUNT(*) FROM skills s WHERE s.org_id = o.id AND s.visibility = 'public') as public_skills_count
      FROM organizations o
      WHERE o.owner_id = ?
    `).bind(userId).all<{ id: string; public_skills_count: number }>();

    for (const org of ownedOrgsResult.results) {
      if (org.public_skills_count > 0) {
        // Orphan organization with public skills
        await db.prepare(`
          UPDATE organizations SET owner_id = NULL WHERE id = ?
        `).bind(org.id).run();
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
