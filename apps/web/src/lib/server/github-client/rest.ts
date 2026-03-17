import { githubRequest, type GitHubRequestOptions } from './request';

export interface GitHubClientRequestOptions extends GitHubRequestOptions {}

function withOptions(
  options: GitHubClientRequestOptions | undefined,
  defaults?: Partial<GitHubClientRequestOptions>
): GitHubClientRequestOptions {
  return { ...(defaults || {}), ...(options || {}) };
}

export function buildRepoUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

export function buildRepoContentsUrl(owner: string, repo: string, path: string, ref?: string | null): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`${buildRepoUrl(owner, repo)}/contents/${encodedPath}`);
  if (ref) url.searchParams.set('ref', ref);
  return url.toString();
}

export function buildRepoCommitByRefUrl(owner: string, repo: string, ref: string): string {
  return `${buildRepoUrl(owner, repo)}/commits/${ref}`;
}

export function buildRepoCommitsByPathUrl(owner: string, repo: string, path: string): string {
  const url = new URL(`${buildRepoUrl(owner, repo)}/commits`);
  url.searchParams.set('per_page', '1');
  url.searchParams.set('path', path);
  return url.toString();
}

export function buildRepoBlobUrl(owner: string, repo: string, sha: string): string {
  return `${buildRepoUrl(owner, repo)}/git/blobs/${sha}`;
}

export function buildRepoTreeUrl(owner: string, repo: string, ref: string, recursive: boolean = true): string {
  const url = new URL(`${buildRepoUrl(owner, repo)}/git/trees/${ref}`);
  if (recursive) url.searchParams.set('recursive', '1');
  return url.toString();
}

export function buildSearchCodeUrl(query: string, perPage: number = 100): string {
  const url = new URL('https://api.github.com/search/code');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(perPage));
  return url.toString();
}

export function buildSearchCodeUrlWithParams(
  query: string,
  options?: {
    perPage?: number;
    page?: number;
    sort?: 'indexed';
    order?: 'asc' | 'desc';
  }
): string {
  const url = new URL('https://api.github.com/search/code');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(options?.perPage ?? 100));
  url.searchParams.set('page', String(options?.page ?? 1));
  if (options?.sort) {
    url.searchParams.set('sort', options.sort);
    url.searchParams.set('order', options.order ?? 'desc');
  }
  return url.toString();
}

export function buildPublicEventsUrl(page: number = 1, perPage: number = 100): string {
  const url = new URL('https://api.github.com/events');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));
  return url.toString();
}

export function buildRateLimitUrl(): string {
  return 'https://api.github.com/rate_limit';
}

export function buildGitHubUserUrl(login: string): string {
  return `https://api.github.com/users/${login}`;
}

export function buildGitHubOrgUrl(login: string): string {
  return `https://api.github.com/orgs/${login}`;
}

export function buildViewerOrgMembershipUrl(org: string): string {
  return `https://api.github.com/user/memberships/orgs/${org}`;
}

export async function getRepo(owner: string, repo: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildRepoUrl(owner, repo), withOptions(options, { endpointId: 'repos_get' }));
}

export async function getRepoContent(owner: string, repo: string, path: string, options?: GitHubClientRequestOptions & { ref?: string | null }): Promise<Response> {
  const { ref, ...rest } = options || {};
  return githubRequest(buildRepoContentsUrl(owner, repo, path, ref), withOptions(rest, { endpointId: 'repos_contents_get' }));
}

export async function getCommitByRef(owner: string, repo: string, ref: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildRepoCommitByRefUrl(owner, repo, ref), withOptions(options, { endpointId: 'repos_commit_get' }));
}

export async function listCommitsForPath(owner: string, repo: string, path: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildRepoCommitsByPathUrl(owner, repo, path), withOptions(options, { endpointId: 'repos_commits_list' }));
}

export async function getBlob(owner: string, repo: string, sha: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildRepoBlobUrl(owner, repo, sha), withOptions(options, { endpointId: 'repos_git_blob_get' }));
}

export async function getTreeRecursive(owner: string, repo: string, ref: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildRepoTreeUrl(owner, repo, ref, true), withOptions(options, { endpointId: 'repos_git_tree_get' }));
}

export async function searchCode(
  query: string,
  options?: GitHubClientRequestOptions & {
    perPage?: number;
    page?: number;
    sort?: 'indexed';
    order?: 'asc' | 'desc';
  }
): Promise<Response> {
  const {
    perPage = 100,
    page = 1,
    sort,
    order,
    ...rest
  } = options || {};
  return githubRequest(
    buildSearchCodeUrlWithParams(query, { perPage, page, sort, order }),
    withOptions(rest, { endpointId: 'search_code' })
  );
}

export async function listPublicEvents(options?: GitHubClientRequestOptions & { page?: number; perPage?: number }): Promise<Response> {
  const { page = 1, perPage = 100, ...rest } = options || {};
  return githubRequest(buildPublicEventsUrl(page, perPage), withOptions(rest, { endpointId: 'events' }));
}

export async function getRateLimit(options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildRateLimitUrl(), withOptions(options, {
    endpointId: 'rate_limit',
    cache: 'off',
    graphqlFallback: 'off',
  }));
}

export async function getUserByLogin(login: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildGitHubUserUrl(login), withOptions(options, { endpointId: 'users_get' }));
}

export async function getOrgByLogin(login: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildGitHubOrgUrl(login), withOptions(options, { endpointId: 'orgs_get' }));
}

export async function getViewerOrgMembership(org: string, options?: GitHubClientRequestOptions): Promise<Response> {
  return githubRequest(buildViewerOrgMembershipUrl(org), withOptions(options, {
    endpointId: 'user_viewer_membership',
    viewerScoped: true,
    cache: 'off',
    graphqlFallback: 'off',
  }));
}
