import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubRequestAuthFromEnv } from '$lib/server/github-client/env';
import { invalidateCache } from '$lib/server/cache';
import {
  getOrgPageSnapshotCacheKey,
  getSkillPageCacheInvalidationKeys,
  getSkillSourceCacheKey,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '$lib/server/cache/keys';
import { getCategoryPageCacheInvalidationKeys } from '$lib/server/cache/categories';
import { getSkillDetailCacheKeys } from '$lib/server/skill/detail';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import { isSkillOwner } from '$lib/server/auth/permissions';
import { getRepo } from '$lib/server/github-client/rest';
import {
  buildIndexNowSkillUrls,
  resolveIndexNowOwnerHandle,
  scheduleIndexNowSubmission,
} from '$lib/server/seo/indexnow';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';
import { getOnlineRecommendCacheKeys } from '$lib/server/ranking/recommend-runtime';

/**
 * Verify that a GitHub repo exists and belongs to the user
 */
async function verifyGitHubRepo(
  repoUrl: string,
  userGithubId: number | null,
  githubToken?: string,
  githubRateLimitKV?: KVNamespace
): Promise<{ valid: boolean; error?: string }> {
  // Parse GitHub URL
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    return { valid: false, error: 'Invalid GitHub URL' };
  }

  const [, owner, repo] = match;

  const response = await getRepo(owner, repo.replace(/\.git$/, ''), {
    token: githubToken,
    rateLimitKV: githubRateLimitKV,
    userAgent: 'SkillsCat/1.0',
  });

  if (!response.ok) {
    return { valid: false, error: 'Repository not found or not accessible' };
  }

  const data = await response.json() as {
    owner: { id: number; type: string };
    fork: boolean;
  };

  // Check if repo is owned by the user (not an org)
  if (data.owner.type !== 'User') {
    return { valid: false, error: 'Repository must be owned by a user, not an organization' };
  }

  // Optionally verify the owner matches the user's GitHub ID
  if (userGithubId && data.owner.id !== userGithubId) {
    return { valid: false, error: 'Repository must be owned by you' };
  }

  if (data.fork) {
    return { valid: false, error: 'Forked repositories are not accepted' };
  }

  return { valid: true };
}

/**
 * PUT /api/skills/[id]/visibility - Change skill visibility
 */
export const PUT: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Only owner can change visibility
  const isOwner = await isSkillOwner(skillId, auth.userId, db);
  if (!isOwner) {
    throw error(403, 'Only the skill owner can change visibility');
  }

  const body = await request.json() as {
    visibility: 'public' | 'private' | 'unlisted';
    repoUrl?: string;
  };

  const { visibility, repoUrl } = body;

  if (!['public', 'private', 'unlisted'].includes(visibility)) {
    throw error(400, 'Invalid visibility. Must be public, private, or unlisted');
  }

  // Get current skill info
  const skill = await db.prepare(`
    SELECT
      s.slug AS slug,
      s.visibility AS visibility,
      s.source_type AS source_type,
      s.repo_owner AS repo_owner,
      o.slug AS org_slug,
      a.username AS owner_username
    FROM skills s
    LEFT JOIN organizations o ON o.id = s.org_id
    LEFT JOIN authors a ON a.user_id = s.owner_id
    WHERE s.id = ?
  `)
    .bind(skillId)
    .first<{
      slug: string;
      visibility: string;
      source_type: string;
      repo_owner: string | null;
      org_slug: string | null;
      owner_username: string | null;
    }>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  const previousIndexNowUrls = buildIndexNowSkillUrls({
    slug: skill.slug,
    visibility: skill.visibility,
    orgSlug: skill.org_slug,
    ownerHandle: skill.org_slug ? null : resolveIndexNowOwnerHandle(skill.repo_owner, skill.owner_username),
  }, platform?.env);

  // Private to public requires verification
  if (skill.visibility === 'private' && visibility === 'public') {
    // If it's an uploaded skill, require a GitHub repo URL
    if (skill.source_type === 'upload') {
      if (!repoUrl) {
        throw error(400, 'A GitHub repository URL is required to make an uploaded skill public');
      }

      // Get user's GitHub ID for verification
      const account = await db.prepare(`
        SELECT account_id FROM account
        WHERE user_id = ? AND provider_id = 'github'
      `)
        .bind(auth.userId)
        .first<{ account_id: string }>();

      const userGithubId = account ? parseInt(account.account_id, 10) : null;
      const githubToken = getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined;

      const verification = await verifyGitHubRepo(repoUrl, userGithubId, githubToken, platform?.env?.KV);
      if (!verification.valid) {
        throw error(400, verification.error!);
      }

      // Update with verified repo URL
      await db.prepare(`
        UPDATE skills
        SET visibility = ?, verified_repo_url = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(visibility, repoUrl, Date.now(), skillId)
        .run();
    } else {
      // GitHub-sourced skill can be made public directly
      await db.prepare(`
        UPDATE skills SET visibility = ?, updated_at = ? WHERE id = ?
      `)
        .bind(visibility, Date.now(), skillId)
        .run();
    }
  } else {
    // Other visibility changes don't require verification
    await db.prepare(`
      UPDATE skills SET visibility = ?, updated_at = ? WHERE id = ?
    `)
      .bind(visibility, Date.now(), skillId)
      .run();
  }

  const categoryRows = await db.prepare(`
    SELECT category_slug FROM skill_categories WHERE skill_id = ?
  `)
    .bind(skillId)
    .all<{ category_slug: string }>();

  const categorySlugs = (categoryRows.results || [])
    .map((row) => row.category_slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);

  if (categorySlugs.length > 0) {
    await syncCategoryPublicStats(db, categorySlugs);
  }

  const cacheKeys = new Set<string>([
    ...getSkillDetailCacheKeys(skill.slug),
    `api:skill-files:${skill.slug}`,
    `skill:${skillId}`,
    ...getOnlineRecommendCacheKeys(skillId),
    getSkillSourceCacheKey(skill.slug),
    ...getSkillPageCacheInvalidationKeys(skill.slug),
    ...PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
  ]);

  if (skill.org_slug) {
    cacheKeys.add(getOrgPageSnapshotCacheKey(skill.org_slug));
  }

  for (const categorySlug of categorySlugs) {
    for (const cacheKey of getCategoryPageCacheInvalidationKeys(categorySlug)) {
      cacheKeys.add(cacheKey);
    }
  }

  await Promise.all(Array.from(cacheKeys, (cacheKey) => invalidateCache(cacheKey)));

  try {
    if (visibility === 'public') {
      const nextIndexNowUrls = buildIndexNowSkillUrls({
        slug: skill.slug,
        visibility,
        orgSlug: skill.org_slug,
        ownerHandle: skill.org_slug ? null : resolveIndexNowOwnerHandle(skill.repo_owner, skill.owner_username),
      }, platform?.env);
      const indexNowTask = scheduleIndexNowSubmission({
        env: platform?.env,
        waitUntil: platform?.context?.waitUntil?.bind(platform.context),
        urls: nextIndexNowUrls,
        action: 'update',
        source: `skill-visibility:${skill.slug}:public`,
      });

      if (indexNowTask) {
        await indexNowTask;
      }
    } else if (skill.visibility === 'public') {
      const indexNowTask = scheduleIndexNowSubmission({
        env: platform?.env,
        waitUntil: platform?.context?.waitUntil?.bind(platform.context),
        urls: previousIndexNowUrls,
        action: 'delete',
        source: `skill-visibility:${skill.slug}:${visibility}`,
      });

      if (indexNowTask) {
        await indexNowTask;
      }
    }
  } catch (indexNowError) {
    console.error(`Failed to enqueue IndexNow update for visibility change ${skill.slug}:`, indexNowError);
  }

  return json({
    success: true,
    message: `Skill visibility changed to ${visibility}`,
  });
};
