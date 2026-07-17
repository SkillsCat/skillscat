import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitHubGraphqlError, githubGraphqlRequest } from '../src/lib/server/github-client/graphql';
import { graphqlBatchRepoMetadata, graphqlRepoResurrectionMetadata } from '../src/lib/server/github-client/queries';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('githubGraphqlRequest', () => {
  it('throws on GraphQL errors by default even when partial data is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: { repository: null },
      errors: [{ message: "Could not resolve to a Repository with the name 'Olino3/forge'." }],
    }));

    await expect(
      githubGraphqlRequest<{ repository: null }>('query { repository { id } }')
    ).rejects.toBeInstanceOf(GitHubGraphqlError);
  });

  it('returns partial data when allowPartialData is enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: { repository: null },
      errors: [{ message: "Could not resolve to a Repository with the name 'Olino3/forge'." }],
    }));

    const result = await githubGraphqlRequest<{ repository: null }>(
      'query { repository { id } }',
      undefined,
      { allowPartialData: true }
    );

    expect(result.data).toEqual({ repository: null });
    expect(result.errors).toHaveLength(1);
  });

  it('still throws when allowPartialData is enabled for non-not-found errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: { repository: null },
      errors: [{ message: 'Something went wrong resolving repository topics.' }],
    }));

    await expect(
      githubGraphqlRequest<{ repository: null }>(
        'query { repository { id } }',
        undefined,
        { allowPartialData: true }
      )
    ).rejects.toBeInstanceOf(GitHubGraphqlError);
  });
});

describe('repo metadata queries', () => {
  it('keeps successful batch results when one repository cannot be resolved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: {
        repo0: {
          stargazerCount: 42,
          forkCount: 7,
          pushedAt: '2026-03-01T00:00:00Z',
          description: 'ok',
          repositoryTopics: { nodes: [] },
        },
        repo1: null,
      },
      errors: [{
        message: "Could not resolve to a Repository with the name 'Olino3/forge'.",
        path: ['repo1'],
      }],
    }));

    const result = await graphqlBatchRepoMetadata([
      { owner: 'good', name: 'repo', id: 'skill-good' },
      { owner: 'Olino3', name: 'forge', id: 'skill-missing' },
    ], {
      token: 'test-token',
    });

    expect(result.size).toBe(1);
    expect(result.get('skill-good')).toMatchObject({
      stargazerCount: 42,
      forkCount: 7,
      pushedAt: '2026-03-01T00:00:00Z',
    });
    expect(result.has('skill-missing')).toBe(false);
  });

  it('dedupes repeated repositories while mapping metadata to every requested id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: {
        repo0: {
          stargazerCount: 42,
          forkCount: 7,
          pushedAt: '2026-03-01T00:00:00Z',
        },
      },
    }));

    const result = await graphqlBatchRepoMetadata([
      { owner: 'Good', name: 'Repo', id: 'skill-root' },
      { owner: 'good', name: 'repo', id: 'skill-nested' },
    ], {
      token: 'test-token',
      includeExtendedMetadata: false,
    });

    expect(result.get('skill-root')?.stargazerCount).toBe(42);
    expect(result.get('skill-nested')?.stargazerCount).toBe(42);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { query: string };
    expect(body.query.match(/repository\(owner:/g)).toHaveLength(1);
    expect(body.query).not.toContain('repositoryTopics');
  });

  it('keeps completed chunks when a later metadata chunk fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: {
          repo0: {
            stargazerCount: 42,
            forkCount: 7,
            pushedAt: '2026-03-01T00:00:00Z',
          },
        },
      }))
      .mockRejectedValueOnce(new Error('upstream unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const repos = Array.from({ length: 51 }, (_, index) => ({
      owner: 'good',
      name: `repo-${index}`,
      id: `skill-${index}`,
    }));
    const result = await graphqlBatchRepoMetadata(repos, {
      token: 'test-token',
      includeExtendedMetadata: false,
      continueOnChunkError: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.get('skill-0')?.stargazerCount).toBe(42);
    expect(result.has('skill-50')).toBe(false);
  });

  it('returns null for unresolved resurrection metadata queries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: { repository: null },
      errors: [{ message: "Could not resolve to a Repository with the name 'Olino3/forge'." }],
    }));

    await expect(
      graphqlRepoResurrectionMetadata('Olino3', 'forge', { token: 'test-token' })
    ).resolves.toBeNull();
  });
});
