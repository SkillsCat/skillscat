import type { GitHubRequestOptions } from './request';
import {
  getGitHubTokenInputFromEnv,
  hasGitHubTokenConfigured,
  type GitHubTokenEnv,
} from './token-pool';

export type GitHubRequestEnv = GitHubTokenEnv;

interface GitHubRequestAuthOptions {
  includeRateLimitKV?: boolean;
  rateLimitMode?: 'off' | 'read_only' | 'read_write' | 'rate_limit_only';
}

export function hasGitHubAuthConfigured(env: GitHubRequestEnv | null | undefined): boolean {
  return hasGitHubTokenConfigured(env);
}

export function getGitHubRequestAuthFromEnv(
  env: GitHubRequestEnv | null | undefined,
  options: GitHubRequestAuthOptions = {}
): Pick<GitHubRequestOptions, 'token' | 'rateLimitKV' | 'rateLimitWritePolicy'> {
  const rateLimitMode = options.rateLimitMode
    ?? (options.includeRateLimitKV ? 'read_write' : 'rate_limit_only');
  const rateLimitKV = rateLimitMode === 'off' ? undefined : env?.KV;

  return {
    token: getGitHubTokenInputFromEnv(env),
    // Keep pooled-token budget awareness by default, but avoid writing snapshots
    // on successful requests unless a caller explicitly opts into read/write mode.
    rateLimitKV,
    rateLimitWritePolicy: rateLimitMode === 'read_write'
      ? 'always'
      : rateLimitMode === 'rate_limit_only'
        ? 'rate_limit_only'
        : 'off',
  };
}
