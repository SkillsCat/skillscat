import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/auth/permissions';
import { githubRequest } from '$lib/server/github-client/request';
import { buildGithubSkillR2Key, buildGithubSkillR2Keys, buildUploadSkillR2Key, normalizeSkillSlug } from '$lib/skill-path';

interface SkillInfo {
  id: string;
  name: string;
  slug: string;
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
  readme: string | null;
  visibility: string;
}

const CLIENT_GITHUB_RATE_LIMIT_HEADER = 'x-skillscat-client-github-rate-limited';

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp',
  'html', 'css', 'scss', 'less', 'sass',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'xml', 'svg', 'sql', 'graphql', 'gql',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'svelte', 'vue', 'astro'
]);

function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (!ext || TEXT_EXTENSIONS.has(ext)) return true;
  const fileName = path.split('/').pop()?.toLowerCase() || '';
  if (['dockerfile', 'makefile', 'readme', 'license', 'changelog'].includes(fileName)) return true;
  return false;
}

function decodeBase64ToUtf8(base64: string): string {
  const cleanBase64 = base64.replace(/\n/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function recordClientGitHubRateLimited(db: D1Database, skillId: string): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, NULL, ?, 'github_client_rate_limited', ?)
    `)
      .bind(crypto.randomUUID(), skillId, Date.now())
      .run();
  } catch {
    // non-critical telemetry
  }
}

/**
 * GET /api/skills/[slug]/file?path=xxx - Get single file content
 */
export const GET: RequestHandler = async ({ params, platform, request, url, locals }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;

  if (!db || !r2) throw error(503, 'Storage not available');

  const slug = normalizeSkillSlug(params.slug || '');
  const filePath = url.searchParams.get('path');

  if (!slug) throw error(400, 'Invalid skill slug');
  if (!filePath) throw error(400, 'File path is required');

  // Validate slug and path format
  if (!/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(slug)) {
    throw error(400, 'Invalid skill slug format');
  }

  // Prevent path traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    throw error(400, 'Invalid file path');
  }

  if (!isTextFile(filePath)) {
    throw error(400, 'File type not supported');
  }

  const skill = await db.prepare(`
    SELECT id, name, slug, source_type, repo_owner, repo_name, skill_path, readme, visibility
    FROM skills WHERE slug = ?
  `).bind(slug).first<SkillInfo>();

  if (!skill) throw error(404, 'Skill not found');

  if (skill.visibility === 'private') {
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId) {
      throw error(401, 'Authentication required');
    }
    requireScope(auth, 'read');
    const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
    if (!hasAccess) {
      throw error(403, 'You do not have permission to access this skill');
    }
  }

  if (request.headers.get(CLIENT_GITHUB_RATE_LIMIT_HEADER) === '1') {
    await recordClientGitHubRateLimited(db, skill.id);
  }

  const cacheControl = skill.visibility === 'private' ? 'private, no-cache' : 'public, max-age=300';

  // Build canonical R2 key
  let r2Key: string;
  let candidateR2Keys: string[];
  if (skill.source_type === 'upload') {
    const uploadKey = buildUploadSkillR2Key(skill.slug, filePath);
    if (!uploadKey) {
      throw error(500, 'Invalid upload skill path');
    }
    r2Key = uploadKey;
    candidateR2Keys = [uploadKey];
  } else {
    if (!skill.repo_owner || !skill.repo_name) {
      throw error(500, 'Invalid GitHub skill path');
    }
    r2Key = buildGithubSkillR2Key(skill.repo_owner, skill.repo_name, skill.skill_path, filePath);
    candidateR2Keys = buildGithubSkillR2Keys(skill.repo_owner, skill.repo_name, skill.skill_path, filePath);
  }

  // Try R2 first
  for (const candidateKey of candidateR2Keys) {
    const r2Object = await r2.get(candidateKey);
    if (!r2Object) continue;

    const content = await r2Object.text();
    return json({ path: filePath, content }, {
      headers: { 'Cache-Control': cacheControl }
    });
  }

  // For GitHub skills, try fetching from GitHub directly
  if (skill.source_type === 'github' && skill.visibility === 'public' && skill.repo_owner && skill.repo_name) {
    try {
      const fullPath = skill.skill_path ? `${skill.skill_path}/${filePath}` : filePath;
      const contentUrl = `https://api.github.com/repos/${skill.repo_owner}/${skill.repo_name}/contents/${fullPath}`;

      const res = await githubRequest(contentUrl, {
        token: githubToken,
        userAgent: 'SkillsCat/1.0',
      });
      if (res.ok) {
        const data = await res.json() as { content: string; size: number };

        // Check file size (max 500KB)
        if (data.size > 512 * 1024) {
          throw error(400, 'File too large');
        }

        const content = decodeBase64ToUtf8(data.content);

        // Cache to R2 for future requests
        await r2.put(r2Key, content, {
          httpMetadata: { contentType: 'text/plain' }
        });

        return json({ path: filePath, content }, {
          headers: { 'Cache-Control': cacheControl }
        });
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) {
        throw err;
      }
      console.error('GitHub fetch failed:', err);
    }
  }

  // Special case: SKILL.md might be in database
  if (filePath === 'SKILL.md' && skill.readme) {
    return json({ path: filePath, content: skill.readme }, {
      headers: { 'Cache-Control': cacheControl }
    });
  }

  throw error(404, 'File not found');
};
