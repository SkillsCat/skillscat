import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  buildPublicRepoSearchUrl,
  checkPublicSkillMdAtHead,
  fetchPublicSkillRepoSearchPage,
  parsePublicGitHubRepoSearchHtml,
  PublicRepoSearchError,
} from '../src/lib/server/github-client/public-search';

// 真实 github.com/search 仓库结果页(2026-08 curl 抓取),只保留嵌入 JSON script。
const fixtureHtml = readFileSync(
  fileURLToPath(new URL('./fixtures/github-search-repositories.html', import.meta.url)),
  'utf8'
);

function htmlResponse(html: string, status: number = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('parsePublicGitHubRepoSearchHtml', () => {
  it('parses the real GitHub repository search page fixture', () => {
    const results = parsePublicGitHubRepoSearchHtml(fixtureHtml);

    expect(results).toHaveLength(10);
    expect(results[0]).toEqual({
      owner: 'Punky971210',
      name: 'dsh-punky-swarm',
      stars: 0,
      description: 'expandable-coding-team and plugins on dsh',
    });
    for (const repo of results) {
      expect(repo.owner).toBeTruthy();
      expect(repo.name).toBeTruthy();
      expect(repo.owner).not.toContain('/');
      expect(repo.name).not.toContain('/');
    }
  });

  it('fails gracefully with schema_changed when the embedded JSON script is missing', () => {
    let error: unknown;
    try {
      parsePublicGitHubRepoSearchHtml('<html><body>no embedded data</body></html>');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PublicRepoSearchError);
    expect((error as PublicRepoSearchError).reason).toBe('schema_changed');
  });

  it('fails gracefully with schema_changed when blackbirdSearchRoute.results is gone', () => {
    const html = `<html><body><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: { blackbirdSearchRoute: {} },
    })}</script></body></html>`;

    let error: unknown;
    try {
      parsePublicGitHubRepoSearchHtml(html);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PublicRepoSearchError);
    expect((error as PublicRepoSearchError).reason).toBe('schema_changed');
  });

  it('skips malformed entries instead of failing the whole page', () => {
    const html = `<html><body><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        blackbirdSearchRoute: {
          results: [
            { repo: { repository: { owner_login: 'Acme', name: 'Toolkit' } }, followers: 12 },
            { repo: {} },
            { repo: { repository: { owner_login: 'Bad/Owner', name: 'X' } } },
          ],
        },
      },
    })}</script></body></html>`;

    expect(parsePublicGitHubRepoSearchHtml(html)).toEqual([
      { owner: 'Acme', name: 'Toolkit', stars: 12 },
    ]);
  });
});

describe('buildPublicRepoSearchUrl', () => {
  it('builds the repositories search URL sorted by recently updated', () => {
    const url = new URL(buildPublicRepoSearchUrl('SKILL.md in:readme', 2));
    expect(url.origin + url.pathname).toBe('https://github.com/search');
    expect(url.searchParams.get('q')).toBe('SKILL.md in:readme');
    expect(url.searchParams.get('type')).toBe('repositories');
    expect(url.searchParams.get('s')).toBe('updated');
    expect(url.searchParams.get('o')).toBe('desc');
    expect(url.searchParams.get('p')).toBe('2');
  });
});

describe('fetchPublicSkillRepoSearchPage', () => {
  it('fetches and parses a search page anonymously', async () => {
    const fetchMock = vi.fn(async () => htmlResponse(fixtureHtml));

    const results = await fetchPublicSkillRepoSearchPage({
      query: 'SKILL.md in:readme',
      fetch: fetchMock as never,
      cache: false,
    });

    expect(results).toHaveLength(10);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('https://github.com/search?')).toBe(true);
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toBe('SkillsCat/1.0');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });

  it('throws rate_limited on 429 without leaking into retry paths', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('rate limited', 429));

    await expect(fetchPublicSkillRepoSearchPage({
      query: 'SKILL.md in:readme',
      fetch: fetchMock as never,
      cache: false,
    })).rejects.toMatchObject({
      name: 'PublicRepoSearchError',
      reason: 'rate_limited',
      status: 429,
    });
  });
});

describe('checkPublicSkillMdAtHead', () => {
  it('returns true when raw/HEAD/SKILL.md resolves with 200', async () => {
    const fetchMock = vi.fn(async () => new Response('# skill', { status: 200 }));

    await expect(checkPublicSkillMdAtHead('Acme', 'Toolkit', {
      fetch: fetchMock as never,
      cache: false,
    })).resolves.toBe(true);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://github.com/Acme/Toolkit/raw/HEAD/SKILL.md');
  });

  it('returns false on 404 and other non-200 statuses', async () => {
    const notFound = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(checkPublicSkillMdAtHead('Acme', 'Nope', {
      fetch: notFound as never,
      cache: false,
    })).resolves.toBe(false);

    const redirected = vi.fn(async () => new Response('moved', { status: 500 }));
    await expect(checkPublicSkillMdAtHead('Acme', 'Broken', {
      fetch: redirected as never,
      cache: false,
    })).resolves.toBe(false);
  });
});
