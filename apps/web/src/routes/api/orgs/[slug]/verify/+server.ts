import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * POST /api/orgs/[slug]/verify - Verify organization with GitHub
 */
export const POST: RequestHandler = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Check if user is owner
  const org = await db.prepare(`
    SELECT o.id, o.name, o.owner_id FROM organizations o
    WHERE o.slug = ?
  `)
    .bind(slug)
    .first<{ id: string; name: string; owner_id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  if (org.owner_id !== session.user.id) {
    throw error(403, 'Only the organization owner can verify it');
  }

  // Get user's GitHub access token from Better Auth account
  const account = await db.prepare(`
    SELECT access_token FROM account
    WHERE user_id = ? AND provider_id = 'github'
  `)
    .bind(session.user.id)
    .first<{ access_token: string }>();

  if (!account?.access_token) {
    throw error(400, 'GitHub account not linked. Please sign in with GitHub first.');
  }

  // Check if GitHub org exists with same name
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat/1.0',
    Authorization: `Bearer ${account.access_token}`,
  };

  const orgResponse = await fetch(`${GITHUB_API_BASE}/orgs/${org.name}`, { headers });

  if (!orgResponse.ok) {
    throw error(400, `GitHub organization '${org.name}' not found`);
  }

  const githubOrg = await orgResponse.json() as {
    id: number;
    login: string;
    avatar_url: string;
  };

  // Check if user is a member of the GitHub org
  const memberResponse = await fetch(
    `${GITHUB_API_BASE}/orgs/${org.name}/members/${session.user.name}`,
    { headers }
  );

  if (memberResponse.status === 404) {
    throw error(403, `You are not a member of the GitHub organization '${org.name}'`);
  }

  if (!memberResponse.ok && memberResponse.status !== 204) {
    throw error(400, 'Failed to verify organization membership');
  }

  // Update organization with verification
  await db.prepare(`
    UPDATE organizations
    SET github_org_id = ?, avatar_url = ?, verified_at = ?, updated_at = ?
    WHERE id = ?
  `)
    .bind(githubOrg.id, githubOrg.avatar_url, Date.now(), Date.now(), org.id)
    .run();

  return json({
    success: true,
    message: 'Organization verified successfully',
    githubOrgId: githubOrg.id,
  });
};
