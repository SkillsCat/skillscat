import { posix as pathPosix } from 'node:path';
import type { RepoSource, SkillCompanionFile, SkillInfo } from './source';
import { SKILL_DISCOVERY_PATHS, parseSkillFrontmatter } from './source';
import { calculateContentHash } from '../storage/cache';
import { cacheGitHubBlob, cacheGitHubTree, getCachedGitHubBlob, getCachedGitHubTree } from '../storage/github-cache';
import { githubRequest } from '../core/github-request';

const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';
const GITLAB_API = 'https://gitlab.com/api/v4';
const MAX_GITHUB_SYMLINK_DEPTH = 8;

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  mode?: string;
}

interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
}

interface GitHubBlob {
  content?: string;
  encoding?: string;
}

interface GitLabFile {
  file_name: string;
  file_path: string;
  content?: string;
  encoding?: string;
  last_commit_id?: string;
}

interface GitHubRepoInfo {
  default_branch: string;
  private?: boolean;
}

export interface GitHubRepoSnapshot {
  matches(source: RepoSource): boolean;
  getBranch(): Promise<string>;
  getTree(): Promise<GitHubTreeItem[]>;
  getPathMap(): Promise<Map<string, GitHubTreeItem>>;
  getTreeItem(path: string): Promise<GitHubTreeItem | null>;
  getBlobBytesBySha(sha: string): Promise<Buffer>;
  getFileBytes(path: string, item?: GitHubTreeItem): Promise<Buffer>;
  getFileText(path: string, item?: GitHubTreeItem): Promise<string>;
}

class CachedGitHubRepoSnapshot implements GitHubRepoSnapshot {
  private readonly explicitBranch?: string;
  private repoInfoPromise?: Promise<GitHubRepoInfo>;
  private branchPromise?: Promise<string>;
  private treePromise?: Promise<GitHubTreeItem[]>;
  private pathMapPromise?: Promise<Map<string, GitHubTreeItem>>;
  private readonly blobBytesBySha = new Map<string, Promise<Buffer>>();
  private readonly fileBytesByPath = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    branch?: string
  ) {
    this.explicitBranch = branch;
  }

  matches(source: RepoSource): boolean {
    return source.platform === 'github'
      && source.owner === this.owner
      && source.repo === this.repo
      && source.branch === this.explicitBranch;
  }

  getBranch(): Promise<string> {
    if (!this.branchPromise) {
      this.branchPromise = this.explicitBranch
        ? Promise.resolve(this.explicitBranch)
        : this.getRepoInfo().then(info => info.default_branch);
    }
    return this.branchPromise;
  }

  getTree(): Promise<GitHubTreeItem[]> {
    if (!this.treePromise) {
      this.treePromise = this.getBranch().then(branch => fetchGitHubTree(this.owner, this.repo, branch));
    }
    return this.treePromise;
  }

  getPathMap(): Promise<Map<string, GitHubTreeItem>> {
    if (!this.pathMapPromise) {
      this.pathMapPromise = this.getTree().then((tree) => {
        const map = new Map<string, GitHubTreeItem>();
        for (const item of tree) {
          map.set(normalizeRepoPath(item.path), item);
        }
        return map;
      });
    }
    return this.pathMapPromise;
  }

  async getTreeItem(path: string): Promise<GitHubTreeItem | null> {
    const pathMap = await this.getPathMap();
    return pathMap.get(normalizeRepoPath(path)) ?? null;
  }

  getBlobBytesBySha(sha: string): Promise<Buffer> {
    return getOrCreate(this.blobBytesBySha, sha, () => fetchGitHubBlobBytesBySha(this.owner, this.repo, sha));
  }

  getFileBytes(path: string, item?: GitHubTreeItem): Promise<Buffer> {
    const normalizedPath = normalizeRepoPath(path);
    const cacheKey = item?.sha ? `sha:${item.sha}` : `path:${normalizedPath}`;

    return getOrCreate(this.fileBytesByPath, cacheKey, async () => {
      if (item?.sha && item.mode !== '120000') {
        try {
          return await this.getBlobBytesBySha(item.sha);
        } catch {
          const branch = await this.getBranch();
          const file = await fetchGitHubFileBytes(this.owner, this.repo, normalizedPath, branch);
          if (file.sha && file.sha !== item.sha) {
            throw new Error(`GitHub file changed during fetch: ${normalizedPath}`);
          }
          return file.bytes;
        }
      }

      const content = await fetchGitHubFileBytes(this.owner, this.repo, normalizedPath, await this.getBranch());
      return content.bytes;
    });
  }

  async getFileText(path: string, item?: GitHubTreeItem): Promise<string> {
    const bytes = await this.getFileBytes(path, item);
    return bytes.toString('utf-8');
  }

  private getRepoInfo(): Promise<GitHubRepoInfo> {
    if (!this.repoInfoPromise) {
      this.repoInfoPromise = fetchGitHubRepoInfo(this.owner, this.repo);
    }
    return this.repoInfoPromise;
  }
}

function getOrCreate<K, V>(map: Map<K, Promise<V>>, key: K, factory: () => Promise<V>): Promise<V> {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created = factory().catch((err) => {
    map.delete(key);
    throw err;
  });
  map.set(key, created);
  return created;
}

export function createGitHubRepoSnapshot(source: RepoSource): GitHubRepoSnapshot | null {
  if (source.platform !== 'github') {
    return null;
  }
  return new CachedGitHubRepoSnapshot(source.owner, source.repo, source.branch);
}

function getMatchingGitHubSnapshot(source: RepoSource, snapshot?: GitHubRepoSnapshot | null): GitHubRepoSnapshot | null {
  if (!snapshot) return null;
  return snapshot.matches(source) ? snapshot : null;
}

/**
 * Get default branch for a GitHub repo
 */
async function getGitHubDefaultBranch(owner: string, repo: string): Promise<string> {
  const info = await fetchGitHubRepoInfo(owner, repo);
  return info.default_branch;
}

async function fetchGitHubRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
  const response = await githubRequest(`${GITHUB_API}/repos/${owner}/${repo}`, {
    userAgent: 'skillscat-cli/1.0',
  });

  if (!response.ok) {
    throw new Error(`Repository not found: ${owner}/${repo}`);
  }

  return await response.json() as GitHubRepoInfo;
}

/**
 * Get default branch for a GitLab repo
 */
async function getGitLabDefaultBranch(owner: string, repo: string): Promise<string> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const response = await fetch(`${GITLAB_API}/projects/${projectPath}`, {
    headers: { 'User-Agent': 'skillscat-cli/1.0' }
  });

  if (!response.ok) {
    throw new Error(`Repository not found: ${owner}/${repo}`);
  }

  const data = await response.json() as { default_branch: string };
  return data.default_branch;
}

/**
 * Fetch repository tree from GitHub
 */
async function fetchGitHubTree(owner: string, repo: string, branch: string): Promise<GitHubTreeItem[]> {
  const cachedTree = getCachedGitHubTree(owner, repo, branch);
  if (cachedTree) {
    return cachedTree as GitHubTreeItem[];
  }

  const response = await githubRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      userAgent: 'skillscat-cli/1.0',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch repository tree`);
  }

  const data = await response.json() as { tree: GitHubTreeItem[]; truncated?: boolean };
  if (data.truncated) {
    throw new Error(
      `Repository tree is too large to inspect via GitHub API (truncated response): ${owner}/${repo}. ` +
      'Try installing a specific path instead.'
    );
  }
  cacheGitHubTree(owner, repo, branch, data.tree);
  return data.tree;
}

async function fetchGitHubBlobBytesBySha(owner: string, repo: string, sha: string): Promise<Buffer> {
  const cachedBlob = getCachedGitHubBlob(sha);
  if (cachedBlob) {
    return cachedBlob;
  }

  const response = await githubRequest(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${sha}`, {
    userAgent: 'skillscat-cli/1.0',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch blob: ${sha}`);
  }

  const data = await response.json() as GitHubBlob;
  if (data.encoding !== 'base64' || !data.content) {
    throw new Error(`Unexpected blob encoding for ${sha}`);
  }

  const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
  cacheGitHubBlob(sha, decoded);
  return decoded;
}

/**
 * Fetch file content from GitHub
 */
async function fetchGitHubFile(owner: string, repo: string, path: string, ref?: string): Promise<string> {
  const data = await fetchGitHubFileContent(owner, repo, path, ref);
  return data.content;
}

async function fetchGitHubFileBytes(
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ bytes: Buffer; sha?: string }> {
  const url = ref
    ? `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
    : `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const response = await githubRequest(url, {
    userAgent: 'skillscat-cli/1.0',
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File not found: ${path}`);
    }
    throw new Error(`Failed to fetch file from GitHub (${response.status}): ${path}`);
  }

  const data = await response.json() as GitHubContent;
  const contentType = data.type ?? 'file';
  if (contentType !== 'file' && contentType !== 'symlink') {
    throw new Error(`Unexpected GitHub content type for ${path}: ${String(data.type)}`);
  }
  if (data.encoding !== 'base64' || !data.content) {
    throw new Error(`Unexpected file encoding: ${data.encoding}`);
  }

  return {
    bytes: Buffer.from(data.content.replace(/\n/g, ''), 'base64'),
    sha: data.sha,
  };
}

async function fetchGitHubFileContent(
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ content: string; sha?: string }> {
  const file = await fetchGitHubFileBytes(owner, repo, path, ref);
  return {
    content: file.bytes.toString('utf-8'),
    sha: file.sha,
  };
}

function buildGitHubRawUrl(owner: string, repo: string, ref: string, path: string): string {
  const encodedRef = encodeURIComponent(ref);
  const encodedPath = normalizeRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `${GITHUB_RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodedRef}/${encodedPath}`;
}

async function tryFetchGitHubRawFileBytes(
  owner: string,
  repo: string,
  ref: string,
  path: string
): Promise<Buffer | null> {
  if (!ref) return null;

  try {
    const response = await githubRequest(buildGitHubRawUrl(owner, repo, ref, path), {
      userAgent: 'skillscat-cli/1.0',
      headers: { Accept: '*/*' },
      maxRetries: 1,
      retryableStatuses: [408, 429, 500, 502, 503, 504],
    });

    if (!response.ok) {
      return null;
    }

    return await readResponseBytes(response);
  } catch {
    return null;
  }
}

async function readResponseBytes(response: Response): Promise<Buffer> {
  const maybeArrayBuffer = (response as Response & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof maybeArrayBuffer === 'function') {
    return Buffer.from(await maybeArrayBuffer.call(response));
  }

  const maybeText = (response as Response & { text?: () => Promise<string> }).text;
  if (typeof maybeText === 'function') {
    return Buffer.from(await maybeText.call(response), 'utf-8');
  }

  throw new Error('Response body reader is unavailable');
}

/**
 * Fetch file content from GitLab
 */
async function fetchGitLabFile(owner: string, repo: string, path: string, ref?: string): Promise<string> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const filePath = encodeURIComponent(path);
  const branch = ref || 'main';

  const response = await fetch(
    `${GITLAB_API}/projects/${projectPath}/repository/files/${filePath}?ref=${branch}`,
    {
      headers: { 'User-Agent': 'skillscat-cli/1.0' }
    }
  );

  if (!response.ok) {
    // Try master branch
    const masterResponse = await fetch(
      `${GITLAB_API}/projects/${projectPath}/repository/files/${filePath}?ref=master`,
      {
        headers: { 'User-Agent': 'skillscat-cli/1.0' }
      }
    );

    if (!masterResponse.ok) {
      throw new Error(`File not found: ${path}`);
    }

    const data = await masterResponse.json() as GitLabFile;
    if (data.encoding === 'base64' && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    throw new Error(`Unexpected file encoding`);
  }

  const data = await response.json() as GitLabFile;

  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  throw new Error(`Unexpected file encoding`);
}

/**
 * Fetch repository tree from GitLab
 */
async function fetchGitLabTree(owner: string, repo: string, branch: string): Promise<{ path: string; type: string }[]> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const items: { path: string; type: string }[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${GITLAB_API}/projects/${projectPath}/repository/tree?ref=${branch}&recursive=true&per_page=100&page=${page}`,
      {
        headers: { 'User-Agent': 'skillscat-cli/1.0' }
      }
    );

    if (!response.ok) break;

    const data = await response.json() as { path: string; type: string }[];
    if (data.length === 0) break;

    items.push(...data);
    page++;

    if (data.length < 100) break;
  }

  return items;
}

/**
 * Discover skills in a repository
 */
export async function discoverSkills(
  source: RepoSource,
  options?: { githubSnapshot?: GitHubRepoSnapshot | null }
): Promise<SkillInfo[]> {
  const { platform, owner, repo, branch: sourceBranch, path: sourcePath } = source;
  const skills: SkillInfo[] = [];
  const matchedSnapshot = platform === 'github'
    ? getMatchingGitHubSnapshot(source, options?.githubSnapshot)
    : null;
  const githubSnapshot = platform === 'github'
    ? (matchedSnapshot ?? (!sourcePath ? createGitHubRepoSnapshot(source) : null))
    : null;

  try {
    // Get default branch if not specified
    const branch = sourceBranch || (
      platform === 'github'
        ? await (githubSnapshot?.getBranch() ?? getGitHubDefaultBranch(owner, repo))
        : await getGitLabDefaultBranch(owner, repo)
    );

    // If a specific path is provided, check only that path
    if (sourcePath) {
      const skillPath = sourcePath.endsWith('SKILL.md') ? sourcePath : `${sourcePath}/SKILL.md`;
      try {
        let content: string;
        let sha: string | undefined;
        if (platform === 'github') {
          const treeItem = await githubSnapshot?.getTreeItem(skillPath) ?? null;
          if (treeItem?.type === 'blob') {
            content = await githubSnapshot!.getFileText(skillPath, treeItem);
            sha = treeItem.sha || undefined;
          } else {
            const file = await fetchGitHubFileContent(owner, repo, skillPath, branch);
            content = file.content;
            sha = file.sha || undefined;
          }
        } else {
          content = await fetchGitLabFile(owner, repo, skillPath, branch);
        }

        const metadata = parseSkillFrontmatter(content);
        if (metadata) {
          skills.push({
            name: metadata.name,
            description: metadata.description,
            path: skillPath,
            content,
            sha,
            contentHash: calculateContentHash(content)
          });
        }
      } catch (err) {
        if (isSourcePathNotFoundError(err)) {
          // Skill not found at path
        } else {
          throw err;
        }
      }
      return skills;
    }

    // Fetch repository tree
    const tree = platform === 'github'
      ? await (githubSnapshot?.getTree() ?? fetchGitHubTree(owner, repo, branch))
      : await fetchGitLabTree(owner, repo, branch);

    // Find all SKILL.md files
    const skillFiles = tree.filter(item =>
      item.path.endsWith('SKILL.md') &&
      (item.type === 'blob' || item.type === 'file')
    );

    // Sort by discovery path priority
    skillFiles.sort((a, b) => {
      const aDir = a.path.replace(/\/SKILL\.md$/, '');
      const bDir = b.path.replace(/\/SKILL\.md$/, '');

      const aPriority = SKILL_DISCOVERY_PATHS.findIndex(p => aDir === p || aDir.startsWith(p + '/'));
      const bPriority = SKILL_DISCOVERY_PATHS.findIndex(p => bDir === p || bDir.startsWith(p + '/'));

      // Lower index = higher priority, -1 means not in priority list
      if (aPriority === -1 && bPriority === -1) return 0;
      if (aPriority === -1) return 1;
      if (bPriority === -1) return -1;
      return aPriority - bPriority;
    });

    // Fetch and parse each skill
    for (const file of skillFiles) {
      try {
        const content = platform === 'github'
          ? await githubSnapshot!.getFileText(file.path, file as GitHubTreeItem)
          : await fetchGitLabFile(owner, repo, file.path, branch);

        const metadata = parseSkillFrontmatter(content);
        if (metadata) {
          skills.push({
            name: metadata.name,
            description: metadata.description,
            path: file.path,
            content,
            sha: 'sha' in file ? (file as GitHubTreeItem).sha : undefined,
            contentHash: calculateContentHash(content)
          });
        }
      } catch {
        // Skip files that can't be fetched
      }
    }

    return skills;
  } catch (error) {
    throw error;
  }
}

export async function fetchSkillCompanionFiles(source: RepoSource, skillFilePath: string): Promise<SkillCompanionFile[]> {
  return fetchSkillCompanionFilesWithOptions(source, skillFilePath);
}

export async function fetchSkillCompanionFilesWithOptions(
  source: RepoSource,
  skillFilePath: string,
  options?: { githubSnapshot?: GitHubRepoSnapshot | null }
): Promise<SkillCompanionFile[]> {
  if (!skillFilePath || !skillFilePath.endsWith('SKILL.md')) {
    return [];
  }

  if (source.platform !== 'github') {
    return [];
  }

  const snapshot = getMatchingGitHubSnapshot(source, options?.githubSnapshot) ?? createGitHubRepoSnapshot(source);
  if (!snapshot) {
    throw new Error('Failed to initialize GitHub repository snapshot');
  }

  return fetchGitHubSkillCompanionFiles(
    source,
    skillFilePath,
    snapshot
  );
}

async function fetchGitHubSkillCompanionFiles(
  source: RepoSource,
  skillFilePath: string,
  snapshot: GitHubRepoSnapshot
): Promise<SkillCompanionFile[]> {
  const tree = await snapshot.getTree();
  const normalizedSkillFilePath = normalizeRepoPath(skillFilePath);
  const skillDir = getRepoDirPath(normalizedSkillFilePath);
  const pathMap = await snapshot.getPathMap();

  const files: SkillCompanionFile[] = [];
  for (const item of tree) {
    const repoPath = normalizeRepoPath(item.path);
    if (item.type !== 'blob') continue;
    if (repoPath === normalizedSkillFilePath) continue;
    if (!isPathWithinDirectory(repoPath, skillDir)) continue;

    const relativePath = toRelativeSkillPath(repoPath, skillDir);
    if (!relativePath) continue;

    const content = await resolveGitHubBlobOrSymlinkContent({
      snapshot,
      item,
      currentPath: repoPath,
      pathMap,
      depth: 0,
      visited: new Set(),
    });

    if (!content) continue;

    files.push({ path: relativePath, content });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function resolveGitHubBlobOrSymlinkContent({
  snapshot,
  item,
  currentPath,
  pathMap,
  depth,
  visited,
}: {
  snapshot: GitHubRepoSnapshot;
  item: GitHubTreeItem;
  currentPath: string;
  pathMap: Map<string, GitHubTreeItem>;
  depth: number;
  visited: Set<string>;
}): Promise<Buffer | null> {
  const symlinkMode = item.mode === '120000';
  if (!symlinkMode) {
    if (!item.sha) return null;
    return snapshot.getFileBytes(currentPath, item);
  }

  if (depth >= MAX_GITHUB_SYMLINK_DEPTH) {
    throw new Error(`Symlink resolution depth exceeded for ${currentPath}`);
  }
  if (visited.has(currentPath)) {
    throw new Error(`Symlink loop detected at ${currentPath}`);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(currentPath);

  const targetBlob = await snapshot.getBlobBytesBySha(item.sha);
  const targetPathRaw = targetBlob.toString('utf-8').replace(/\r?\n$/, '');
  const resolvedTargetPath = resolveRepoSymlinkTarget(currentPath, targetPathRaw);
  if (!resolvedTargetPath) {
    return null;
  }

  const targetItem = pathMap.get(resolvedTargetPath);
  if (!targetItem || targetItem.type !== 'blob') {
    return null;
  }

  return resolveGitHubBlobOrSymlinkContent({
    snapshot,
    item: targetItem,
    currentPath: resolvedTargetPath,
    pathMap,
    depth: depth + 1,
    visited: nextVisited,
  });
}

function normalizeRepoPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  return pathPosix.normalize(normalized).replace(/^\.\//, '');
}

function getRepoDirPath(filePath: string): string {
  const dir = pathPosix.dirname(filePath);
  return dir === '.' ? '' : dir;
}

function isPathWithinDirectory(path: string, dir: string): boolean {
  if (!dir) return true;
  return path === dir || path.startsWith(`${dir}/`);
}

function toRelativeSkillPath(repoPath: string, skillDir: string): string {
  if (!skillDir) return repoPath;
  if (!repoPath.startsWith(`${skillDir}/`)) return '';
  return repoPath.slice(skillDir.length + 1);
}

function resolveRepoSymlinkTarget(currentPath: string, targetPath: string): string | null {
  if (!targetPath) return null;
  const normalizedInput = targetPath.replace(/\\/g, '/');
  if (normalizedInput.startsWith('/')) return null;

  const currentDir = getRepoDirPath(currentPath);
  const resolved = normalizeRepoPath(pathPosix.join(currentDir, normalizedInput));
  if (!resolved) return null;
  if (resolved === '..' || resolved.startsWith('../')) return null;
  return resolved;
}

function isSourcePathNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('File not found:');
}

/**
 * Fetch a single skill by name from a repository
 */
export async function fetchSkill(source: RepoSource, skillName: string): Promise<SkillInfo | null> {
  const skills = await discoverSkills(source);
  return skills.find(s => s.name === skillName) || null;
}

/**
 * Check if a skill has updates available
 */
export async function checkSkillUpdate(
  source: RepoSource,
  skillName: string,
  currentSha?: string
): Promise<{ hasUpdate: boolean; latestSha?: string }> {
  if (!currentSha) {
    return { hasUpdate: true };
  }

  const skill = await fetchSkill(source, skillName);
  if (!skill) {
    return { hasUpdate: false };
  }

  const hasUpdate = skill.sha !== currentSha;
  return { hasUpdate, latestSha: skill.sha };
}
