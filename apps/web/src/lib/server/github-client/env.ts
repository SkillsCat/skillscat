import type { GitHubRequestOptions } from './request';
import {
  getGitHubTokenInputFromEnv,
  hasGitHubTokenConfigured,
  type GitHubTokenEnv,
} from './token-pool';

export type GitHubRequestEnv = GitHubTokenEnv;

export function hasGitHubAuthConfigured(env: GitHubRequestEnv | null | undefined): boolean {
  return hasGitHubTokenConfigured(env);
}

export function getGitHubRequestAuthFromEnv(
  env: GitHubRequestEnv | null | undefined
): Pick<GitHubRequestOptions, 'token' | 'rateLimitKV'> {
  return {
    token: getGitHubTokenInputFromEnv(env),
    rateLimitKV: env?.KV,
  };
}
