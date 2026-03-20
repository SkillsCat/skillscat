export type GitHubRefType = 'tree' | 'blob' | 'commit';

export interface ParsedGitHubRepoUrl {
  owner: string;
  repo: string;
  path: string;
  refType?: GitHubRefType;
  refPath?: string;
}

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

  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) {
    return null;
  }

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => safeDecodeURIComponent(segment));

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
