import { sendGitHubRequestThroughGateway } from './gateway';

export type GitHubRateLimitWritePolicy = 'always' | 'rate_limit_only' | 'off';

export interface GitHubRequestOptions extends Omit<RequestInit, 'headers' | 'cache'> {
  token?: string | string[];
  headers?: HeadersInit;
  apiVersion?: string;
  userAgent?: string;
  maxRetries?: number;
  retryableStatuses?: number[];
  maxDelayMs?: number;
  cache?: 'auto' | 'off';
  graphqlFallback?: 'auto' | 'off';
  endpointId?: string;
  cacheTtlSeconds?: number;
  viewerScoped?: boolean;
  rateLimitKV?: KVNamespace;
  rateLimitWritePolicy?: GitHubRateLimitWritePolicy;
  rateLimitKeyPrefix?: string;
}

/**
 * Unified GitHub request helper.
 * Transport behavior (headers/retries/cache/fallback) is centralized in github-client/gateway.
 */
export async function githubRequest(
  url: string,
  options: GitHubRequestOptions = {}
): Promise<Response> {
  return sendGitHubRequestThroughGateway(url, options);
}
