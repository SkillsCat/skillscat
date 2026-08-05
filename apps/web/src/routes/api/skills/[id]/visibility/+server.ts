import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubRateLimitKVFromEnv, getGitHubRequestAuthFromEnv } from '$lib/server/github-client/env';
import { invalidateCache } from '$lib/server/cache';
import { getCategoryPageCacheInvalidationKeys } from '$lib/server/cache/categories';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/auth/permissions';
import { getRepo } from '$lib/server/github-client/rest';
import {
  buildIndexNowSkillUrls,
  resolveIndexNowOwnerHandle,
  scheduleIndexNowSubmission,
} from '$lib/server/seo/indexnow';
import { isSeoIndexableSkill } from '$lib/seo/indexability';
import { syncCategoryPublicStats } from '$lib/server/db/business/stats';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';
import { buildTouchOrganizationStatement } from '$lib/server/org/mutations';

async function readVisibilityBody(request: Request): Promise<{
  visibility?: unknown;
  repoUrl?: unknown;
}> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error(400, 'JSON body must be an object');
  }

  return value as { visibility?: unknown; repoUrl?: unknown };
}

async function runVisibilityUpdate(
  db: D1Database,
  statement: D1PreparedStatement,
  orgId: string | null,
  now: number
): Promise<void> {
  if (orgId) {
    await db.batch([
      statement,
      buildTouchOrganizationStatement(db, orgId, now),
    ]);
    return;
  }

  await statement.run();
}

/**
 * Verify that a GitHub repo exists and belongs to the user
 */
async function verifyGitHubRepo(
  repoUrl: string,
  userGithubId: number,
  githubToken?: string,
  githubRateLimitKV?: KVNamespace
): Promise<
  | { valid: true; normalizedUrl: string }
  | { valid: false; error: string }
> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    return { valid: false, error: 'Invalid GitHub repository URL' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  if (
    parsedUrl.protocol !== 'https:'
    || (hostname !== 'github.com' && hostname !== 'www.github.com')
    || pathParts.length !== 2
  ) {
    return { valid: false, error: 'Invalid GitHub repository URL' };
  }

  const owner = pathParts[0];
  const repo = pathParts[1].replace(/\.git$/, '');
  if (
    !/^[a-zA-Z0-9-]{1,39}$/.test(owner)
    || !repo
    || !/^[a-zA-Z0-9._-]+$/.test(repo)
  ) {
    return { valid: false, error: 'Invalid GitHub repository URL' };
  }

  const response = await getRepo(owner, repo, {
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

  if (data.owner.id !== userGithubId) {
    return { valid: false, error: 'Repository must be owned by you' };
  }

  if (data.fork) {
    return { valid: false, error: 'Forked repositories are not accepted' };
  }

  return {
    valid: true,
    normalizedUrl: `https://github.com/${owner}/${repo}`,
  };
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
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  const canWrite = await canWriteSkill(skillId, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to change visibility');
  }

  const body = await readVisibilityBody(request);

  const { visibility, repoUrl } = body;

  if (visibility !== 'public' && visibility !== 'private' && visibility !== 'unlisted') {
    throw error(400, 'Invalid visibility. Must be public, private, or unlisted');
  }
  if (repoUrl !== undefined && typeof repoUrl !== 'string') {
    throw error(400, 'repoUrl must be a string');
  }

  // Get current skill info
  const skill = await db.prepare(`
    SELECT
      s.slug AS slug,
      s.visibility AS visibility,
      s.source_type AS source_type,
      s.org_id AS org_id,
      s.repo_owner AS repo_owner,
      s.repo_name AS repo_name,
      s.description AS description,
      s.tier AS tier,
      s.indexed_at AS indexed_at,
      (TRIM(COALESCE(s.readme, '')) <> '') AS has_readme,
      o.slug AS org_slug,
      o.github_org_id AS github_org_id,
      o.verified_at AS org_verified_at,
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
      org_id: string | null;
      repo_owner: string | null;
      repo_name: string | null;
      description: string | null;
      tier: string | null;
      indexed_at: number | null;
      has_readme: number | null;
      org_slug: string | null;
      github_org_id: number | null;
      org_verified_at: number | null;
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
  const becamePublic = skill.visibility !== 'public' && visibility === 'public';
  const now = Date.now();

  // Every transition into public requires verification for uploaded skills.
  if (becamePublic && skill.source_type === 'upload') {
    if (skill.org_id) {
      if (skill.github_org_id === null || skill.org_verified_at === null) {
        throw error(403, 'Public organization skills require a verified GitHub organization');
      }

      await runVisibilityUpdate(db, db.prepare(`
        UPDATE skills SET visibility = ?, updated_at = ?, indexed_at = ? WHERE id = ?
      `)
        .bind(visibility, now, now, skillId), skill.org_id, now);
    } else {
      if (!auth.userId) {
        throw error(400, 'A user account is required to verify this uploaded skill');
      }
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

      const userGithubId = account ? Number(account.account_id) : Number.NaN;
      if (!Number.isSafeInteger(userGithubId) || userGithubId <= 0) {
        throw error(400, 'GitHub account not linked. Please sign in with GitHub first.');
      }
      const githubToken = getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined;

      const verification = await verifyGitHubRepo(
        repoUrl,
        userGithubId,
        githubToken,
        getGitHubRateLimitKVFromEnv(platform?.env)
      );
      if (!verification.valid) {
        throw error(400, verification.error!);
      }

      // Update with the canonical verified repository URL.
      await runVisibilityUpdate(db, db.prepare(`
        UPDATE skills
        SET visibility = ?, verified_repo_url = ?, updated_at = ?, indexed_at = ?
        WHERE id = ?
      `)
        .bind(visibility, verification.normalizedUrl, now, now, skillId), skill.org_id, now);
    }
  } else {
    // GitHub-sourced skills and transitions away from public do not need
    // upload ownership verification.
    await runVisibilityUpdate(db, db.prepare(`
      UPDATE skills SET visibility = ?, updated_at = ?, indexed_at = ? WHERE id = ?
    `)
      .bind(visibility, now, becamePublic ? now : skill.indexed_at, skillId), skill.org_id, now);
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
    try {
      await syncCategoryPublicStats(db, categorySlugs);
    } catch (statsError) {
      console.error(`Failed to sync category stats for visibility change ${skill.slug}:`, statsError);
    }
  }

  const categoryCacheKeys = new Set<string>();

  for (const categorySlug of categorySlugs) {
    for (const cacheKey of getCategoryPageCacheInvalidationKeys(categorySlug)) {
      categoryCacheKeys.add(cacheKey);
    }
  }

  try {
    await Promise.all([
      ...Array.from(categoryCacheKeys, (cacheKey) => invalidateCache(cacheKey)),
      invalidateOpenClawSkillCaches(skillId, skill.slug, skill.org_slug, {
        owner: skill.repo_owner,
        name: skill.repo_name,
      }),
    ]);
  } catch (cacheError) {
    console.error(`Failed to invalidate caches for visibility change ${skill.slug}:`, cacheError);
  }

  try {
    if (visibility === 'public') {
      const nextIndexNowUrls = buildIndexNowSkillUrls({
        slug: skill.slug,
        visibility,
        seoIndexable: isSeoIndexableSkill({
          visibility,
          description: skill.description,
          tier: skill.tier,
          readme: skill.has_readme ? 'present' : null,
        }),
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
