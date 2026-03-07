import { DEFAULT_API_VERSION, DEFAULT_USER_AGENT, isGitHubRateLimitResponse, parseRetryAfterSeconds, rawGitHubRequest } from './core';
import { recordRateLimitFromHeaders } from './rate-limit-kv';

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

export interface GraphQLErrorItem {
  message?: string;
  type?: string;
  path?: Array<string | number>;
  extensions?: {
    code?: string;
    type?: string;
    [key: string]: unknown;
  };
}

interface GraphQLResponseEnvelope<TData> {
  data?: TData;
  errors?: GraphQLErrorItem[];
}

export class GitHubRateLimitError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly source: 'rest' | 'graphql';

  constructor(message: string, opts: { status: number; source: 'rest' | 'graphql'; retryAfterSeconds?: number | null }) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.status = opts.status;
    this.source = opts.source;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }
}

export class GitHubGraphqlError extends Error {
  readonly status: number;
  readonly errors: GraphQLErrorItem[];

  constructor(message: string, opts?: { status?: number; errors?: GraphQLErrorItem[] }) {
    super(message);
    this.name = 'GitHubGraphqlError';
    this.status = opts?.status ?? 500;
    this.errors = opts?.errors ?? [];
  }
}

export interface GitHubGraphqlRequestOptions {
  token?: string;
  userAgent?: string;
  apiVersion?: string;
  headers?: HeadersInit;
  maxRetries?: number;
  maxDelayMs?: number;
  rateLimitKV?: KVNamespace;
  rateLimitKeyPrefix?: string;
  endpointId?: string;
  allowPartialData?: boolean;
}

function graphQLErrorLooksRateLimited(error: GraphQLErrorItem): boolean {
  const message = (error.message || '').toLowerCase();
  const type = (error.type || error.extensions?.type || error.extensions?.code || '').toLowerCase();
  return message.includes('rate limit')
    || message.includes('abuse')
    || type.includes('rate_limit')
    || type.includes('abuse');
}

function envelopeLooksRateLimited<TData>(envelope: GraphQLResponseEnvelope<TData>): boolean {
  return (envelope.errors || []).some(graphQLErrorLooksRateLimited);
}

export async function githubGraphqlRequest<TData, TVariables = Record<string, unknown>>(
  query: string,
  variables?: TVariables,
  options: GitHubGraphqlRequestOptions = {}
): Promise<{ data: TData; response: Response; errors: GraphQLErrorItem[] }> {
  const response = await rawGitHubRequest(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    token: options.token,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    apiVersion: options.apiVersion ?? DEFAULT_API_VERSION,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify({ query, variables }),
    maxRetries: options.maxRetries ?? 0,
    maxDelayMs: options.maxDelayMs,
    retryRateLimit: false,
    cache: 'off',
    graphqlFallback: 'off',
  });

  await recordRateLimitFromHeaders(response.headers, 'graphql', {
    kv: options.rateLimitKV,
    keyPrefix: options.rateLimitKeyPrefix,
    endpointId: options.endpointId ?? 'graphql',
  });

  if (isGitHubRateLimitResponse(response)) {
    throw new GitHubRateLimitError('GitHub GraphQL API rate limit reached', {
      status: 429,
      source: 'graphql',
      retryAfterSeconds: parseRetryAfterSeconds(response.headers),
    });
  }

  let envelope: GraphQLResponseEnvelope<TData> | null = null;
  const isJson = (response.headers.get('content-type') || '').toLowerCase().includes('application/json');
  if (isJson) {
    try {
      envelope = await response.clone().json() as GraphQLResponseEnvelope<TData>;
    } catch {
      envelope = null;
    }
  }

  if (!response.ok) {
    throw new GitHubGraphqlError(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`, {
      status: response.status,
      errors: envelope?.errors,
    });
  }

  if (!envelope) {
    throw new GitHubGraphqlError('GitHub GraphQL response was not valid JSON', { status: 502 });
  }

  if (envelopeLooksRateLimited(envelope)) {
    throw new GitHubRateLimitError('GitHub GraphQL API rate limit reached', {
      status: 429,
      source: 'graphql',
      retryAfterSeconds: parseRetryAfterSeconds(response.headers),
    });
  }

  if (envelope.errors && envelope.errors.length > 0) {
    if (options.allowPartialData && envelope.data !== undefined) {
      return {
        data: envelope.data,
        response,
        errors: envelope.errors,
      };
    }

    const message = envelope.errors.map((e) => e.message).filter(Boolean).join('; ') || 'GitHub GraphQL request failed';
    throw new GitHubGraphqlError(message, {
      status: 502,
      errors: envelope.errors,
    });
  }

  if (envelope.data === undefined) {
    throw new GitHubGraphqlError('GitHub GraphQL response missing data', { status: 502, errors: envelope.errors });
  }

  return {
    data: envelope.data,
    response,
    errors: envelope.errors ?? [],
  };
}
