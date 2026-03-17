import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAuth, configureRegistry, createWorkspace, resetTestCacheDir, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

const REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || 'http://localhost:3000/registry';
const TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_local_token';

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

function mockResponse(data: unknown, status = 200): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  };
}

describe('report command', () => {
  beforeEach(async () => {
    createWorkspace('report');
    resetTestConfigDir();
    resetTestCacheDir();
    await configureRegistry(REGISTRY_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('submits security reports with flags and prints the resulting risk summary', async () => {
    await configureAuth(TEST_TOKEN);

    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${TEST_TOKEN}`,
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        reason: 'security',
        details: 'downloads remote payloads',
      });

      return mockResponse({
        success: true,
        message: 'Security report recorded',
        report: {
          openSecurityReportCount: 10,
          riskLevel: 'fatal',
          premiumEscalated: true,
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { report } = await import('../src/commands/report');
    const result = await runCommand(() => report('testowner/demo', {
      reason: 'security',
      details: 'downloads remote payloads',
    }));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Security report recorded');
    expect(result.stdout).toContain('Open security reports: 10');
    expect(result.stdout).toContain('Risk level: fatal');
    expect(result.stdout).toContain('Premium review queued');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/testowner%2Fdemo/report',
      expect.any(Object)
    );
  });

  it('supports interactive reason selection when --reason is omitted', async () => {
    await configureAuth(TEST_TOKEN);

    const ui = await import('../src/utils/core/ui');
    const promptSpy = vi.spyOn(ui, 'prompt').mockResolvedValue('copyright');
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        reason: 'copyright',
      });
      return mockResponse({
        success: true,
        message: 'Copyright report recorded',
      });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { report } = await import('../src/commands/report');
    const result = await runCommand(() => report('testowner/demo', {}));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Copyright report recorded');
    expect(promptSpy).toHaveBeenCalled();
  });

  it('fails fast when the user is not logged in', async () => {
    const { report } = await import('../src/commands/report');
    const result = await runCommand(() => report('testowner/demo', { reason: 'security' }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Authentication required.');
  });

  it('shows server-side errors from the report API', async () => {
    await configureAuth(TEST_TOKEN);

    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({
      success: false,
      error: 'rate limited',
    }, 429)) as unknown as typeof fetch);

    const { report } = await import('../src/commands/report');
    const result = await runCommand(() => report('testowner/demo', { reason: 'security' }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('rate limited');
  });
});
