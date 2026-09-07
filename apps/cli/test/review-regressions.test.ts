import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureRegistry, createWorkspace, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';
import { add } from '../src/commands/add';
import { update } from '../src/commands/update';
import { copyInstallationAgent, getInstalledSkills, recordInstallation } from '../src/utils/storage/db';
import { calculateContentHash } from '../src/utils/storage/cache';

const v1 = '---\nname: demo\ndescription: example\n---\n# Version 1';
const v2 = v1.replace('Version 1', 'Version 2');
const registry = 'http://localhost:3000/registry';

describe('CLI review regressions', () => {
  beforeEach(async () => {
    createWorkspace('review'); resetTestConfigDir();
    await configureRegistry(registry);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('lists the repository even when owner/repo also matches an exact published slug', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${registry}/repo/owner/repo`) return Response.json({ skills: [
        { slug: 'owner/first', name: 'first', owner: 'owner', repo: 'repo', skillPath: 'first' },
        { slug: 'owner/second', name: 'second', owner: 'owner', repo: 'repo', skillPath: 'second' },
      ] });
      if (url.startsWith(`${registry}/skill/`)) return Response.json({ name: url.split('/').at(-1), owner: 'owner', repo: 'repo', content: v1 });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runCommand(() => add('owner/repo', { list: true }));
    expect(result.stdout).toContain('Found 2 skill(s)');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === `${registry}/skill/owner/repo`)).toBe(false);
  });

  it('keeps failed companion refreshes retryable and reports an incomplete update', async () => {
    const root = join(process.cwd(), '.agents', 'demo');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'SKILL.md'), v1);
    const previousHash = calculateContentHash(v1);
    recordInstallation({ name: 'demo', description: '', agents: ['agents'], global: false,
      installedAt: 1, installRoot: process.cwd(), registrySlug: 'owner/demo', path: 'SKILL.md', contentHash: previousHash });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/files')) return Response.json({}, { status: 503 });
      return Response.json({ name: 'demo', owner: 'owner', content: v2 });
    }));
    const result = await runCommand(() => update('demo', {}));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Companion files could not be checked');
    expect(getInstalledSkills()[0].contentHash).toBe(previousHash);
    expect(readFileSync(join(root, 'SKILL.md'), 'utf-8')).toBe(v2);
    const check = await runCommand(() => update('demo', { check: true }));
    expect(check.exitCode).toBe(1);
    expect(check.stdout).not.toContain('All skills are up to date');
  });

  it('updates the recorded git path when the repository has duplicate skill names', async () => {
    const root = join(process.cwd(), '.agents', 'demo');
    mkdirSync(root, { recursive: true }); writeFileSync(join(root, 'SKILL.md'), v1);
    recordInstallation({ name: 'demo', description: '', agents: ['agents'], global: false,
      installedAt: 1, installRoot: process.cwd(), path: 'second/SKILL.md', contentHash: calculateContentHash(v1),
      source: { platform: 'github', owner: 'owner', repo: 'repo', branch: 'main' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contents/second/SKILL.md')) return Response.json({ content: Buffer.from(v2).toString('base64'), encoding: 'base64' });
      if (url.includes('/git/trees/')) return Response.json({ tree: [] });
      throw new Error(`Unexpected URL: ${url}`);
    }));
    expect((await runCommand(() => update('demo', {}))).exitCode).toBeNull();
    expect(readFileSync(join(root, 'SKILL.md'), 'utf-8')).toBe(v2);
  });

  it('replaces the target source record when converting over a different skill source', () => {
    for (const dir of ['.agents', '.claude/skills']) {
      mkdirSync(join(process.cwd(), dir, 'demo'), { recursive: true });
      writeFileSync(join(process.cwd(), dir, 'demo/SKILL.md'), v1);
    }
    const base = { name: 'demo', description: '', global: false, installedAt: 1, installRoot: process.cwd(), path: 'SKILL.md' };
    recordInstallation({ ...base, agents: ['agents'], registrySlug: 'owner/source' });
    recordInstallation({ ...base, agents: ['claude-code'], registrySlug: 'owner/old' });
    copyInstallationAgent('agents', 'claude-code', { global: false, installRoot: process.cwd() });
    expect(getInstalledSkills()).toHaveLength(1);
    expect(getInstalledSkills()[0]).toMatchObject({ registrySlug: 'owner/source', agents: ['agents', 'claude-code'] });
  });

  it('ignores null or invalid settings and auth config payloads', async () => {
    const { getAuthPath, getSettingsPath, getRegistryUrl, DEFAULT_REGISTRY_URL } = await import('../src/utils/config/config');
    const { getValidToken } = await import('../src/utils/auth/auth');
    writeFileSync(getSettingsPath(), 'null');
    writeFileSync(getAuthPath(), 'null');
    expect(getRegistryUrl()).toBe(DEFAULT_REGISTRY_URL);
    await expect(getValidToken()).resolves.toBeNull();
    writeFileSync(getSettingsPath(), '{"registry":123}');
    expect(getRegistryUrl()).toBe(DEFAULT_REGISTRY_URL);
  });
});
