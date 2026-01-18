import type { RepoSource, SkillInfo, SkillMetadata } from './source.js';
import { SKILL_DISCOVERY_PATHS, parseSkillFrontmatter } from './source.js';

const GITHUB_API = 'https://api.github.com';
const GITLAB_API = 'https://gitlab.com/api/v4';

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
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

/**
 * Get default branch for a GitHub repo
 */
async function getGitHubDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'skillscat-cli/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Repository not found: ${owner}/${repo}`);
  }

  const data = await response.json() as { default_branch: string };
  return data.default_branch;
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
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'skillscat-cli/1.0'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch repository tree`);
  }

  const data = await response.json() as { tree: GitHubTreeItem[] };
  return data.tree;
}

/**
 * Fetch file content from GitHub
 */
async function fetchGitHubFile(owner: string, repo: string, path: string, ref?: string): Promise<string> {
  const url = ref
    ? `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
    : `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'skillscat-cli/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`File not found: ${path}`);
  }

  const data = await response.json() as GitHubContent;

  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  throw new Error(`Unexpected file encoding: ${data.encoding}`);
}

/**
 * Get file SHA from GitHub (for update checking)
 */
async function getGitHubFileSha(owner: string, repo: string, path: string, ref?: string): Promise<string | null> {
  const url = ref
    ? `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
    : `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'skillscat-cli/1.0'
    }
  });

  if (!response.ok) return null;

  const data = await response.json() as GitHubContent;
  return data.sha;
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
export async function discoverSkills(source: RepoSource): Promise<SkillInfo[]> {
  const { platform, owner, repo, branch: sourceBranch, path: sourcePath } = source;
  const skills: SkillInfo[] = [];

  try {
    // Get default branch if not specified
    const branch = sourceBranch || (
      platform === 'github'
        ? await getGitHubDefaultBranch(owner, repo)
        : await getGitLabDefaultBranch(owner, repo)
    );

    // If a specific path is provided, check only that path
    if (sourcePath) {
      const skillPath = sourcePath.endsWith('SKILL.md') ? sourcePath : `${sourcePath}/SKILL.md`;
      try {
        const content = platform === 'github'
          ? await fetchGitHubFile(owner, repo, skillPath, branch)
          : await fetchGitLabFile(owner, repo, skillPath, branch);

        const metadata = parseSkillFrontmatter(content);
        if (metadata) {
          const sha = platform === 'github'
            ? await getGitHubFileSha(owner, repo, skillPath, branch)
            : undefined;

          skills.push({
            name: metadata.name,
            description: metadata.description,
            path: skillPath,
            content,
            sha: sha || undefined
          });
        }
      } catch {
        // Skill not found at path
      }
      return skills;
    }

    // Fetch repository tree
    const tree = platform === 'github'
      ? await fetchGitHubTree(owner, repo, branch)
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
          ? await fetchGitHubFile(owner, repo, file.path, branch)
          : await fetchGitLabFile(owner, repo, file.path, branch);

        const metadata = parseSkillFrontmatter(content);
        if (metadata) {
          skills.push({
            name: metadata.name,
            description: metadata.description,
            path: file.path,
            content,
            sha: 'sha' in file ? (file as GitHubTreeItem).sha : undefined
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
