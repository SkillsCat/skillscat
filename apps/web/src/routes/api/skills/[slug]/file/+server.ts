import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';

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

// Rate limit configuration
const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX_REQUESTS = 30; // Higher limit for single file requests

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

async function checkRateLimit(kv: KVNamespace, clientIp: string): Promise<boolean> {
  const key = `ratelimit:file:${clientIp}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW;

  try {
    const data = await kv.get(key, 'json') as { requests: number[] } | null;
    const requests = data?.requests || [];
    const recentRequests = requests.filter(t => t > windowStart);

    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    recentRequests.push(now);
    await kv.put(key, JSON.stringify({ requests: recentRequests }), {
      expirationTtl: RATE_LIMIT_WINDOW * 2
    });

    return true;
  } catch {
    return true;
  }
}

/**
 * GET /api/skills/[slug]/file?path=xxx - Get single file content
 */
export const GET: RequestHandler = async ({ params, platform, request, url, locals }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const kv = platform?.env?.KV;
  const githubToken = platform?.env?.GITHUB_TOKEN;

  if (!db || !r2) throw error(503, 'Storage not available');

  const clientIp = request.headers.get('cf-connecting-ip') ||
                   request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   'unknown';

  if (kv && clientIp !== 'unknown') {
    const allowed = await checkRateLimit(kv, clientIp);
    if (!allowed) {
      throw error(429, 'Too many requests. Please try again later.');
    }
  }

  const { slug } = params;
  const filePath = url.searchParams.get('path');

  if (!slug) throw error(400, 'Skill slug is required');
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
    const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
    if (!hasAccess) {
      throw error(403, 'You do not have permission to access this skill');
    }
  }

  const cacheControl = skill.visibility === 'private' ? 'private, no-cache' : 'public, max-age=300';

  // Build R2 key
  let r2Key: string;
  let r2Keys: string[];
  if (skill.source_type === 'upload') {
    const parts = slug.split('/');
    r2Keys = parts.length >= 2
      ? [`skills/${parts[0]}/${parts[1]}/${filePath}`]
      : [`skills/${slug}/${filePath}`];
    if (parts.length >= 1) {
      const legacyKey = `skills/${parts[0]}/${skill.name}/${filePath}`;
      if (!r2Keys.includes(legacyKey)) {
        r2Keys.push(legacyKey);
      }
    }
    r2Key = r2Keys[0];
  } else {
    const pathPart = skill.skill_path ? `/${skill.skill_path}` : '';
    r2Key = `skills/${skill.repo_owner}/${skill.repo_name}${pathPart}/${filePath}`;
    r2Keys = [r2Key];
  }

  // Try R2 first
  for (const key of r2Keys) {
    const r2Object = await r2.get(key);
    if (r2Object) {
      const content = await r2Object.text();
      return json({ path: filePath, content }, {
        headers: { 'Cache-Control': cacheControl }
      });
    }
  }

  // For GitHub skills, try fetching from GitHub directly
  if (skill.source_type === 'github' && skill.visibility === 'public' && skill.repo_owner && skill.repo_name) {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SkillsCat'
      };
      if (githubToken) {
        headers['Authorization'] = `Bearer ${githubToken}`;
      }

      const fullPath = skill.skill_path ? `${skill.skill_path}/${filePath}` : filePath;
      const contentUrl = `https://api.github.com/repos/${skill.repo_owner}/${skill.repo_name}/contents/${fullPath}`;

      const res = await fetch(contentUrl, { headers });
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
