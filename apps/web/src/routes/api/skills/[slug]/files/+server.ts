import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';
import { getCached } from '$lib/server/cache';
import { githubRequest } from '$lib/server/github-request';

interface SkillFile {
  path: string;
  content: string;
}

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

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

const COMMIT_CACHE_TTL = 300; // 5 minutes cache for commit SHA

// Text file extensions that we should include
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

/**
 * Check if a file is a text file based on extension
 */
function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (!ext || TEXT_EXTENSIONS.has(ext)) return true;
  const fileName = path.split('/').pop()?.toLowerCase() || '';
  if (['dockerfile', 'makefile', 'readme', 'license', 'changelog'].includes(fileName)) return true;
  return false;
}

/**
 * Decode base64 content to UTF-8 string
 */
function decodeBase64ToUtf8(base64: string): string {
  const cleanBase64 = base64.replace(/\n/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Get the latest commit SHA from GitHub repository (with Cache API caching)
 */
async function getLatestCommitSha(
  owner: string,
  repo: string,
  githubToken?: string
): Promise<{ sha: string; branch: string } | null> {
  const { data } = await getCached(
    `commit:${owner}/${repo}`,
    async () => {
      // Get repository info (includes default branch)
      const repoRes = await githubRequest(`https://api.github.com/repos/${owner}/${repo}`, {
        token: githubToken,
        userAgent: 'SkillsCat/1.0',
      });
      if (!repoRes.ok) {
        if (repoRes.status === 404) return null;
        throw new Error(`Failed to fetch repo: ${repoRes.status}`);
      }
      const repoInfo = await repoRes.json() as { default_branch: string };
      const branch = repoInfo.default_branch;

      // Get latest commit
      const commitRes = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
        {
          token: githubToken,
          userAgent: 'SkillsCat/1.0',
        }
      );
      if (!commitRes.ok) return null;
      const commitInfo = await commitRes.json() as { sha: string };

      return { sha: commitInfo.sha, branch };
    },
    COMMIT_CACHE_TTL
  );

  return data;
}

/**
 * Fetch all files from skill directory on GitHub
 */
async function fetchGitHubFiles(
  owner: string,
  repo: string,
  branch: string,
  skillPath: string | null,
  githubToken?: string
): Promise<SkillFile[]> {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const treeRes = await githubRequest(treeUrl, {
    token: githubToken,
    userAgent: 'SkillsCat/1.0',
  });
  if (!treeRes.ok) throw new Error(`Failed to fetch tree: ${treeRes.status}`);
  const treeData = await treeRes.json() as { tree: GitHubTreeItem[] };

  const prefix = skillPath ? `${skillPath}/` : '';
  const files: SkillFile[] = [];

  // Limit number of files to prevent abuse
  const MAX_FILES = 50;
  let fileCount = 0;

  for (const item of treeData.tree) {
    if (fileCount >= MAX_FILES) break;
    if (item.type !== 'blob') continue;

    let relativePath: string;
    if (prefix) {
      if (!item.path.startsWith(prefix)) continue;
      relativePath = item.path.slice(prefix.length);
    } else {
      if (item.path !== 'SKILL.md') continue;
      relativePath = item.path;
    }

    // Skip files larger than 500KB (reduced from 1MB)
    if (item.size && item.size > 512 * 1024) continue;

    if (!isTextFile(relativePath)) continue;

    const blobRes = await githubRequest(
      `https://api.github.com/repos/${owner}/${repo}/git/blobs/${item.sha}`,
      {
        token: githubToken,
        userAgent: 'SkillsCat/1.0',
      }
    );
    if (!blobRes.ok) continue;
    const blobData = await blobRes.json() as { content: string };

    try {
      const content = decodeBase64ToUtf8(blobData.content);
      files.push({ path: relativePath, content });
      fileCount++;
    } catch {
      continue;
    }
  }

  return files;
}

/**
 * Fetch files from R2 storage
 */
async function fetchR2Files(r2: R2Bucket, r2Prefix: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const listed = await r2.list({ prefix: r2Prefix, limit: 50 }); // Limit R2 list

  for (const obj of listed.objects) {
    const relativePath = obj.key.replace(r2Prefix, '');
    if (!relativePath) continue;
    if (!isTextFile(relativePath)) continue;

    // Skip large files
    if (obj.size > 512 * 1024) continue;

    const r2Object = await r2.get(obj.key);
    if (r2Object) {
      const content = await r2Object.text();
      files.push({ path: relativePath, content });
    }
  }

  return files;
}

/**
 * Update R2 cache with new files
 */
async function updateR2Cache(
  r2: R2Bucket,
  r2Prefix: string,
  files: SkillFile[],
  commitSha: string
): Promise<void> {
  for (const file of files) {
    await r2.put(`${r2Prefix}${file.path}`, file.content, {
      httpMetadata: { contentType: 'text/plain' },
      customMetadata: { commitSha, updatedAt: new Date().toISOString() }
    });
  }
}

/**
 * Get cached commit SHA from R2
 */
async function getR2CacheSha(r2: R2Bucket, r2Prefix: string): Promise<string | null> {
  const skillMdKey = `${r2Prefix}SKILL.md`;
  const obj = await r2.head(skillMdKey);
  return obj?.customMetadata?.commitSha || obj?.customMetadata?.sha || null;
}

/**
 * GET /api/skills/[slug]/files - Get all skill files as JSON
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;

  if (!db || !r2) throw error(503, 'Storage not available');

  const { slug } = params;
  if (!slug) throw error(400, 'Skill slug is required');

  // Validate slug format to prevent injection
  if (!/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(slug)) {
    throw error(400, 'Invalid skill slug format');
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

  const files: SkillFile[] = [];
  const folderName = skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();

  // Build R2 prefix path
  let r2Prefix: string;
  if (skill.source_type === 'upload') {
    const parts = slug.split('/');
    r2Prefix = parts.length >= 2
      ? `skills/${parts[0]}/${parts[1]}/`
      : `skills/${slug}/`;
  } else {
    const pathPart = skill.skill_path ? `/${skill.skill_path}` : '';
    r2Prefix = `skills/${skill.repo_owner}/${skill.repo_name}${pathPart}/`;
  }

  // Public GitHub skills: check for updates
  if (skill.source_type === 'github' && skill.visibility === 'public' && skill.repo_owner && skill.repo_name) {
    try {
      // Get latest commit SHA (with KV caching to reduce GitHub API calls)
      const latestCommit = await getLatestCommitSha(
        skill.repo_owner,
        skill.repo_name,
        githubToken
      );

      if (!latestCommit) {
        throw error(404, 'Repository not found - it may have been deleted');
      }

      // Get cached commit SHA from R2
      const cachedSha = await getR2CacheSha(r2, r2Prefix);

      if (cachedSha === latestCommit.sha) {
        // Cache is up to date, fetch from R2
        const r2Files = await fetchR2Files(r2, r2Prefix);
        files.push(...r2Files);
      } else {
        // Cache is stale, fetch from GitHub and update cache
        const githubFiles = await fetchGitHubFiles(
          skill.repo_owner,
          skill.repo_name,
          latestCommit.branch,
          skill.skill_path,
          githubToken
        );

        if (githubFiles.length > 0) {
          // Update R2 cache
          await updateR2Cache(r2, r2Prefix, githubFiles, latestCommit.sha);
          files.push(...githubFiles);
        } else {
          // GitHub returned no files, try R2 cache as fallback
          const r2Files = await fetchR2Files(r2, r2Prefix);
          files.push(...r2Files);
        }
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err.status === 404 || err.status === 429)) {
        throw err;
      }
      console.error('GitHub fetch failed, falling back to R2:', err);
      const r2Files = await fetchR2Files(r2, r2Prefix);
      files.push(...r2Files);
    }
  } else {
    // Private/Uploaded skills: fetch directly from R2
    const r2Files = await fetchR2Files(r2, r2Prefix);
    files.push(...r2Files);
  }

  // Fallback to readme from database
  if (files.length === 0 && skill.readme) {
    files.push({ path: 'SKILL.md', content: skill.readme });
  }

  if (files.length === 0) {
    throw error(404, 'Skill files not found');
  }

  // Track download in D1 to avoid high-cost KV write amplification.
  try {
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, NULL, ?, 'download', ?)
    `)
      .bind(crypto.randomUUID(), skill.id, Date.now())
      .run();
  } catch { /* non-critical */ }

  return json({ folderName, files }, {
    headers: {
      'Cache-Control': skill.visibility === 'private' ? 'private, no-cache' : 'public, max-age=300',
    }
  });
};
