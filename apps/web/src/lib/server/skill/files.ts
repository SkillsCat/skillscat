import { error } from '@sveltejs/kit';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/auth/permissions';
import { getCached } from '$lib/server/cache';
import { getBlob, getCommitByRef, getRepo, getTreeRecursive } from '$lib/server/github-client/rest';
import {
  buildGithubSkillR2Prefix,
  buildGithubSkillR2Prefixes,
  buildUploadSkillR2Prefix,
  normalizeSkillSlug,
} from '$lib/skill-path';
import {
  buildBundleExpectationFromRawFileStructure,
  chooseBestR2Bundle,
} from '$lib/server/skill/r2-bundle';
import { resolveSkillRelativePath } from '$lib/server/skill/scope';

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillFilesResult {
  folderName: string;
  files: SkillFile[];
}

export interface SkillFilesInput {
  slug: string;
}

export interface ResolvedSkillFiles {
  data: SkillFilesResult;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
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
  last_commit_at: number | null;
  indexed_at: number | null;
  updated_at: number | null;
  file_structure: string | null;
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

interface CachedPublicSkillFiles {
  result: SkillFilesResult;
}

const COMMIT_CACHE_TTL = 300;
const PUBLIC_CACHE_TTL_SECONDS = 300;
const STALE_SKILL_REFRESH_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_SKILL_COMMIT_CACHE_TTL_SECONDS = 6 * 60 * 60;
type WaitUntilFn = (promise: Promise<unknown>) => void;

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

function getSkillFreshnessTimestamp(skill: SkillInfo): number {
  return skill.last_commit_at || skill.indexed_at || skill.updated_at || 0;
}

function shouldRunRealtimeRefresh(skill: SkillInfo, hasR2Files: boolean): boolean {
  if (!hasR2Files) return true;
  const freshnessTs = getSkillFreshnessTimestamp(skill);
  if (!freshnessTs) return true;
  return Date.now() - freshnessTs >= STALE_SKILL_REFRESH_AFTER_MS;
}

export function parseSkillFilesInput(input: Record<string, unknown>): SkillFilesInput | null {
  const slug = normalizeSkillSlug(String(input.slug ?? ''));
  if (!slug) return null;
  if (!/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(slug)) return null;
  return { slug };
}

class PublicSkillFilesCacheBypass extends Error {
  reason: 'not_found' | 'private' | 'unlisted';
  skill: SkillInfo | null;

  constructor(reason: 'not_found' | 'private' | 'unlisted', skill: SkillInfo | null = null) {
    super(reason);
    this.reason = reason;
    this.skill = skill;
  }
}

async function getLatestCommitSha(
  owner: string,
  repo: string,
  githubToken?: string,
  githubRateLimitKV?: KVNamespace,
  options: { cacheTtlSeconds?: number; cacheKeySuffix?: string } = {}
): Promise<{ sha: string; branch: string } | null> {
  const cacheTtlSeconds = options.cacheTtlSeconds ?? COMMIT_CACHE_TTL;
  const cacheKeySuffix = options.cacheKeySuffix ?? 'default';
  const { data } = await getCached(
    `commit:${owner}/${repo}:${cacheKeySuffix}`,
    async () => {
      const repoRes = await getRepo(owner, repo, {
        token: githubToken,
        rateLimitKV: githubRateLimitKV,
        userAgent: 'SkillsCat/1.0',
      });
      if (!repoRes.ok) {
        if (repoRes.status === 404) return null;
        throw new Error(`Failed to fetch repo: ${repoRes.status}`);
      }
      const repoInfo = await repoRes.json() as { default_branch: string };
      const branch = repoInfo.default_branch;

      const commitRes = await getCommitByRef(owner, repo, branch, {
        token: githubToken,
        rateLimitKV: githubRateLimitKV,
        userAgent: 'SkillsCat/1.0',
      });
      if (!commitRes.ok) return null;
      const commitInfo = await commitRes.json() as { sha: string };

      return { sha: commitInfo.sha, branch };
    },
    cacheTtlSeconds
  );

  return data;
}

async function fetchGitHubFiles(
  owner: string,
  repo: string,
  branch: string,
  skillPath: string | null,
  githubToken?: string,
  githubRateLimitKV?: KVNamespace
): Promise<SkillFile[]> {
  const treeRes = await getTreeRecursive(owner, repo, branch, {
    token: githubToken,
    rateLimitKV: githubRateLimitKV,
    userAgent: 'SkillsCat/1.0',
  });
  if (!treeRes.ok) throw new Error(`Failed to fetch tree: ${treeRes.status}`);
  const treeData = await treeRes.json() as { tree: GitHubTreeItem[] };

  const files: SkillFile[] = [];

  const MAX_FILES = 50;
  let fileCount = 0;

  for (const item of treeData.tree) {
    if (fileCount >= MAX_FILES) break;
    if (item.type !== 'blob') continue;

    const relativePath = resolveSkillRelativePath(item.path, skillPath);
    if (!relativePath) continue;

    if (item.size && item.size > 512 * 1024) continue;
    if (!isTextFile(relativePath)) continue;

    const blobRes = await getBlob(owner, repo, item.sha, {
      token: githubToken,
      rateLimitKV: githubRateLimitKV,
      userAgent: 'SkillsCat/1.0',
    });
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

async function fetchR2Files(r2: R2Bucket, r2Prefix: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const listed = await r2.list({ prefix: r2Prefix, limit: 50 });

  for (const obj of listed.objects) {
    const relativePath = obj.key.replace(r2Prefix, '');
    if (!relativePath) continue;
    if (!isTextFile(relativePath)) continue;
    if (obj.size > 512 * 1024) continue;

    const r2Object = await r2.get(obj.key);
    if (r2Object) {
      const content = await r2Object.text();
      files.push({ path: relativePath, content });
    }
  }

  return files;
}

async function fetchR2FilesFromPrefixes(
  r2: R2Bucket,
  prefixes: string[],
  fileStructureRaw: string | null
): Promise<{ files: SkillFile[]; complete: boolean }> {
  const candidates: Array<{ files: SkillFile[]; index: number }> = [];

  for (const [index, prefix] of prefixes.entries()) {
    if (!prefix) continue;
    const files = await fetchR2Files(r2, prefix);
    if (files.length === 0) continue;
    candidates.push({ files, index });
  }

  return chooseBestR2Bundle(candidates, buildBundleExpectationFromRawFileStructure(fileStructureRaw));
}

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

async function getR2CacheSha(r2: R2Bucket, r2Prefixes: string[]): Promise<string | null> {
  for (const r2Prefix of r2Prefixes) {
    if (!r2Prefix) continue;
    const skillMdKey = `${r2Prefix}SKILL.md`;
    const obj = await r2.head(skillMdKey);
    const commitSha = obj?.customMetadata?.commitSha || obj?.customMetadata?.sha || null;
    if (commitSha) {
      return commitSha;
    }
  }

  return null;
}

async function fetchSkillInfo(db: D1Database, slug: string): Promise<SkillInfo | null> {
  return db.prepare(`
    SELECT id, name, slug, source_type, repo_owner, repo_name, skill_path, readme, visibility,
           last_commit_at, indexed_at, updated_at, file_structure
    FROM skills WHERE slug = ?
  `).bind(slug).first<SkillInfo>();
}

async function buildSkillFilesData(
  {
    skill,
    r2,
    githubToken,
    githubRateLimitKV,
  }: {
    skill: SkillInfo;
    r2: R2Bucket;
    githubToken?: string;
    githubRateLimitKV?: KVNamespace;
  }
): Promise<SkillFilesResult> {
  const files: SkillFile[] = [];
  const folderName = skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();

  let r2Prefix: string;
  let r2Prefixes: string[];
  if (skill.source_type === 'upload') {
    const uploadPrefix = buildUploadSkillR2Prefix(skill.slug);
    if (!uploadPrefix) {
      throw error(500, 'Invalid upload skill path');
    }
    r2Prefix = uploadPrefix;
    r2Prefixes = [uploadPrefix];
  } else {
    if (!skill.repo_owner || !skill.repo_name) {
      throw error(500, 'Invalid GitHub skill path');
    }
    r2Prefix = buildGithubSkillR2Prefix(skill.repo_owner, skill.repo_name, skill.skill_path);
    r2Prefixes = buildGithubSkillR2Prefixes(skill.repo_owner, skill.repo_name, skill.skill_path);
  }

  if (skill.source_type === 'github' && skill.visibility === 'public' && skill.repo_owner && skill.repo_name) {
    const { files: r2Files, complete: hasCompleteR2Bundle } = await fetchR2FilesFromPrefixes(
      r2,
      r2Prefixes,
      skill.file_structure
    );
    const hasR2Files = r2Files.length > 0;
    const shouldRealtimeRefresh = !hasCompleteR2Bundle || shouldRunRealtimeRefresh(skill, hasR2Files);

    if (!shouldRealtimeRefresh) {
      files.push(...r2Files);
    } else {
      try {
        const commitCacheTtl = hasR2Files ? STALE_SKILL_COMMIT_CACHE_TTL_SECONDS : COMMIT_CACHE_TTL;
        const latestCommit = await getLatestCommitSha(
          skill.repo_owner,
          skill.repo_name,
          githubToken,
          githubRateLimitKV,
          {
            cacheTtlSeconds: commitCacheTtl,
            cacheKeySuffix: hasR2Files ? 'stale' : 'default'
          }
        );

        if (!latestCommit) {
          throw error(404, 'Repository not found - it may have been deleted');
        }

        const cachedSha = await getR2CacheSha(r2, r2Prefixes);

        if (cachedSha === latestCommit.sha && hasR2Files && hasCompleteR2Bundle) {
          files.push(...r2Files);
        } else {
          const githubFiles = await fetchGitHubFiles(
            skill.repo_owner,
            skill.repo_name,
            latestCommit.branch,
            skill.skill_path,
            githubToken,
            githubRateLimitKV
          );

          if (githubFiles.length > 0) {
            await updateR2Cache(r2, r2Prefix, githubFiles, latestCommit.sha);
            files.push(...githubFiles);
          } else {
            files.push(...r2Files);
          }
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'status' in err && (err.status === 404 || err.status === 429)) {
          throw err;
        }
        console.error('GitHub fetch failed, falling back to R2:', err);
        files.push(...r2Files);
      }
    }
  } else {
    const { files: r2Files } = await fetchR2FilesFromPrefixes(r2, r2Prefixes, skill.file_structure);
    files.push(...r2Files);
  }

  if (files.length === 0 && skill.readme) {
    files.push({ path: 'SKILL.md', content: skill.readme });
  }

  if (files.length === 0) {
    throw error(404, 'Skill files not found');
  }

  return { folderName, files };
}

export async function resolveSkillFiles(
  {
    db,
    r2,
    githubToken,
    githubRateLimitKV,
    request,
    locals,
    waitUntil,
  }: {
    db: D1Database | undefined;
    r2: R2Bucket | undefined;
    githubToken?: string;
    githubRateLimitKV?: KVNamespace;
    request: Request;
    locals: App.Locals;
    waitUntil?: WaitUntilFn;
  },
  input: SkillFilesInput
): Promise<ResolvedSkillFiles> {
  if (!db || !r2) {
    throw error(503, 'Storage not available');
  }

  let cachedPublic: CachedPublicSkillFiles | null = null;
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';
  let bypassSkill: SkillInfo | null = null;

  try {
    const cached = await getCached(
      `api:skill-files:${input.slug}`,
      async () => {
        const skill = await fetchSkillInfo(db, input.slug);
        if (!skill) {
          throw new PublicSkillFilesCacheBypass('not_found');
        }
        if (skill.visibility !== 'public') {
          throw new PublicSkillFilesCacheBypass(skill.visibility as 'private' | 'unlisted', skill);
        }

        return {
          result: await buildSkillFilesData({ skill, r2, githubToken, githubRateLimitKV }),
        };
      },
      PUBLIC_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    cachedPublic = cached.data;
    cacheStatus = cached.hit ? 'HIT' : 'MISS';
  } catch (err) {
    if (err instanceof PublicSkillFilesCacheBypass) {
      bypassSkill = err.skill;
    } else {
      throw err;
    }
  }

  if (cachedPublic) {
    return {
      data: cachedPublic.result,
      cacheControl: `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
      cacheStatus,
    };
  }

  if (!bypassSkill) {
    throw error(404, 'Skill not found');
  }

  if (bypassSkill.visibility === 'private') {
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId) {
      throw error(401, 'Authentication required');
    }
    requireScope(auth, 'read');
    const hasAccess = await checkSkillAccess(bypassSkill.id, auth.userId, db);
    if (!hasAccess) {
      throw error(403, 'You do not have permission to access this skill');
    }
  }

  const result = await buildSkillFilesData({ skill: bypassSkill, r2, githubToken, githubRateLimitKV });

  return {
    data: result,
    cacheControl: 'private, no-cache',
    cacheStatus: 'BYPASS',
  };
}
