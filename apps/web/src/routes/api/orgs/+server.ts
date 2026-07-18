import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubRateLimitKVFromEnv, getGitHubRequestAuthFromEnv } from '$lib/server/github-client/env';
import { getUserByLogin, getViewerOrgMembership } from '$lib/server/github-client/rest';
import { invalidateCache } from '$lib/server/cache';
import { getOrgPageSnapshotCacheKey } from '$lib/server/cache/keys';

interface GitHubNamespace {
  id: number;
  avatarUrl: string | null;
  type: string;
}

async function getGitHubNamespace(
  name: string,
  githubToken: string,
  githubRateLimitKV?: KVNamespace
): Promise<GitHubNamespace | null> {
  try {
    const response = await getUserByLogin(name, {
      token: githubToken,
      rateLimitKV: githubRateLimitKV,
      userAgent: 'SkillsCat/1.0',
    });
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      id: number;
      avatar_url?: string | null;
      type?: string;
    };
    return {
      id: data.id,
      avatarUrl: data.avatar_url || null,
      type: data.type || '',
    };
  } catch {
    // GitHub availability must not prevent creating an unverified local org.
    return null;
  }
}

/**
 * POST /api/orgs - Create a new organization
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw error(400, 'Invalid organization request');
  }

  const body = rawBody as Record<string, unknown>;
  const requestedName = typeof body.name === 'string' ? body.name.trim() : '';
  const requestedSlug = typeof body.slug === 'string' ? body.slug.trim() : requestedName;
  const displayName = typeof body.displayName === 'string'
    ? body.displayName.trim()
    : requestedName;
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!requestedName) {
    throw error(400, 'Organization name is required');
  }

  // `name` historically doubled as the slug. Accept an explicit slug so the
  // settings UI can keep a human-readable display name without breaking the
  // stable owner namespace used by skill slugs and GitHub verification.
  if (!/^[a-zA-Z0-9_-]+$/.test(requestedSlug) || requestedSlug.length < 2 || requestedSlug.length > 39) {
    throw error(400, 'Organization slug must be 2-39 characters and contain only letters, numbers, hyphens, and underscores');
  }
  if (displayName.length > 100) {
    throw error(400, 'Organization display name must be 100 characters or less');
  }
  if (description.length > 500) {
    throw error(400, 'Organization description must be 500 characters or less');
  }

  const slug = requestedSlug.toLowerCase();
  const name = slug;

  // Check if slug already exists
  const existing = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ? COLLATE NOCASE
  `)
    .bind(slug)
    .first();

  if (existing) {
    throw error(409, 'An organization with this name already exists');
  }

  let githubOrgId: number | null = null;
  let githubAvatarUrl: string | null = null;
  let verifiedAt: number | null = null;

  // Existing GitHub namespaces are reserved. A matching organization can be
  // claimed only by an active GitHub admin and is verified during creation.
  const githubToken = getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined;
  if (githubToken) {
    const githubNamespace = await getGitHubNamespace(
      slug,
      githubToken,
      getGitHubRateLimitKVFromEnv(platform?.env)
    );

    if (githubNamespace && githubNamespace.type.toLowerCase() !== 'organization') {
      throw error(409, 'This name is already taken on GitHub');
    }

    if (githubNamespace?.type.toLowerCase() === 'organization') {
      const account = await db.prepare(`
        SELECT access_token FROM account
        WHERE user_id = ? AND provider_id = 'github'
        LIMIT 1
      `)
        .bind(session.user.id)
        .first<{ access_token: string | null }>();

      if (!account?.access_token) {
        throw error(409, 'This GitHub organization name is reserved. Sign in with GitHub to claim it.');
      }

      const membershipResponse = await getViewerOrgMembership(slug, {
        token: account.access_token,
        userAgent: 'SkillsCat/1.0',
      });
      if (!membershipResponse.ok) {
        throw error(403, `You must be an admin of the GitHub organization '${slug}' to claim it`);
      }

      const membership = await membershipResponse.json() as { role?: string; state?: string };
      if (membership.state !== 'active' || membership.role !== 'admin') {
        throw error(403, `You must be an active admin of the GitHub organization '${slug}' to claim it`);
      }

      githubOrgId = githubNamespace.id;
      githubAvatarUrl = githubNamespace.avatarUrl;
      verifiedAt = Date.now();
    }
  }

  const orgId = crypto.randomUUID();
  const now = Date.now();

  try {
    await db.batch([
      db.prepare(`
        INSERT INTO organizations (
          id, name, slug, display_name, description, avatar_url, github_org_id,
          verified_at, owner_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orgId,
        name,
        slug,
        displayName || name,
        description || null,
        githubAvatarUrl,
        githubOrgId,
        verifiedAt,
        session.user.id,
        now,
        now
      ),
      db.prepare(`
        INSERT INTO org_members (org_id, user_id, role, joined_at)
        VALUES (?, ?, 'owner', ?)
      `).bind(orgId, session.user.id, now),
    ]);
  } catch (insertError) {
    const message = String(insertError);
    if (
      message.includes('organizations_slug_unique')
      || message.includes('organizations.slug')
      || message.includes('organizations_name_unique')
      || message.includes('organizations.name')
    ) {
      throw error(409, 'An organization with this name already exists');
    }
    throw insertError;
  }

  await invalidateCache(getOrgPageSnapshotCacheKey(slug));

  return json({
    success: true,
    orgId,
    slug,
    verified: verifiedAt !== null,
    message: 'Organization created successfully',
  });
};

/**
 * GET /api/orgs - List user's organizations
 */
export const GET: RequestHandler = async ({ locals, platform }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const results = await db.prepare(`
    SELECT o.id, o.name, o.slug, o.display_name, o.description, o.avatar_url,
           o.verified_at, om.role, o.created_at
    FROM organizations o
    INNER JOIN org_members om ON o.id = om.org_id
    WHERE om.user_id = ?
    ORDER BY o.name
  `)
    .bind(session.user.id)
    .all<{
      id: string;
      name: string;
      slug: string;
      display_name: string | null;
      description: string | null;
      avatar_url: string | null;
      verified_at: number | null;
      role: string;
      created_at: number;
    }>();

  return json({
    success: true,
    organizations: results.results.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: org.display_name,
      description: org.description,
      avatarUrl: org.avatar_url,
      verified: org.verified_at !== null,
      role: org.role === 'owner' ? 'owner' : 'member',
      createdAt: org.created_at,
    })),
  });
};
