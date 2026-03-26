import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

function toUrlString(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && input !== null && 'toString' in input && typeof input.toString === 'function') {
    return input.toString();
  }
  return String(input);
}

function mockResponse(data: unknown, status = 200): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  };
}

function mockGitHubFetch(content: string, sha = 'sha1') {
  const encoded = Buffer.from(content).toString('base64');

  const fetchMock = vi.fn(async (input: unknown) => {
    const url = toUrlString(input);

    if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
      return mockResponse({ error: 'Not found' }, 404);
    }

    if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
      return mockResponse({ skills: [], total: 0 }, 200);
    }

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

    if (url.endsWith('/api/submit')) {
      return mockResponse({ success: true, message: 'queued' }, 200);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

function mockGitHubCompanionSkillFetch() {
  const encodedSkill = Buffer.from(SKILL_MD_V1).toString('base64');

  const fetchMock = vi.fn(async (input: unknown) => {
    const url = toUrlString(input);

    if (url.includes('https://api.github.com/repos/testowner/testrepo/contents/skills/demo/SKILL.md?ref=feature-x')) {
      return mockResponse({ content: encodedSkill, encoding: 'base64', sha: 'sha-skill' }, 200);
    }

    if (url.includes('https://api.github.com/repos/testowner/testrepo/git/trees/feature-x?recursive=1')) {
      return mockResponse({
        tree: [
          { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'sha-skill', mode: '100644' },
          { path: 'skills/demo/notes.txt', type: 'blob', sha: 'sha-notes', mode: '100644' },
          { path: 'skills/demo/templates/prompt.txt', type: 'blob', sha: 'sha-link', mode: '120000' },
          { path: 'shared/prompts/base.txt', type: 'blob', sha: 'sha-target', mode: '100644' },
          { path: 'skills/demo/subskill/SKILL.md', type: 'blob', sha: 'sha-other', mode: '100644' },
          { path: 'skills/demo/subskill/extra.txt', type: 'blob', sha: 'sha-other-extra', mode: '100644' },
        ],
      }, 200);
    }

    if (url.endsWith('/git/blobs/sha-skill')) {
      return mockResponse({ content: encodedSkill, encoding: 'base64' }, 200);
    }

    if (url.endsWith('/git/blobs/sha-notes')) {
      return mockResponse({ content: Buffer.from('local notes').toString('base64'), encoding: 'base64' }, 200);
    }

    if (url.endsWith('/git/blobs/sha-link')) {
      return mockResponse({ content: Buffer.from('../../../shared/prompts/base.txt').toString('base64'), encoding: 'base64' }, 200);
    }

    if (url.endsWith('/git/blobs/sha-target')) {
      return mockResponse({ content: Buffer.from('shared prompt content').toString('base64'), encoding: 'base64' }, 200);
    }

    if (url.endsWith('/git/blobs/sha-other')) {
      return mockResponse({ content: Buffer.from('# Nested skill').toString('base64'), encoding: 'base64' }, 200);
    }

    if (url.endsWith('/git/blobs/sha-other-extra')) {
      return mockResponse({ content: Buffer.from('nested extra').toString('base64'), encoding: 'base64' }, 200);
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
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
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

    const skillFile = join(process.cwd(), '.agents', 'Test Skill', 'SKILL.md');
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

  it('copies fallback .agents installs into a tool-specific directory with convert', async () => {
    mockGitHubFetch(SKILL_MD_V1, 'sha-convert');

    const { add } = await import('../src/commands/add');
    const { convert } = await import('../src/commands/convert');
    const { getInstalledSkills, recordInstallation } = await import('../src/utils/storage/db');

    await runCommand(() => add('testowner/testrepo', { yes: true }));
    expect(existsSync(join(process.cwd(), '.agents', 'Test Skill', 'SKILL.md'))).toBe(true);

    const skippedSkillName = 'Existing Skill';
    const skippedSourceDir = join(process.cwd(), '.agents', skippedSkillName);
    const skippedTargetDir = join(process.cwd(), '.claude', 'skills', skippedSkillName);
    mkdirSync(skippedSourceDir, { recursive: true });
    mkdirSync(skippedTargetDir, { recursive: true });
    writeFileSync(join(skippedSourceDir, 'SKILL.md'), SKILL_MD_V1.replaceAll('Test Skill', skippedSkillName), 'utf-8');
    writeFileSync(join(skippedTargetDir, 'SKILL.md'), SKILL_MD_V1.replaceAll('Test Skill', `${skippedSkillName} local`), 'utf-8');

    recordInstallation({
      name: skippedSkillName,
      description: 'existing target copy',
      source: { platform: 'github', owner: 'testowner', repo: 'testrepo' },
      agents: ['agents'],
      global: false,
      installedAt: Date.now(),
      path: 'SKILL.md',
      installRoot: process.cwd(),
    });

    const result = await runCommand(() => convert('claude-code', {}));
    expect(result.exitCode).toBeNull();
    expect(existsSync(join(process.cwd(), '.claude/skills', 'Test Skill', 'SKILL.md'))).toBe(true);

    const trackedInstall = getInstalledSkills().find((skill) => skill.name === 'Test Skill' && !skill.global);
    expect(trackedInstall?.agents).toEqual(['agents', 'claude-code']);

    const skippedInstall = getInstalledSkills().find((skill) => skill.name === skippedSkillName && !skill.global);
    expect(skippedInstall?.agents).toEqual(['agents']);
  });

  it('drops tracked installs after the local skill directory is manually deleted', async () => {
    mockGitHubFetch(SKILL_MD_V1, 'sha-delete-track');

    const { add } = await import('../src/commands/add');
    const { update } = await import('../src/commands/update');

    await runCommand(() => add('testowner/testrepo', { yes: true }));

    const skillDir = join(process.cwd(), '.agents', 'Test Skill');
    rmSync(skillDir, { recursive: true, force: true });

    const result = await runCommand(() => update(undefined, {}));
    expect(result.stderr).toContain('No tracked skill installations found.');
  });

  it('parses explicit GitHub tree/blob refs and marks them as explicit', async () => {
    const { parseSource } = await import('../src/utils/source/source');

    const tree = parseSource('https://github.com/testowner/testrepo/tree/feature-x/skills/demo');
    expect(tree).toMatchObject({
      platform: 'github',
      owner: 'testowner',
      repo: 'testrepo',
      branch: 'feature-x',
      path: 'skills/demo',
      refKind: 'tree',
      hasExplicitRef: true,
    });

    const blob = parseSource('https://github.com/testowner/testrepo/blob/feature-x/skills/demo/SKILL.md');
    expect(blob).toMatchObject({
      platform: 'github',
      owner: 'testowner',
      repo: 'testrepo',
      branch: 'feature-x',
      path: 'skills/demo/SKILL.md',
      refKind: 'blob',
      hasExplicitRef: true,
    });

    const shorthand = parseSource('testowner/testrepo');
    expect(shorthand?.hasExplicitRef).toBeUndefined();
    expect(shorthand?.refKind).toBeUndefined();
  });

  it('installs skill from explicit GitHub blob URL (non-default branch style URL)', async () => {
    const fetchMock = mockGitHubFetch(SKILL_MD_V1, 'sha-blob');

    const { add } = await import('../src/commands/add');

    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/blob/feature-x/skills/demo/SKILL.md', { yes: true })
    );

    expect(result.exitCode).toBeNull();

    const skillFile = join(process.cwd(), '.agents', 'Test Skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toContain('Hello from v1');
    expect(fetchMock.mock.calls.map((call) => toUrlString(call[0]))).not.toContain('http://localhost:3000/api/submit');
  });

  it('installs companion files and resolves GitHub symlinked files inside the skill directory', async () => {
    const fetchMock = mockGitHubCompanionSkillFetch();
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-x/skills/demo', { yes: true })
    );

    expect(result.exitCode).toBeNull();

    const skillRoot = join(process.cwd(), '.agents', 'Test Skill');
    expect(readFileSync(join(skillRoot, 'SKILL.md'), 'utf-8')).toContain('Hello from v1');
    expect(readFileSync(join(skillRoot, 'notes.txt'), 'utf-8')).toBe('local notes');
    expect(readFileSync(join(skillRoot, 'templates', 'prompt.txt'), 'utf-8')).toBe('shared prompt content');
    expect(readFileSync(join(skillRoot, 'subskill', 'SKILL.md'), 'utf-8')).toBe('# Nested skill');
    expect(readFileSync(join(skillRoot, 'subskill', 'extra.txt'), 'utf-8')).toBe('nested extra');
    const treeRequests = fetchMock.mock.calls.filter((call) =>
      toUrlString(call[0]).includes('/git/trees/feature-x?recursive=1')
    );
    expect(treeRequests).toHaveLength(1);
  });

  it('fails with a clear error when GitHub tree API returns a truncated response', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      if (url.includes('https://api.github.com/repos/testowner/testrepo/git/trees/feature-x?recursive=1')) {
        return mockResponse({ truncated: true, tree: [] }, 200);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');
    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-x/skills/demo', { yes: true })
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('truncated response');
  });

  it('preserves binary companion files when falling back from blob API to contents API', async () => {
    const encodedSkill = Buffer.from(SKILL_MD_V1).toString('base64');
    const binaryBytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x42]);

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url.includes('/git/trees/feature-bin?recursive=1')) {
        return mockResponse({
          tree: [
            { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'sha-skill-bin', mode: '100644' },
            { path: 'skills/demo/asset.bin', type: 'blob', sha: 'sha-asset-bin', mode: '100644' },
          ],
        }, 200);
      }

      if (url.endsWith('/git/blobs/sha-skill-bin')) {
        return mockResponse({ content: encodedSkill, encoding: 'base64' }, 200);
      }

      if (url.endsWith('/git/blobs/sha-asset-bin')) {
        return mockResponse({ message: 'blob unavailable' }, 500);
      }

      if (url.includes('/contents/skills/demo/asset.bin?ref=feature-bin')) {
        return mockResponse({
          type: 'file',
          content: binaryBytes.toString('base64'),
          encoding: 'base64',
          sha: 'sha-asset-bin',
        }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-bin/skills/demo', { yes: true })
    );

    expect(result.exitCode).toBeNull();
    const installedBytes = readFileSync(join(process.cwd(), '.agents', 'Test Skill', 'asset.bin'));
    expect(installedBytes.equals(binaryBytes)).toBe(true);
  });

  it('does not let raw downloads override tree/blob-snapshot content for companion files', async () => {
    const encodedSkill = Buffer.from(SKILL_MD_V1).toString('base64');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url.includes('/git/trees/feature-raw?recursive=1')) {
        return mockResponse({
          tree: [
            { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'sha-skill-raw', mode: '100644' },
            { path: 'skills/demo/notes.txt', type: 'blob', sha: 'sha-notes-raw', mode: '100644' },
          ],
        }, 200);
      }

      if (url.endsWith('/git/blobs/sha-skill-raw')) {
        return mockResponse({ content: encodedSkill, encoding: 'base64' }, 200);
      }

      if (url.endsWith('/git/blobs/sha-notes-raw')) {
        return mockResponse({ content: Buffer.from('blob-correct').toString('base64'), encoding: 'base64' }, 200);
      }

      if (url === 'https://raw.githubusercontent.com/testowner/testrepo/feature-raw/skills/demo/notes.txt') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => 'raw-wrong',
        } as unknown as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-raw/skills/demo', { yes: true })
    );

    expect(result.exitCode).toBeNull();
    const notes = readFileSync(join(process.cwd(), '.agents', 'Test Skill', 'notes.txt'), 'utf-8');
    expect(notes).toBe('blob-correct');
  });

  it('removes stale managed companion files when upstream companion files change', async () => {
    const encodedSkill = Buffer.from(SKILL_MD_V1).toString('base64');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url.includes('/git/trees/feature-a?recursive=1')) {
        return mockResponse({
          tree: [
            { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'sha-skill-a', mode: '100644' },
            { path: 'skills/demo/old.txt', type: 'blob', sha: 'sha-old-a', mode: '100644' },
          ],
        }, 200);
      }

      if (url.includes('/git/trees/feature-b?recursive=1')) {
        return mockResponse({
          tree: [
            { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'sha-skill-b', mode: '100644' },
            { path: 'skills/demo/new.txt', type: 'blob', sha: 'sha-new-b', mode: '100644' },
          ],
        }, 200);
      }

      if (url.endsWith('/git/blobs/sha-skill-a') || url.endsWith('/git/blobs/sha-skill-b')) {
        return mockResponse({ content: encodedSkill, encoding: 'base64' }, 200);
      }

      if (url.endsWith('/git/blobs/sha-old-a')) {
        return mockResponse({ content: Buffer.from('old companion').toString('base64'), encoding: 'base64' }, 200);
      }

      if (url.endsWith('/git/blobs/sha-new-b')) {
        return mockResponse({ content: Buffer.from('new companion').toString('base64'), encoding: 'base64' }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const first = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-a/skills/demo', { yes: true })
    );
    expect(first.exitCode).toBeNull();

    const skillRoot = join(process.cwd(), '.agents', 'Test Skill');
    expect(existsSync(join(skillRoot, 'old.txt'))).toBe(true);

    const second = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-b/skills/demo', { yes: true })
    );
    expect(second.exitCode).toBeNull();

    expect(existsSync(join(skillRoot, 'old.txt'))).toBe(false);
    expect(readFileSync(join(skillRoot, 'new.txt'), 'utf-8')).toBe('new companion');
  });

  it('does not delete existing companion files when companion hydration fails during reinstall', async () => {
    const { add } = await import('../src/commands/add');

    vi.stubGlobal('fetch', mockGitHubCompanionSkillFetch() as unknown as typeof fetch);
    const first = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-x/skills/demo', { yes: true })
    );
    expect(first.exitCode).toBeNull();

    const skillRoot = join(process.cwd(), '.agents', 'Test Skill');
    const notesPath = join(skillRoot, 'notes.txt');
    expect(readFileSync(notesPath, 'utf-8')).toBe('local notes');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetTestCacheDir();

    const encodedSkill = Buffer.from(SKILL_MD_V1).toString('base64');
    const failingFetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url.includes('/git/trees/feature-x?recursive=1')) {
        return mockResponse({
          tree: [
            { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'sha-skill', mode: '100644' },
            { path: 'skills/demo/notes.txt', type: 'blob', sha: 'sha-notes', mode: '100644' },
          ],
        }, 200);
      }

      if (url.endsWith('/git/blobs/sha-skill')) {
        return mockResponse({ content: encodedSkill, encoding: 'base64' }, 200);
      }

      if (url.endsWith('/git/blobs/sha-notes')) {
        return mockResponse({ message: 'temporary failure' }, 503);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', failingFetchMock as unknown as typeof fetch);
    const second = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-x/skills/demo', { yes: true, force: true })
    );

    expect(second.exitCode).toBeNull();
    expect(readFileSync(notesPath, 'utf-8')).toBe('local notes');
  });

  it('reuses persistent GitHub tree/blob cache across repeated installs of the same explicit-ref skill', async () => {
    const fetchMock = mockGitHubCompanionSkillFetch();
    const { add } = await import('../src/commands/add');

    const source = 'https://github.com/testowner/testrepo/tree/feature-x/skills/demo';

    const first = await runCommand(() => add(source, { yes: true }));
    expect(first.exitCode).toBeNull();

    const second = await runCommand(() => add(source, { yes: true }));
    expect(second.exitCode).toBeNull();

    const urls = fetchMock.mock.calls.map((call) => toUrlString(call[0]));
    const count = (needle: string) => urls.filter((url) => url.includes(needle)).length;

    expect(count('/git/trees/feature-x?recursive=1')).toBe(1);
    expect(count('/git/blobs/sha-skill')).toBe(1);
    expect(count('/git/blobs/sha-notes')).toBe(1);
    expect(count('/git/blobs/sha-link')).toBe(1);
    expect(count('/git/blobs/sha-target')).toBe(1);
  });

  it('does not fall back to registry for explicit GitHub ref sources', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
        return mockResponse({ message: 'Not Found' }, 404);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({
          name: 'Registry Fallback Skill',
          description: 'Should not be used for explicit refs',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1,
          githubUrl: '',
          visibility: 'public',
          slug: 'testowner/testrepo',
        }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { add } = await import('../src/commands/add');
    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/tree/feature-x/skills/demo', { yes: true })
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Failed to fetch repository tree');
    expect(seenUrls).not.toContain(`${REGISTRY_URL}/repo/testowner/testrepo`);
    expect(seenUrls).not.toContain(`${REGISTRY_URL}/skill/testowner/testrepo`);
  });

  it('surfaces GitHub contents API errors for explicit path installs instead of treating them as path misses', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url.includes('/git/trees/feature-x?recursive=1')) {
        return mockResponse({ tree: [] }, 200);
      }

      if (url.includes('/contents/skills/demo/SKILL.md?ref=feature-x')) {
        return mockResponse({ message: 'rate limited' }, 429);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() =>
      add('https://github.com/testowner/testrepo/blob/feature-x/skills/demo/SKILL.md', { yes: true })
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Failed to fetch file from GitHub (429)');
    expect(result.stderr).not.toContain('No skills found in this repository');
  });

  it('triggers anonymous background submit after successful default-branch style GitHub install', async () => {
    await configureRegistry('https://skills.cat/registry');

    const encoded = Buffer.from(SKILL_MD_V1).toString('base64');
    const seenSubmits: Array<{ url: string; headers: Record<string, string>; body: string | undefined }> = [];

    const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
      const url = toUrlString(input);

      if (url === 'https://skills.cat/registry/skill/testowner/testrepo') {
        return mockResponse({ error: 'Not found' }, 404);
      }

      if (url === 'https://skills.cat/registry/repo/testowner/testrepo' || url.startsWith('https://skills.cat/registry/repo/testowner/testrepo?')) {
        return mockResponse({ skills: [], total: 0 }, 200);
      }

      if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
        if (url.includes('/git/trees/')) {
          return mockResponse({ tree: [{ path: 'SKILL.md', type: 'blob', sha: 'sha-submit' }] }, 200);
        }
        if (url.includes('/contents/')) {
          return mockResponse({ content: encoded, encoding: 'base64', sha: 'sha-submit' }, 200);
        }
        return mockResponse({ default_branch: 'main' }, 200);
      }

      if (url === 'https://skills.cat/api/submit') {
        const requestInit = (init ?? {}) as { headers?: Record<string, string>; body?: string };
        seenSubmits.push({
          url,
          headers: requestInit.headers || {},
          body: requestInit.body,
        });
        return mockResponse({ success: true }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    await runCommand(() => add('testowner/testrepo', { yes: true }));

    expect(seenSubmits.length).toBe(1);
    expect(seenSubmits[0].headers['X-Skillscat-Background-Submit']).toBe('1');
    expect(seenSubmits[0].headers['User-Agent']).toContain('skillscat-cli/');
    expect(seenSubmits[0].body || '').toContain('"url":"https://github.com/testowner/testrepo"');
  });

  it('can disable anonymous background submit via environment variable', async () => {
    await configureRegistry('https://skills.cat/registry');
    process.env.SKILLSCAT_BACKGROUND_SUBMIT = '0';

    try {
      const encoded = Buffer.from(SKILL_MD_V1).toString('base64');
      let submitCount = 0;

      const fetchMock = vi.fn(async (input: unknown) => {
        const url = toUrlString(input);

        if (url === 'https://skills.cat/registry/skill/testowner/testrepo') {
          return mockResponse({ error: 'Not found' }, 404);
        }

        if (url === 'https://skills.cat/registry/repo/testowner/testrepo' || url.startsWith('https://skills.cat/registry/repo/testowner/testrepo?')) {
          return mockResponse({ skills: [], total: 0 }, 200);
        }

        if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
          if (url.includes('/git/trees/')) {
            return mockResponse({ tree: [{ path: 'SKILL.md', type: 'blob', sha: 'sha-nosubmit' }] }, 200);
          }
          if (url.includes('/contents/')) {
            return mockResponse({ content: encoded, encoding: 'base64', sha: 'sha-nosubmit' }, 200);
          }
          return mockResponse({ default_branch: 'main' }, 200);
        }

        if (url === 'https://skills.cat/api/submit') {
          submitCount += 1;
          return mockResponse({ success: true }, 200);
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
      const { add } = await import('../src/commands/add');
      await runCommand(() => add('testowner/testrepo', { yes: true }));

      expect(submitCount).toBe(0);
    } finally {
      delete process.env.SKILLSCAT_BACKGROUND_SUBMIT;
    }
  });

  it('falls back to registry repo results when shorthand slug lookup misses', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({ error: 'Not found' }, 404);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [{
            slug: 'testowner/test-skill',
            name: 'Registry First Skill',
            description: 'From repo lookup',
            owner: 'testowner',
            repo: 'testrepo',
            skillPath: '',
            githubUrl: 'https://github.com/testowner/testrepo',
            visibility: 'private',
            updatedAt: Date.now(),
            stars: 0,
          }],
          total: 1,
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/test-skill`) {
        return mockResponse({
          name: 'Registry First Skill',
          description: 'From registry content',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replace('Test Skill', 'Registry First Skill').replace('# Test Skill', '# Registry First Skill'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'private',
          slug: 'testowner/test-skill',
          skillPath: '',
        }, 200);
      }

      if (url.endsWith('/api/submit')) {
        return mockResponse({ success: true }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', { yes: true }));
    expect(result.exitCode).toBeNull();

    const skillFile = join(process.cwd(), '.agents', 'Registry First Skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toContain('Registry First Skill');

    expect(seenUrls).toContain(`${REGISTRY_URL}/skill/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/repo/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/skill/testowner/test-skill`);
    expect(seenUrls).not.toContain('http://localhost:3000/api/submit');
  });

  it('prefers an exact registry slug over installing all skills from the matching repo', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({
          name: 'Exact Slug Skill',
          description: 'Published as an exact slug',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Exact Slug Skill'),
          githubUrl: '',
          visibility: 'private',
          slug: 'testowner/testrepo',
        }, 200);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [{
            slug: 'testowner/other-skill',
            name: 'Other Skill',
            description: 'Should not be used',
            owner: 'testowner',
            repo: 'testrepo',
            skillPath: 'skills/other',
            githubUrl: 'https://github.com/testowner/testrepo',
            visibility: 'public',
            updatedAt: Date.now(),
            stars: 0,
          }],
          total: 1,
        }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', { yes: true }));
    expect(result.exitCode).toBeNull();

    const skillFile = join(process.cwd(), '.agents', 'Exact Slug Skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toContain('Exact Slug Skill');

    expect(seenUrls).toContain(`${REGISTRY_URL}/skill/testowner/testrepo`);
    expect(seenUrls).not.toContain(`${REGISTRY_URL}/repo/testowner/testrepo`);
  });

  it('treats shorthand input as a repository when --repo is explicit', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({
          name: 'Exact Slug Skill',
          description: 'Published as an exact slug',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Exact Slug Skill'),
          githubUrl: '',
          visibility: 'private',
          slug: 'testowner/testrepo',
        }, 200);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [
            {
              slug: 'testowner/skill-one',
              name: 'Skill One',
              description: 'First repo skill',
              owner: 'testowner',
              repo: 'testrepo',
              skillPath: '',
              githubUrl: 'https://github.com/testowner/testrepo',
              visibility: 'public',
              updatedAt: Date.now(),
              stars: 0,
            },
            {
              slug: 'testowner/skill-two',
              name: 'Skill Two',
              description: 'Second repo skill',
              owner: 'testowner',
              repo: 'testrepo',
              skillPath: 'skills/two',
              githubUrl: 'https://github.com/testowner/testrepo',
              visibility: 'public',
              updatedAt: Date.now(),
              stars: 0,
            },
          ],
          total: 2,
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/skill-one`) {
        return mockResponse({
          name: 'Skill One',
          description: 'First repo skill',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Skill One'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'public',
          slug: 'testowner/skill-one',
          skillPath: '',
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/skill-two`) {
        return mockResponse({
          name: 'Skill Two',
          description: 'Second repo skill',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Skill Two'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'public',
          slug: 'testowner/skill-two',
          skillPath: 'skills/two',
        }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', { yes: true, repo: true }));
    expect(result.exitCode).toBeNull();

    expect(existsSync(join(process.cwd(), '.agents', 'Skill One', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.agents', 'Skill Two', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.agents', 'Exact Slug Skill', 'SKILL.md'))).toBe(false);

    expect(seenUrls).not.toContain(`${REGISTRY_URL}/skill/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/repo/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/skill/testowner/skill-one`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/skill/testowner/skill-two`);
  });

  it('does not let an exact slug short-circuit an explicit --skill selection', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [
            {
              slug: 'testowner/testrepo',
              name: 'Repo Root Skill',
              description: 'The root slug skill',
              owner: 'testowner',
              repo: 'testrepo',
              skillPath: '',
              githubUrl: 'https://github.com/testowner/testrepo',
              visibility: 'public',
              updatedAt: Date.now(),
              stars: 0,
            },
            {
              slug: 'testowner/nested-skill',
              name: 'Nested Skill',
              description: 'The requested nested skill',
              owner: 'testowner',
              repo: 'testrepo',
              skillPath: 'skills/nested',
              githubUrl: 'https://github.com/testowner/testrepo',
              visibility: 'public',
              updatedAt: Date.now(),
              stars: 0,
            },
          ],
          total: 2,
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/nested-skill`) {
        return mockResponse({
          name: 'Nested Skill',
          description: 'The requested nested skill',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Nested Skill'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'public',
          slug: 'testowner/nested-skill',
          skillPath: 'skills/nested',
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({
          name: 'Repo Root Skill',
          description: 'The root slug skill',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Repo Root Skill'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'public',
          slug: 'testowner/testrepo',
          skillPath: '',
        }, 200);
      }

      if (url.endsWith('/api/submit')) {
        return mockResponse({ success: true }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', {
      yes: true,
      skill: ['Nested Skill'],
    }));

    expect(result.exitCode).toBeNull();
    expect(existsSync(join(process.cwd(), '.agents', 'Nested Skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.agents', 'Repo Root Skill', 'SKILL.md'))).toBe(false);
    expect(seenUrls).not.toContain(`${REGISTRY_URL}/skill/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/repo/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/skill/testowner/nested-skill`);
  });

  it('does not fall back to an exact slug when --repo install fails', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({
          name: 'Exact Slug Skill',
          description: 'Published as an exact slug',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Exact Slug Skill'),
          githubUrl: '',
          visibility: 'private',
          slug: 'testowner/testrepo',
        }, 200);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({ skills: [], total: 0 }, 200);
      }

      if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
        return mockResponse({ message: 'GitHub unavailable' }, 503);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', { yes: true, repo: true }));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Installed');
    expect(existsSync(join(process.cwd(), '.agents', 'Exact Slug Skill', 'SKILL.md'))).toBe(false);

    expect(seenUrls).not.toContain(`${REGISTRY_URL}/skill/testowner/testrepo`);
    expect(seenUrls).toContain(`${REGISTRY_URL}/repo/testowner/testrepo`);
    expect(seenUrls.some((url) => url.includes('https://api.github.com/repos/testowner/testrepo'))).toBe(true);
  });

  it('prompts to install all repo skills when shorthand slug lookup misses', async () => {
    vi.resetModules();
    const ui = await import('../src/utils/core/ui');
    const promptSpy = vi.spyOn(ui, 'prompt')
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('y');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({ error: 'Not found' }, 404);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [
            {
              slug: 'testowner/skill-one',
              name: 'Skill One',
              description: 'First repo skill',
              owner: 'testowner',
              repo: 'testrepo',
              skillPath: '',
              githubUrl: 'https://github.com/testowner/testrepo',
              visibility: 'private',
              updatedAt: Date.now(),
              stars: 0,
            },
            {
              slug: 'testowner/skill-two',
              name: 'Skill Two',
              description: 'Second repo skill',
              owner: 'testowner',
              repo: 'testrepo',
              skillPath: 'skills/two',
              githubUrl: 'https://github.com/testowner/testrepo',
              visibility: 'private',
              updatedAt: Date.now(),
              stars: 0,
            },
          ],
          total: 2,
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/skill-one`) {
        return mockResponse({
          name: 'Skill One',
          description: 'First repo skill',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Skill One'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'private',
          slug: 'testowner/skill-one',
          skillPath: '',
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/skill-two`) {
        return mockResponse({
          name: 'Skill Two',
          description: 'Second repo skill',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Skill Two'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'private',
          slug: 'testowner/skill-two',
          skillPath: 'skills/two',
        }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', { agent: ['claude-code'] }));
    expect(result.exitCode).toBeNull();

    expect(existsSync(join(process.cwd(), '.claude/skills', 'Skill One', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.claude/skills', 'Skill Two', 'SKILL.md'))).toBe(true);

    expect(promptSpy).toHaveBeenNthCalledWith(1, 'Install all 2 skill(s) from testowner/testrepo? [y/N] ');
    expect(promptSpy).toHaveBeenNthCalledWith(2, 'Install to project directory? [Y/n] ');
  });

  it('fails when -s requests are only partially resolved', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({ error: 'Not found' }, 404);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [{
            slug: 'testowner/registry-first-skill',
            name: 'Registry First Skill',
            description: 'From repo lookup',
            owner: 'testowner',
            repo: 'testrepo',
            skillPath: '',
            githubUrl: 'https://github.com/testowner/testrepo',
            visibility: 'public',
            updatedAt: Date.now(),
            stars: 0,
          }],
          total: 1,
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/registry-first-skill`) {
        return mockResponse({
          name: 'Registry First Skill',
          description: 'From registry content',
          owner: 'testowner',
          repo: 'testrepo',
          stars: 0,
          updatedAt: Date.now(),
          categories: [],
          content: SKILL_MD_V1.replaceAll('Test Skill', 'Registry First Skill'),
          githubUrl: 'https://github.com/testowner/testrepo',
          visibility: 'public',
          slug: 'testowner/registry-first-skill',
          skillPath: '',
        }, 200);
      }

      if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
        return mockResponse({ message: 'GitHub unavailable' }, 503);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() =>
      add('testowner/testrepo', { yes: true, skill: ['Registry First Skill', 'Missing Skill'] })
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Installed');

    const installedSkillFile = join(process.cwd(), '.agents', 'Registry First Skill', 'SKILL.md');
    expect(existsSync(installedSkillFile)).toBe(false);
  });

  it('falls back to GitHub when registry repo summary exists but skill detail fetch fails', async () => {
    const seenUrls: string[] = [];
    const encoded = Buffer.from(SKILL_MD_V1).toString('base64');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      seenUrls.push(url);

      if (url === `${REGISTRY_URL}/skill/testowner/testrepo`) {
        return mockResponse({ error: 'Not found' }, 404);
      }

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({
          skills: [{
            slug: 'testowner/test-skill',
            name: 'Test Skill',
            description: 'From repo lookup',
            owner: 'testowner',
            repo: 'testrepo',
            skillPath: '',
            githubUrl: 'https://github.com/testowner/testrepo',
            visibility: 'public',
            updatedAt: Date.now(),
            stars: 0,
          }],
          total: 1,
        }, 200);
      }

      if (url === `${REGISTRY_URL}/skill/testowner/test-skill`) {
        return mockResponse({ error: 'temporarily unavailable' }, 500);
      }

      if (url.includes('https://api.github.com/repos/testowner/testrepo')) {
        if (url.includes('/git/trees/')) {
          return mockResponse({ tree: [{ path: 'SKILL.md', type: 'blob', sha: 'sha-backfill' }] }, 200);
        }
        if (url.includes('/contents/')) {
          return mockResponse({ content: encoded, encoding: 'base64', sha: 'sha-backfill' }, 200);
        }
        return mockResponse({ default_branch: 'main' }, 200);
      }

      if (url.endsWith('/api/submit')) {
        return mockResponse({ success: true }, 200);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { add } = await import('../src/commands/add');

    const result = await runCommand(() => add('testowner/testrepo', { yes: true }));
    if (result.exitCode !== null) {
      throw new Error(`Unexpected add() failure: ${result.stderr || result.stdout}`);
    }
    expect(result.exitCode).toBeNull();

    const skillFile = join(process.cwd(), '.agents', 'Test Skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toContain('Hello from v1');
    expect(seenUrls.some((url) => url.includes('https://api.github.com/repos/testowner/testrepo'))).toBe(true);
  });

  it('info outputs skill details', async () => {
    mockGitHubFetch(SKILL_MD_V1, 'sha-info');
    const { info } = await import('../src/commands/info');

    const result = await runCommand(() => info('testowner/testrepo'));
    expect(result.stdout).toContain('testowner/testrepo');
    expect(result.stdout).toContain('Test Skill');
  });

  it('submit handles success response', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
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

  it('submit auto-detects dot-directory skills from the current repository', async () => {
    mkdirSync(join(process.cwd(), '.git', 'ignored-skill'), { recursive: true });
    mkdirSync(join(process.cwd(), '.claude', 'skills', 'dot-skill'), { recursive: true });
    writeFileSync(
      join(process.cwd(), 'package.json'),
      JSON.stringify({
        repository: 'testowner/testrepo',
      }, null, 2),
      'utf-8'
    );
    writeFileSync(join(process.cwd(), '.git', 'ignored-skill', 'SKILL.md'), SKILL_MD_V1, 'utf-8');
    writeFileSync(
      join(process.cwd(), '.claude', 'skills', 'dot-skill', 'SKILL.md'),
      SKILL_MD_V1.replaceAll('Test Skill', 'Dot Skill'),
      'utf-8'
    );

    let requestBody: { url?: string; skillPath?: string } | null = null;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = toUrlString(input);
      if (url.endsWith('/api/submit')) {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as { url?: string; skillPath?: string };
        return mockResponse({ success: true, message: 'Queued' }, 200);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { submit } = await import('../src/commands/submit');
    const result = await runCommand(() => submit());

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Found SKILL.md at: .claude/skills/dot-skill/SKILL.md');
    expect(requestBody).toEqual({
      url: 'https://github.com/testowner/testrepo',
      skillPath: '.claude/skills/dot-skill',
    });
  });

  it('submit treats existing skills as a successful no-op', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);
      if (url.endsWith('/api/submit')) {
        return mockResponse({
          success: true,
          message: 'This skill already exists.',
          submitted: 0,
          existing: 1,
          existingSlug: 'testowner/testrepo',
        }, 200);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { submit } = await import('../src/commands/submit');
    const result = await runCommand(() => submit('testowner/testrepo'));

    expect(result.stdout).toContain('No new submission needed');
    expect(result.stdout).toContain('View it at:');
    expect(result.stdout).toContain('skillscat add testowner/testrepo');
  });

  it('updates registry-fallback installs via registry strategy', async () => {
    let registryFetchCount = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrlString(input);

      if (url === `${REGISTRY_URL}/repo/testowner/testrepo` || url.startsWith(`${REGISTRY_URL}/repo/testowner/testrepo?`)) {
        return mockResponse({ skills: [], total: 0 }, 200);
      }

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

    const skillFile = join(process.cwd(), '.agents', 'Private Registry Skill', 'SKILL.md');
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
