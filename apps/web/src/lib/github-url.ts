export type GitHubRefType = 'tree' | 'blob' | 'commit';

export interface ParsedGitHubRepoUrl {
  owner: string;
  repo: string;
  path: string;
  refType?: GitHubRefType;
  refPath?: string;
}

export interface ParsedGitHubRepoShorthand {
  owner: string;
  repo: string;
}

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function safeDecodeURIComponent(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepoUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => safeDecodeURIComponent(segment));

  // skills.sh mirrors GitHub-hosted skills:
  // https://skills.sh/owner/repo or https://skills.sh/owner/repo/skill-name.
  // The third segment is a skill name, not an in-repo path, so the whole
  // repository is submitted and every SKILL.md in it gets indexed.
  if (host === 'skills.sh' || host === 'www.skills.sh') {
    if (segments.length < 2 || segments.length > 3) {
      return null;
    }

    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/, '');

    if (!owner || !repo || segments.some((segment) => segment === '.' || segment === '..')) {
      return null;
    }

    return { owner, repo, path: '' };
  }

  if (!['github.com', 'www.github.com'].includes(host)) {
    return null;
  }

  if (segments.length < 2) {
    return null;
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');

  if (!owner || !repo) {
    return null;
  }

  if (segments.length === 2) {
    return { owner, repo, path: '' };
  }

  const route = segments[2];
  if (route === 'tree' || route === 'blob' || route === 'commit') {
    return {
      owner,
      repo,
      path: '',
      refType: route,
      refPath: segments.slice(3).join('/'),
    };
  }

  return {
    owner,
    repo,
    path: segments.slice(2).join('/'),
  };
}

export function isValidGitHubRepoUrlForSubmit(url: string): boolean {
  return parseGitHubRepoUrl(url) !== null;
}

export function parseGitHubRepoShorthand(input: string): ParsedGitHubRepoShorthand | null {
  const trimmed = input.trim();

  if (!trimmed || trimmed.includes('://')) {
    return null;
  }

  const segments = trimmed.split('/');
  if (segments.length !== 2) {
    return null;
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPO_PATTERN.test(repo)) {
    return null;
  }

  if (repo === '.' || repo === '..') {
    return null;
  }

  return { owner, repo };
}

export function normalizeGitHubRepoShorthandForSubmit(input: string): string | null {
  const repo = parseGitHubRepoShorthand(input);
  if (!repo) return null;

  return `https://github.com/${repo.owner}/${repo.repo}`;
}

export function normalizeGitHubSubmitInput(input: string): string | null {
  const trimmed = input.trim();
  if (isValidGitHubRepoUrlForSubmit(trimmed)) return trimmed;

  return normalizeGitHubRepoShorthandForSubmit(trimmed);
}
