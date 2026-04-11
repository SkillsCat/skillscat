import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAuth, configureRegistry, createWorkspace, resetTestCacheDir, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

const TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_local_token';

interface MockTextResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

function mockTextResponse(body: string, status = 200): MockTextResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
  };
}

function toUrlString(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  if (typeof input === 'object' && input !== null && 'toString' in input && typeof input.toString === 'function') {
    return input.toString();
  }

  return String(input);
}

describe('view command', () => {
  beforeEach(async () => {
    vi.resetModules();
    createWorkspace('view');
    resetTestConfigDir();
    resetTestCacheDir();
    await configureRegistry('http://localhost:3000/registry');
    await configureAuth(TEST_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prints markdown from the OpenClaw-compatible skill page when requested', async () => {
    await configureRegistry('https://skills.cat/openclaw');

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(toUrlString(input)).toBe('https://skills.cat/skills/backrunner/tools/openclaw/setup');

      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['User-Agent']).toContain('OpenClaw/1.0');
      expect(headers?.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(headers?.Accept).toContain('text/markdown');

      return mockTextResponse('# Skill Markdown\n\nRendered for OpenClaw.');
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { view } = await import('../src/commands/view');
    const result = await runCommand(() => view('backrunner/tools/openclaw/setup', { output: 'markdown' }));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('# Skill Markdown');
    expect(result.stderr).toBe('');
  });

  it('prints html when --output html is used', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(toUrlString(input)).toBe('http://localhost:3000/skills/demo/my-skill');

      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['User-Agent']).toBe('skillscat-cli/0.1.0');
      expect(headers?.Accept).toContain('text/html');

      return mockTextResponse('<!doctype html><html><body><h1>My Skill</h1></body></html>');
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { view } = await import('../src/commands/view');
    const result = await runCommand(() => view('demo/my-skill', { output: 'html' }));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('<!doctype html>');
    expect(result.stderr).toBe('');
  });

  it('opens the browser when a browser environment is available', async () => {
    const browser = await import('../src/utils/core/browser');
    const canOpenSpy = vi.spyOn(browser, 'canOpenUrlInBrowser').mockReturnValue(true);
    const openSpy = vi.spyOn(browser, 'openUrlInBrowser').mockResolvedValue(true);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { view } = await import('../src/commands/view');
    const result = await runCommand(() => view('demo/my-skill'));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Opened demo/my-skill in your browser.');
    expect(result.stderr).toBe('');
    expect(canOpenSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('http://localhost:3000/skills/demo/my-skill');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to markdown output when no browser environment is detected', async () => {
    const browser = await import('../src/utils/core/browser');
    vi.spyOn(browser, 'canOpenUrlInBrowser').mockReturnValue(false);

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(toUrlString(input)).toBe('http://localhost:3000/skills/demo/my-skill');

      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['User-Agent']).toContain('OpenClaw/1.0');

      return mockTextResponse('# Fallback Markdown\n\nNo browser available.');
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { view } = await import('../src/commands/view');
    const result = await runCommand(() => view('demo/my-skill'));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('# Fallback Markdown');
    expect(result.stderr).toContain('No browser environment detected');
  });
});
