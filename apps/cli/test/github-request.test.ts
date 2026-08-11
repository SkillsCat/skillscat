import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubRequest } from '../src/utils/core/github-request';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GitHub request policy', () => {
  it('uses the standard CLI GitHub token environment variables for API calls', async () => {
    vi.stubEnv('GH_TOKEN', 'cli-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await githubRequest('https://api.github.com/repos/skillscat/demo');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer cli-token');
  });

  it('does not send a GitHub API token to raw.githubusercontent.com', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'cli-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('raw file', { status: 200 })
    );

    await githubRequest('https://raw.githubusercontent.com/skillscat/demo/main/SKILL.md');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('returns a rate-limit response without retrying before reset', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"rate limited"}', {
        status: 403,
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetAt),
        },
      })
    );

    const response = await githubRequest('https://api.github.com/repos/skillscat/demo');

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
