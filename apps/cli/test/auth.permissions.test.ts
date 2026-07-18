import { beforeEach, describe, expect, it, vi } from 'vitest';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { configureRegistry, createWorkspace, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

describe('auth permissions', () => {
  beforeEach(() => {
    createWorkspace('auth-permissions');
    resetTestConfigDir();
  });

  it('stores auth config with restricted filesystem permissions', async () => {
    if (process.platform === 'win32') {
      // POSIX mode assertions do not apply on Windows.
      return;
    }

    const { setToken } = await import('../src/utils/auth/auth');
    const { getAuthPath, getConfigDir } = await import('../src/utils/config/config');

    setToken('sk_test_cli_permissions');

    const authMode = statSync(getAuthPath()).mode & 0o777;
    const dirMode = statSync(getConfigDir()).mode & 0o777;

    // No group/other bits should be set.
    expect(authMode & 0o077).toBe(0);
    expect(dirMode & 0o077).toBe(0);
  });

  it('stores organization identity when logging in with an organization token', async () => {
    await configureRegistry('http://localhost:3000/registry');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      principal: {
        type: 'org',
        id: 'org-1',
        slug: 'acme',
        name: 'Acme',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch);

    const { login } = await import('../src/commands/login');
    const { getPrincipal, loadConfig } = await import('../src/utils/auth/auth');
    const result = await runCommand(() => login({ token: 'sk_org_token' }));

    expect(result.exitCode).toBeNull();
    expect(loadConfig().accessToken).toBe('sk_org_token');
    expect(getPrincipal()).toMatchObject({ type: 'org', id: 'org-1', slug: 'acme' });
  });

  it('stores private registry cache content with restricted permissions and collision-safe keys', async () => {
    const { cacheSkill, getCacheKey, getSkillsCacheDir } = await import('../src/utils/storage/cache');
    const { getCacheDir } = await import('../src/utils/config/config');

    expect(getCacheKey('acme', 'repo', 'skills/a/b')).not.toBe(
      getCacheKey('acme', 'repo', 'skills/a_b')
    );

    cacheSkill('acme', 'private-repo', '# Private content', 'registry', 'skills/secret');

    if (process.platform === 'win32') {
      return;
    }

    const key = getCacheKey('acme', 'private-repo', 'skills/secret');
    const cacheFile = join(getSkillsCacheDir(), `${key}.json`);
    expect(statSync(getCacheDir()).mode & 0o077).toBe(0);
    expect(statSync(getSkillsCacheDir()).mode & 0o077).toBe(0);
    expect(statSync(cacheFile).mode & 0o077).toBe(0);
  });

  it('never reuses a token for a different registry origin', async () => {
    await configureRegistry('https://registry-one.example/registry');
    const { getValidToken, loadConfig, setToken } = await import('../src/utils/auth/auth');
    setToken('sk_origin_bound');

    expect(loadConfig().authOrigin).toBe('https://registry-one.example');
    expect(await getValidToken()).toBe('sk_origin_bound');

    await configureRegistry('https://registry-two.example/registry');
    expect(await getValidToken()).toBeNull();

    await configureRegistry('https://registry-one.example/openclaw');
    expect(await getValidToken()).toBe('sk_origin_bound');
  });

  it('uses the registry auth surface when content is configured through OpenClaw', async () => {
    await configureRegistry('https://registry-one.example/openclaw');
    const { getRegistryAuthUrl } = await import('../src/utils/auth/auth');

    expect(getRegistryAuthUrl()).toBe('https://registry-one.example/registry');
  });
});
