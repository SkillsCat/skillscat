import { githubRequest } from '../../../src/lib/server/github-client/request';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubFetchOptions {
  token?: string | string[];
  apiVersion?: string;
  userAgent?: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  maxRetries?: number;
  notFoundAsNull?: boolean;
  rateLimitKV?: KVNamespace;
  rateLimitKeyPrefix?: string;
}

export async function githubFetch<T>(
  url: string,
  options: GitHubFetchOptions = {}
): Promise<T | null> {
  const {
    token,
    apiVersion = '2022-11-28',
    userAgent = 'SkillsCat-Worker/1.0',
    method,
    headers,
    body,
    maxRetries,
    notFoundAsNull = true,
    rateLimitKV,
    rateLimitKeyPrefix,
  } = options;

  const response = await githubRequest(url, {
    token,
    apiVersion,
    userAgent,
    method,
    headers,
    body,
    maxRetries,
    rateLimitKV,
    rateLimitKeyPrefix,
  });

  if (response.status === 404 && notFoundAsNull) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export function getRepoApiUrl(owner: string, name: string): string {
  return `${GITHUB_API_BASE}/repos/${owner}/${name}`;
}

export function getContentsApiUrl(owner: string, name: string, path: string): string {
  return `${GITHUB_API_BASE}/repos/${owner}/${name}/contents/${path}`;
}
