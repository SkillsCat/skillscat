import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureAuth, configureRegistry, createWorkspace, resetTestCacheDir, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

const REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || 'http://localhost:3000/registry';
const TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_local_token';

const SKILL_MD_V1 = `---
name: Test Skill
description: Example skill
---
# Test Skill
Hello from v1.
`;

const SKILL_MD_V2 = `---
name: Test Skill
description: Example skill updated
---
# Test Skill
Hello from v2.
`;

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  } as any;
}

function mockGitHubFetch(content: string, sha = 'sha1') {
  const encoded = Buffer.from(content).toString('base64');

  const fetchMock = vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
      if (url.includes('/git/trees/')) {
        return mockResponse({
          tree: [{ path: 'SKILL.md', type: 'blob', sha }],
        }, 200);
      }

      if (url.includes('/contents/')) {
        return mockResponse({
          content: encoded,
          encoding: 'base64',
          sha,
        }, 200);
      }

      return mockResponse({ default_branch: 'main' }, 200);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

describe('CLI commands with mocked network', () => {
  beforeEach(async () => {
    createWorkspace('mocked');
    resetTestConfigDir();
    resetTestCacheDir();
    await configureRegistry(REGISTRY_URL);
    await configureAuth(TEST_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('config set/get/list/delete', async () => {
    const { configSet, configGet, configList, configDelete } = await import('../src/commands/config');

    await runCommand(() => configSet('registry', 'http://example.test/registry'));

    const getResult = await runCommand(() => configGet('registry'));
    expect(getResult.stdout).toContain('http://example.test/registry');

    const listResult = await runCommand(() => configList());
    expect(listResult.stdout).toContain('registry');

    await runCommand(() => configDelete('registry'));

    const defaultResult = await runCommand(() => configGet('registry'));
    expect(defaultResult.stdout).toContain('(default)');
  });

  it('login/logout/whoami with token', async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/tokens/validate')) {
        return mockResponse({
          success: true,
          user: {
            id: 'user_test_1',
            name: 'testuser',
            email: 'testuser@example.com',
          },
        }, 200);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { login } = await import('../src/commands/login');
    const { whoami } = await import('../src/commands/whoami');
    const { logout } = await import('../src/commands/logout');
    const { loadConfig } = await import('../src/utils/auth/auth');

    const loginResult = await runCommand(() => login({ token: TEST_TOKEN }));
    expect(loginResult.stdout).toContain('Successfully logged in');

    const config = loadConfig();
    expect(config.accessToken).toBe(TEST_TOKEN);

    const whoamiResult = await runCommand(() => whoami());
    expect(whoamiResult.stdout).toContain('Logged in');

    const logoutResult = await runCommand(() => logout());
    expect(logoutResult.stdout).toContain('Successfully logged out');
  });

  it('add/list/update/remove with GitHub mock', async () => {
    mockGitHubFetch(SKILL_MD_V1, 'sha-v1');

    const { add } = await import('../src/commands/add');
    const { list } = await import('../src/commands/list');
    const { remove } = await import('../src/commands/remove');
    const { update } = await import('../src/commands/update');

    await runCommand(() => add('testowner/testrepo', { yes: true }));

    const skillFile = join(process.cwd(), '.claude/skills', 'Test Skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);

    const listResult = await runCommand(() => list({}));
    expect(listResult.stdout).toContain('Test Skill');

    // Simulate updated content
    vi.restoreAllMocks();
    mockGitHubFetch(SKILL_MD_V2, 'sha-v2');
    resetTestCacheDir();

    const updateResult = await runCommand(() => update(undefined, {}));
    expect(updateResult.stdout).toContain('Updated');

    const updatedContent = readFileSync(skillFile, 'utf-8');
    expect(updatedContent).toContain('Hello from v2');

    const removeResult = await runCommand(() => remove('Test Skill', {}));
    expect(removeResult.stdout).toContain('Removed Test Skill');
  });

  it('info outputs skill details', async () => {
    mockGitHubFetch(SKILL_MD_V1, 'sha-info');
    const { info } = await import('../src/commands/info');

    const result = await runCommand(() => info('testowner/testrepo'));
    expect(result.stdout).toContain('testowner/testrepo');
    expect(result.stdout).toContain('Test Skill');
  });

  it('submit handles success response', async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/submit')) {
        return mockResponse({ success: true, message: 'Queued' }, 200);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { submit } = await import('../src/commands/submit');
    const result = await runCommand(() => submit('testowner/testrepo'));

    expect(result.stdout).toContain('Skill submitted successfully');
  });

  it('updates registry-fallback installs via registry strategy', async () => {
    let registryFetchCount = 0;
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();

      // Force git discovery failure so add() falls back to registry.
      if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
        return mockResponse({ message: 'Not Found' }, 404);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        registryFetchCount += 1;
        return mockResponse({
          name: 'Private Registry Skill',
          description: 'Private skill from registry',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: registryFetchCount === 1 ? SKILL_MD_V1 : SKILL_MD_V2,
          githubUrl: '',
          visibility: 'private',
          slug: 'testowner/testrepo',
        }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { add } = await import('../src/commands/add');
    const { update } = await import('../src/commands/update');

    await runCommand(() => add('testowner/testrepo', { yes: true }));

    const skillFile = join(process.cwd(), '.claude/skills', 'Private Registry Skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toContain('Hello from v1');

    const updateResult = await runCommand(() => update(undefined, {}));
    expect(updateResult.stdout).toContain('Updated');
    expect(readFileSync(skillFile, 'utf-8')).toContain('Hello from v2');
  });

  it('publish and unpublish fail fast when token is expired', async () => {
    const { setTokens } = await import('../src/utils/auth/auth');
    const now = Date.now();
    setTokens({
      accessToken: TEST_TOKEN,
      accessTokenExpiresAt: now - 60_000,
      refreshToken: 'expired-refresh-token',
      refreshTokenExpiresAt: now - 1_000,
      user: { id: 'user_test_1' },
    });

    const skillDir = join(process.cwd(), 'expired-token-skill');
    const skillFile = join(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillFile, SKILL_MD_V1, 'utf-8');

    const { publish } = await import('../src/commands/publish');
    const publishResult = await runCommand(() => publish(skillDir, { yes: true }));
    expect(publishResult.exitCode).toBe(1);
    expect(publishResult.stderr).toContain('Authentication required or session expired');

    const { unpublishSkill } = await import('../src/commands/unpublish');
    const unpublishResult = await runCommand(() => unpublishSkill('testowner/test-skill', { yes: true }));
    expect(unpublishResult.exitCode).toBe(1);
    expect(unpublishResult.stderr).toContain('Authentication required or session expired');
  });
});
