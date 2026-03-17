import { describe, expect, it } from 'vitest';
import {
  buildOpenClawFileCacheKey,
  buildOpenClawResolveCacheKey,
  canUsePublicOpenClawCache,
  getOpenClawRouteCachePolicy,
  getOpenClawSelectedVersionContentToken,
  getOpenClawVersionsStateToken,
  isOpenClawImmutableVersionRequest,
} from '../src/lib/server/openclaw/cache';
import type { OpenClawResolvedVersionState } from '../src/lib/server/openclaw/skill-state';

function createVersionState(overrides: Partial<OpenClawResolvedVersionState> = {}): OpenClawResolvedVersionState {
  const versions = overrides.versions || [
    {
      version: '1.2.3',
      createdAt: 1_700_000_000_000,
      changelog: 'Initial release',
      changelogSource: 'user',
      license: 'MIT-0',
      fingerprint: 'abc123',
    },
  ];

  return {
    manifest: {
      schemaVersion: 1,
      compatSlug: 'demo~skill',
      nativeSlug: 'demo/skill',
      ownerHandle: 'demo',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
      deleted: false,
      deletedAt: null,
      tags: { latest: '1.2.3' },
      versions,
    },
    latestVersion: {
      version: '1.2.3',
      createdAt: 1_700_000_000_000,
      changelog: 'Initial release',
      changelogSource: 'user',
      license: 'MIT-0',
    },
    tags: { latest: '1.2.3' },
    versions,
    selectedVersion: versions[0] || null,
    usesManifest: true,
    ...overrides,
  };
}

describe('openclaw cache helpers', () => {
  it('uses shorter TTLs for latest aliases and longer TTLs for immutable versions', () => {
    expect(getOpenClawRouteCachePolicy()).toEqual({
      ttlSeconds: 300,
      cacheControl: 'public, max-age=300, stale-while-revalidate=900',
    });
    expect(getOpenClawRouteCachePolicy({ immutable: true })).toEqual({
      ttlSeconds: 86400,
      cacheControl: 'public, max-age=86400, stale-while-revalidate=604800',
    });
  });

  it('only enables the route cache for public responses', () => {
    expect(canUsePublicOpenClawCache('public, max-age=300')).toBe(true);
    expect(canUsePublicOpenClawCache('private, no-cache')).toBe(false);
    expect(canUsePublicOpenClawCache('no-store')).toBe(false);
  });

  it('treats explicit version requests as immutable but keeps latest aliases dynamic', () => {
    expect(isOpenClawImmutableVersionRequest('1.2.3')).toBe(true);
    expect(isOpenClawImmutableVersionRequest(' 1.2.3 ')).toBe(true);
    expect(isOpenClawImmutableVersionRequest('')).toBe(false);
    expect(isOpenClawImmutableVersionRequest(null)).toBe(false);
  });

  it('changes the versions-state token when the manifest state changes', () => {
    const baseState = createVersionState();
    const updatedState = createVersionState({
      manifest: {
        ...baseState.manifest!,
        updatedAt: baseState.manifest!.updatedAt + 1,
      },
    });

    expect(getOpenClawVersionsStateToken(baseState)).not.toBe(getOpenClawVersionsStateToken(updatedState));
  });

  it('keeps the selected-version content token stable across manifest-only updates', () => {
    const baseState = createVersionState();
    const updatedState = createVersionState({
      manifest: {
        ...baseState.manifest!,
        updatedAt: baseState.manifest!.updatedAt + 500,
      },
    });

    expect(getOpenClawSelectedVersionContentToken(baseState)).toBe(
      getOpenClawSelectedVersionContentToken(updatedState)
    );
  });

  it('builds cache keys with encoded path and hash segments', () => {
    const fileKey = buildOpenClawFileCacheKey({
      compatSlug: 'demo~skill',
      path: 'docs/quick start.md',
      selectedVersionContentToken: '1.2.3:abc123',
    });
    const resolveKey = buildOpenClawResolveCacheKey({
      compatSlug: 'demo~skill',
      hash: 'a'.repeat(64),
      skillUpdatedAt: 1_700_000_000_000,
      versionsStateToken: 'state-token',
    });

    expect(fileKey).toContain('docs%2Fquick%20start.md');
    expect(fileKey).not.toContain('quick start.md');
    expect(resolveKey).toContain('a'.repeat(64));
  });
});
