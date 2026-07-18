import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureAuth,
  configureRegistry,
  createWorkspace,
  resetTestCacheDir,
  resetTestConfigDir,
} from './helpers/env';
import { runCommand } from './helpers/output';

const TEST_TOKEN = 'sk_unpublish_test_token';

describe('unpublish command', () => {
  beforeEach(async () => {
    vi.resetModules();
    createWorkspace('unpublish');
    resetTestConfigDir();
    resetTestCacheDir();
    await configureRegistry('http://localhost:3000/registry');
    await configureAuth(TEST_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lets a write-only automation token delete directly with --yes', async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { unpublishSkill } = await import('../src/commands/unpublish');
    const result = await runCommand(() => unpublishSkill('acme/private-skill', { yes: true }));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Skill unpublished successfully');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://localhost:3000/api/skills/acme/private-skill'
    );
  });

  it('lets a write-only token use interactive confirmation without a read request', async () => {
    const ui = await import('../src/utils/core/ui');
    vi.spyOn(ui, 'prompt').mockResolvedValue('acme/private-skill');
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { unpublishSkill } = await import('../src/commands/unpublish');
    const result = await runCommand(() => unpublishSkill('acme/private-skill', {}));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Skill unpublished successfully');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
