import type { GitHubRequestOptions } from './request';
import { GitHubGraphqlError, GitHubRateLimitError, githubGraphqlRequest } from './graphql';

export type GitHubEndpointId =
  | 'unknown'
  | 'graphql'
  | 'rate_limit'
  | 'events'
  | 'search_code'
  | 'user_viewer_membership'
  | 'user_scoped'
  | 'repos_get'
  | 'repos_contents_get'
  | 'repos_commit_get'
  | 'repos_commits_list'
  | 'repos_git_blob_get'
  | 'repos_git_tree_get'
  | 'users_get'
  | 'orgs_get';

export interface GitHubEndpointPolicy {
  id: GitHubEndpointId;
  cachePolicy: 'shared' | 'none';
  supportsConditionalGet: boolean;
  supportsGraphqlFallback: boolean;
  viewerScoped: boolean;
  cacheTtlSeconds?: number;
  fallbackCacheTtlSeconds?: number;
}

export interface GitHubRestFallbackContext {
  url: URL;
  method: string;
  options: GitHubRequestOptions;
  endpoint: GitHubEndpointPolicy;
}

function splitPathname(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

function restFallbackHeaders(): Headers {
  return new Headers({
    'Content-Type': 'application/json',
    'X-Skillscat-GitHub-Fallback': 'graphql',
    // Short cache retention for synthesized responses without GitHub validators.
    'Cache-Control': 'public, max-age=60',
  });
}

function jsonResponse(body: unknown, status: number = 200, headers?: HeadersInit): Response {
  const merged = restFallbackHeaders();
  if (headers) {
    const extra = new Headers(headers);
    extra.forEach((value, key) => merged.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers: merged });
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function getRepoRouteParts(url: URL): { owner: string; repo: string } | null {
  const parts = splitPathname(url.pathname);
  if (parts.length < 3 || parts[0] !== 'repos') return null;
  const owner = parts[1];
  const repo = parts[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function classifyGitHubEndpoint(url: URL, methodInput?: string): GitHubEndpointPolicy {
  const method = (methodInput || 'GET').toUpperCase();
  const parts = splitPathname(url.pathname);

  if (parts.length === 1 && parts[0] === 'graphql') {
    return {
      id: 'graphql',
      cachePolicy: 'none',
      supportsConditionalGet: false,
      supportsGraphqlFallback: false,
      viewerScoped: false,
    };
  }

  if (method !== 'GET') {
    return {
      id: 'unknown',
      cachePolicy: 'none',
      supportsConditionalGet: false,
      supportsGraphqlFallback: false,
      viewerScoped: false,
    };
  }

  if (parts[0] === 'user') {
    if (parts[1] === 'memberships' && parts[2] === 'orgs') {
      return {
        id: 'user_viewer_membership',
        cachePolicy: 'none',
        supportsConditionalGet: false,
        supportsGraphqlFallback: false,
        viewerScoped: true,
      };
    }

    return {
      id: 'user_scoped',
      cachePolicy: 'none',
      supportsConditionalGet: false,
      supportsGraphqlFallback: false,
      viewerScoped: true,
    };
  }

  if (parts.length === 1 && parts[0] === 'events') {
    return {
      id: 'events',
      cachePolicy: 'shared',
      supportsConditionalGet: true,
      supportsGraphqlFallback: false,
      viewerScoped: false,
      cacheTtlSeconds: 60,
    };
  }

  if (parts.length === 1 && parts[0] === 'rate_limit') {
    return {
      id: 'rate_limit',
      cachePolicy: 'none',
      supportsConditionalGet: false,
      supportsGraphqlFallback: false,
      viewerScoped: false,
    };
  }

  if (parts[0] === 'search' && parts[1] === 'code') {
    return {
      id: 'search_code',
      cachePolicy: 'shared',
      supportsConditionalGet: true,
      supportsGraphqlFallback: false,
      viewerScoped: false,
      cacheTtlSeconds: 60,
    };
  }

  if (parts.length === 2 && parts[0] === 'users') {
    return {
      id: 'users_get',
      cachePolicy: 'shared',
      supportsConditionalGet: true,
      supportsGraphqlFallback: true,
      viewerScoped: false,
      cacheTtlSeconds: 3600,
      fallbackCacheTtlSeconds: 60,
    };
  }

  if (parts.length === 2 && parts[0] === 'orgs') {
    return {
      id: 'orgs_get',
      cachePolicy: 'shared',
      supportsConditionalGet: true,
      supportsGraphqlFallback: true,
      viewerScoped: false,
      cacheTtlSeconds: 3600,
      fallbackCacheTtlSeconds: 60,
    };
  }

  if (parts[0] === 'repos' && parts.length >= 3) {
    if (parts.length === 3) {
      return {
        id: 'repos_get',
        cachePolicy: 'shared',
        supportsConditionalGet: true,
        supportsGraphqlFallback: true,
        viewerScoped: false,
        cacheTtlSeconds: 3600,
        fallbackCacheTtlSeconds: 60,
      };
    }

    if (parts[3] === 'contents') {
      return {
        id: 'repos_contents_get',
        cachePolicy: 'shared',
        supportsConditionalGet: true,
        supportsGraphqlFallback: true,
        viewerScoped: false,
        cacheTtlSeconds: 3600,
        fallbackCacheTtlSeconds: 60,
      };
    }

    if (parts[3] === 'commits' && parts.length === 4) {
      return {
        id: 'repos_commits_list',
        cachePolicy: 'shared',
        supportsConditionalGet: true,
        supportsGraphqlFallback: true,
        viewerScoped: false,
        cacheTtlSeconds: 300,
        fallbackCacheTtlSeconds: 60,
      };
    }

    if (parts[3] === 'commits' && parts.length >= 5) {
      return {
        id: 'repos_commit_get',
        cachePolicy: 'shared',
        supportsConditionalGet: true,
        supportsGraphqlFallback: true,
        viewerScoped: false,
        cacheTtlSeconds: 300,
        fallbackCacheTtlSeconds: 60,
      };
    }

    if (parts[3] === 'git' && parts[4] === 'blobs' && parts.length >= 6) {
      return {
        id: 'repos_git_blob_get',
        cachePolicy: 'shared',
        supportsConditionalGet: true,
        supportsGraphqlFallback: true,
        viewerScoped: false,
        cacheTtlSeconds: 3600,
        fallbackCacheTtlSeconds: 60,
      };
    }

    if (parts[3] === 'git' && parts[4] === 'trees') {
      return {
        id: 'repos_git_tree_get',
        cachePolicy: 'shared',
        supportsConditionalGet: true,
        supportsGraphqlFallback: false,
        viewerScoped: false,
        cacheTtlSeconds: 60,
      };
    }
  }

  return {
    id: 'unknown',
    cachePolicy: 'shared',
    supportsConditionalGet: true,
    supportsGraphqlFallback: false,
    viewerScoped: false,
    cacheTtlSeconds: 3600,
  };
}

interface GraphQLRepoOwner {
  __typename: string;
  login: string;
  avatarUrl?: string | null;
  databaseId?: number | null;
}

interface GraphQLRepositoryDetail {
  databaseId?: number | null;
  name: string;
  owner: GraphQLRepoOwner;
  url: string;
  description: string | null;
  isFork: boolean;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  watchers?: { totalCount: number } | null;
  primaryLanguage?: { name: string } | null;
  licenseInfo?: { key: string; name: string; spdxId: string | null } | null;
  repositoryTopics?: { nodes: Array<{ topic: { name: string } }> } | null;
  defaultBranchRef?: { name: string } | null;
}

function synthesizeRepoRest(owner: string, repo: string, repository: GraphQLRepositoryDetail): Record<string, unknown> | null {
  const ownerType = repository.owner.__typename === 'Organization' ? 'Organization' : 'User';
  const ownerId = repository.owner.databaseId ?? null;
  const repoId = repository.databaseId ?? null;
  if (ownerId === null || repoId === null) return null;

  return {
    id: repoId,
    name: repository.name,
    full_name: `${owner}/${repo}`,
    owner: {
      login: repository.owner.login,
      id: ownerId,
      avatar_url: repository.owner.avatarUrl ?? '',
      type: ownerType,
    },
    html_url: repository.url,
    description: repository.description,
    fork: repository.isFork,
    created_at: repository.createdAt,
    updated_at: repository.updatedAt,
    pushed_at: repository.pushedAt,
    homepage: repository.homepageUrl,
    stargazers_count: repository.stargazerCount,
    watchers_count: repository.watchers?.totalCount ?? repository.stargazerCount,
    forks_count: repository.forkCount,
    language: repository.primaryLanguage?.name ?? null,
    license: repository.licenseInfo ? {
      key: repository.licenseInfo.key,
      name: repository.licenseInfo.name,
      spdx_id: repository.licenseInfo.spdxId,
    } : null,
    topics: repository.repositoryTopics?.nodes?.map((node) => node.topic.name).filter(Boolean) ?? [],
    default_branch: repository.defaultBranchRef?.name ?? 'main',
  };
}

async function fallbackRepoGet(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const repoInfo = getRepoRouteParts(ctx.url);
  if (!repoInfo) return null;
  const query = `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      databaseId
      name
      owner {
        __typename
        login
        avatarUrl
        ... on User { databaseId }
        ... on Organization { databaseId }
      }
      url
      description
      isFork
      createdAt
      updatedAt
      pushedAt
      homepageUrl
      stargazerCount
      forkCount
      watchers { totalCount }
      primaryLanguage { name }
      licenseInfo { key name spdxId }
      repositoryTopics(first: 100) { nodes { topic { name } } }
      defaultBranchRef { name }
    }
  }`;

  const { data } = await githubGraphqlRequest<{ repository: GraphQLRepositoryDetail | null }>(query, repoInfo, {
    token: ctx.options.token,
    userAgent: ctx.options.userAgent,
    apiVersion: ctx.options.apiVersion,
    rateLimitKV: ctx.options.rateLimitKV,
    rateLimitWritePolicy: ctx.options.rateLimitWritePolicy,
    rateLimitKeyPrefix: ctx.options.rateLimitKeyPrefix,
  });

  if (!data.repository) return jsonResponse({ message: 'Not Found' }, 404);
  const body = synthesizeRepoRest(repoInfo.owner, repoInfo.repo, data.repository);
  if (!body) return null;
  return jsonResponse(body, 200);
}

async function fallbackUserGet(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const parts = splitPathname(ctx.url.pathname);
  const login = parts[1];
  if (!login) return null;
  const query = `query($login: String!) {
    repositoryOwner(login: $login) {
      __typename
      login
      avatarUrl
      ... on User { databaseId }
      ... on Organization { databaseId }
    }
  }`;
  const { data } = await githubGraphqlRequest<{
    repositoryOwner: {
      __typename: 'User' | 'Organization';
      databaseId: number | null;
      login: string;
      avatarUrl: string;
    } | null;
  }>(query, { login }, {
    token: ctx.options.token,
    userAgent: ctx.options.userAgent,
    apiVersion: ctx.options.apiVersion,
    rateLimitKV: ctx.options.rateLimitKV,
    rateLimitWritePolicy: ctx.options.rateLimitWritePolicy,
    rateLimitKeyPrefix: ctx.options.rateLimitKeyPrefix,
  });
  if (!data.repositoryOwner || data.repositoryOwner.databaseId == null) return jsonResponse({ message: 'Not Found' }, 404);
  return jsonResponse({
    id: data.repositoryOwner.databaseId,
    login: data.repositoryOwner.login,
    avatar_url: data.repositoryOwner.avatarUrl,
    type: data.repositoryOwner.__typename,
  });
}

async function fallbackOrgGet(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const parts = splitPathname(ctx.url.pathname);
  const login = parts[1];
  if (!login) return null;
  const query = `query($login: String!) { organization(login: $login) { databaseId login avatarUrl } }`;
  const { data } = await githubGraphqlRequest<{ organization: { databaseId: number | null; login: string; avatarUrl: string } | null }>(query, { login }, {
    token: ctx.options.token,
    userAgent: ctx.options.userAgent,
    apiVersion: ctx.options.apiVersion,
    rateLimitKV: ctx.options.rateLimitKV,
    rateLimitWritePolicy: ctx.options.rateLimitWritePolicy,
    rateLimitKeyPrefix: ctx.options.rateLimitKeyPrefix,
  });
  if (!data.organization || data.organization.databaseId == null) return jsonResponse({ message: 'Not Found' }, 404);
  return jsonResponse({
    id: data.organization.databaseId,
    login: data.organization.login,
    avatar_url: data.organization.avatarUrl,
    type: 'Organization',
  });
}

interface GraphQLBlobObject {
  __typename: 'Blob';
  oid: string;
  byteSize: number;
  isBinary?: boolean | null;
  text?: string | null;
}

interface GraphQLTreeEntry {
  name: string;
  type?: string | null;
  oid?: string | null;
}

interface GraphQLTreeObject {
  __typename: 'Tree';
  entries?: GraphQLTreeEntry[] | null;
}

type GraphQLObject = GraphQLBlobObject | GraphQLTreeObject | { __typename: string };

function isBlobObject(object: GraphQLObject | null): object is GraphQLBlobObject {
  return !!object && object.__typename === 'Blob' && 'oid' in object && 'byteSize' in object;
}

function isTreeObject(object: GraphQLObject | null): object is GraphQLTreeObject {
  return !!object && object.__typename === 'Tree';
}

function getContentsPathFromUrl(url: URL): { owner: string; repo: string; contentPath: string; ref: string | null } | null {
  const parts = splitPathname(url.pathname);
  if (parts.length < 5 || parts[0] !== 'repos' || parts[3] !== 'contents') return null;
  const owner = parts[1];
  const repo = parts[2];
  const contentPath = parts.slice(4).join('/');
  const ref = url.searchParams.get('ref');
  return { owner, repo, contentPath, ref };
}

async function fetchRepositoryObject(
  owner: string,
  repo: string,
  expression: string,
  options: GitHubRequestOptions
): Promise<{ object: GraphQLObject | null }> {
  const query = `query($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        __typename
        ... on Blob {
          oid
          byteSize
          isBinary
          text
        }
        ... on Tree {
          entries {
            name
            type
            oid
          }
        }
      }
    }
  }`;

  const { data } = await githubGraphqlRequest<{ repository: { object: GraphQLObject | null } | null }>(
    query,
    { owner, name: repo, expression },
    {
      token: options.token,
      userAgent: options.userAgent,
      apiVersion: options.apiVersion,
      rateLimitKV: options.rateLimitKV,
      rateLimitWritePolicy: options.rateLimitWritePolicy,
      rateLimitKeyPrefix: options.rateLimitKeyPrefix,
    }
  );

  return { object: data.repository?.object ?? null };
}

function synthesizeContentsFile(
  owner: string,
  repo: string,
  path: string,
  ref: string | null,
  blob: GraphQLBlobObject
): Response | null {
  if (blob.isBinary) return null;
  if (typeof blob.text !== 'string') return null;

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const refValue = ref || 'HEAD';
  return jsonResponse({
    name: path.split('/').pop() || path,
    path,
    sha: blob.oid,
    size: blob.byteSize,
    url: `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    html_url: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(refValue)}/${encodedPath}`,
    git_url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blob.oid}`,
    download_url: `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(refValue)}/${encodedPath}`,
    type: 'file',
    content: utf8ToBase64(blob.text),
    encoding: 'base64',
  });
}

function synthesizeContentsTree(owner: string, repo: string, basePath: string, tree: GraphQLTreeObject): Response {
  const prefix = basePath ? `${basePath}/` : '';
  const entries = (tree.entries || []).map((entry) => {
    const path = `${prefix}${entry.name}`;
    return {
      name: entry.name,
      path,
      sha: entry.oid || undefined,
      type: entry.type === 'tree' ? 'dir' : 'file',
      url: `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
      git_url: entry.oid
        ? `https://api.github.com/repos/${owner}/${repo}/git/${entry.type === 'tree' ? 'trees' : 'blobs'}/${entry.oid}`
        : null,
      html_url: `https://github.com/${owner}/${repo}/tree/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`,
      download_url: null,
    };
  });

  return jsonResponse(entries);
}

async function fallbackContentsGet(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const info = getContentsPathFromUrl(ctx.url);
  if (!info) return null;
  const expression = `${info.ref || 'HEAD'}:${info.contentPath}`;
  const { object } = await fetchRepositoryObject(info.owner, info.repo, expression, ctx.options);
  if (!object) return jsonResponse({ message: 'Not Found' }, 404);

  if (isBlobObject(object)) {
    return synthesizeContentsFile(info.owner, info.repo, info.contentPath, info.ref, object);
  }
  if (isTreeObject(object)) {
    return synthesizeContentsTree(info.owner, info.repo, info.contentPath, object);
  }
  return null;
}

async function fallbackCommitGet(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const parts = splitPathname(ctx.url.pathname);
  if (parts.length < 5 || parts[0] !== 'repos' || parts[3] !== 'commits') return null;
  const owner = parts[1];
  const repo = parts[2];
  const ref = parts.slice(4).join('/');
  const query = `query($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        __typename
        ... on Commit {
          oid
          committedDate
        }
      }
    }
  }`;

  const { data } = await githubGraphqlRequest<{
    repository: { object: { __typename: string; oid?: string; committedDate?: string } | null } | null;
  }>(query, { owner, name: repo, expression: ref }, {
    token: ctx.options.token,
    userAgent: ctx.options.userAgent,
    apiVersion: ctx.options.apiVersion,
    rateLimitKV: ctx.options.rateLimitKV,
    rateLimitWritePolicy: ctx.options.rateLimitWritePolicy,
    rateLimitKeyPrefix: ctx.options.rateLimitKeyPrefix,
  });

  const object = data.repository?.object;
  if (!object) return jsonResponse({ message: 'Not Found' }, 404);
  if (object.__typename !== 'Commit' || !object.oid) return null;

  return jsonResponse({
    sha: object.oid,
    commit: {
      committer: {
        date: object.committedDate ?? null,
      },
    },
  });
}

async function fallbackCommitsList(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const repoInfo = getRepoRouteParts(ctx.url);
  if (!repoInfo) return null;
  const path = ctx.url.searchParams.get('path');
  const perPage = ctx.url.searchParams.get('per_page');
  if (!path) return null;
  if (perPage && perPage !== '1') return null;
  if (ctx.url.searchParams.has('page')) return null;
  if (ctx.url.searchParams.has('sha')) return null;

  const query = `query($owner: String!, $name: String!, $path: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        name
        target {
          __typename
          ... on Commit {
            history(first: 1, path: $path) {
              nodes {
                oid
                committedDate
              }
            }
          }
        }
      }
    }
  }`;

  const { data } = await githubGraphqlRequest<{
    repository: {
      defaultBranchRef: {
        target: {
          __typename: string;
          history?: {
            nodes: Array<{ oid: string; committedDate: string }>;
          } | null;
        } | null;
      } | null;
    } | null;
  }>(query, { owner: repoInfo.owner, name: repoInfo.repo, path }, {
    token: ctx.options.token,
    userAgent: ctx.options.userAgent,
    apiVersion: ctx.options.apiVersion,
    rateLimitKV: ctx.options.rateLimitKV,
    rateLimitWritePolicy: ctx.options.rateLimitWritePolicy,
    rateLimitKeyPrefix: ctx.options.rateLimitKeyPrefix,
  });

  const nodes = data.repository?.defaultBranchRef?.target && data.repository.defaultBranchRef.target.__typename === 'Commit'
    ? data.repository.defaultBranchRef.target.history?.nodes || []
    : [];

  const body = nodes.slice(0, 1).map((node) => ({
    sha: node.oid,
    commit: { committer: { date: node.committedDate } },
  }));

  return jsonResponse(body);
}

async function fallbackGitBlobGet(ctx: GitHubRestFallbackContext): Promise<Response | null> {
  const parts = splitPathname(ctx.url.pathname);
  if (parts.length < 6 || parts[0] !== 'repos' || parts[3] !== 'git' || parts[4] !== 'blobs') return null;
  const owner = parts[1];
  const repo = parts[2];
  const sha = parts[5];

  const { object } = await fetchRepositoryObject(owner, repo, sha, ctx.options);
  if (!object) return jsonResponse({ message: 'Not Found' }, 404);
  if (!isBlobObject(object)) return null;
  if (object.isBinary || typeof object.text !== 'string') return null;

  return jsonResponse({
    sha: object.oid,
    size: object.byteSize,
    encoding: 'base64',
    content: utf8ToBase64(object.text),
  });
}

export async function tryGraphqlFallbackForRestRateLimit(
  ctx: GitHubRestFallbackContext
): Promise<Response | null> {
  if (!ctx.endpoint.supportsGraphqlFallback) return null;
  if (ctx.endpoint.viewerScoped) return null;
  if (ctx.method !== 'GET') return null;

  try {
    switch (ctx.endpoint.id) {
      case 'repos_get':
        return await fallbackRepoGet(ctx);
      case 'users_get':
        return await fallbackUserGet(ctx);
      case 'orgs_get':
        return await fallbackOrgGet(ctx);
      case 'repos_contents_get':
        return await fallbackContentsGet(ctx);
      case 'repos_commit_get':
        return await fallbackCommitGet(ctx);
      case 'repos_commits_list':
        return await fallbackCommitsList(ctx);
      case 'repos_git_blob_get':
        return await fallbackGitBlobGet(ctx);
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      throw err;
    }
    if (err instanceof GitHubGraphqlError) {
      return null;
    }
    throw err;
  }
}
