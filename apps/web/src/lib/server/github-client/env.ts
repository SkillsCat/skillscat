import type { GitHubRequestOptions } from './request';
import {
  getGitHubTokenInputFromEnv,
  hasGitHubTokenConfigured,
  type GitHubTokenEnv,
} from './token-pool';
import { GITHUB_RATE_LIMIT_STATE_OBJECT_NAME } from './rate-limit-kv';
import { createDurableObjectKvStore } from '../state/client';

const GITHUB_RATE_LIMIT_KV_OVERRIDE: unique symbol = Symbol('github-rate-limit-kv-override');

export type GitHubRequestEnv = GitHubTokenEnv & {
  [GITHUB_RATE_LIMIT_KV_OVERRIDE]?: KVNamespace;
};

interface GitHubRequestAuthOptions {
  includeRateLimitKV?: boolean;
  rateLimitMode?: 'off' | 'read_only' | 'read_write' | 'rate_limit_only';
}

export function hasGitHubAuthConfigured(env: GitHubRequestEnv | null | undefined): boolean {
  return hasGitHubTokenConfigured(env);
}

export function getGitHubRateLimitKVFromEnv(env: GitHubRequestEnv | null | undefined): KVNamespace | undefined {
  const override = env?.[GITHUB_RATE_LIMIT_KV_OVERRIDE];
  if (override) return override;

  // 固定单实例 'github-rate-limit':token 池快照为高频读写,DO 比 KV 便宜一个数量级。
  // 红线:objectName 只允许固定常量,禁止动态命名(实例数决定时长计费)。
  return createDurableObjectKvStore(env?.STATE_DO, {
    objectName: GITHUB_RATE_LIMIT_STATE_OBJECT_NAME,
  }) ?? env?.KV;
}

export function withGitHubRateLimitKVOverride<T extends GitHubRequestEnv>(
  env: T,
  rateLimitKV: KVNamespace | undefined
): T {
  if (!rateLimitKV) return env;
  return Object.assign({}, env, {
    [GITHUB_RATE_LIMIT_KV_OVERRIDE]: rateLimitKV,
  });
}

export function getGitHubRequestAuthFromEnv(
  env: GitHubRequestEnv | null | undefined,
  options: GitHubRequestAuthOptions = {}
): Pick<GitHubRequestOptions, 'token' | 'rateLimitKV' | 'rateLimitWritePolicy'> {
  const rateLimitMode = options.rateLimitMode
    ?? (options.includeRateLimitKV ? 'read_write' : 'rate_limit_only');
  const rateLimitKV = rateLimitMode === 'off' ? undefined : getGitHubRateLimitKVFromEnv(env);

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
