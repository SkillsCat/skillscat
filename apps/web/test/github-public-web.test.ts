import { createHash } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import {
  parsePublicGitHubRepositoryHtml,
  PublicGitHubRepositoryReader,
  type PublicRepositoryEntry,
} from '../src/lib/server/github-client/public-web';

const OWNER = 'octocat';
const REPO = 'skill-repo';
const COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_COMMIT_SHA = 'fedcba9876543210fedcba9876543210fedcba98';

function embeddedHtml(payload: Record<string, unknown>): string {
  return `<html><body><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload })}</script></body></html>`;
}

function repositoryHtml(
  rootEntries: PublicRepositoryEntry[],
  rootTotalCount = rootEntries.length
): string {
  return embeddedHtml({
    codeViewRepoRoute: {
      refInfo: {
        name: 'main',
        refType: 'branch',
        currentOid: COMMIT_SHA,
      },
      tree: {
        items: rootEntries.map((entry) => ({
          path: entry.path,
          contentType: entry.type === 'tree' ? 'directory' : 'file',
        })),
        totalCount: rootTotalCount,
      },
    },
    codeViewLayoutRoute: {
      repo: {
        id: 123,
        name: REPO,
        ownerLogin: OWNER,
        ownerAvatar: 'https://avatars.githubusercontent.com/u/456?v=4',
        defaultBranch: 'main',
        createdAt: '2026-01-02T03:04:05Z',
        private: false,
        public: true,
        isOrgOwned: false,
        isFork: false,
      },
      refInfo: {
        name: 'main',
        refType: 'branch',
        currentOid: COMMIT_SHA,
      },
    },
    sidebarAbout: {
      repoName: REPO,
      ownerLogin: OWNER,
      description: 'A repository of skills',
      stargazerCount: 42,
      forksCount: 7,
      topics: [{ name: 'agents' }, { name: 'skills' }],
      repo: {
        ownerId: 456,
        ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
        isPrivate: false,
        isFork: false,
      },
    },
  });
}

function treeHtml(path: string, entries: PublicRepositoryEntry[]): string {
  return embeddedHtml({
    codeViewTreeRoute: {
      path,
      refInfo: { currentOid: COMMIT_SHA },
      tree: {
        items: entries.map((entry) => ({
          path: entry.path,
          contentType: entry.type === 'tree' ? 'directory' : 'file',
        })),
        totalCount: entries.length,
      },
    },
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

function createFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response
): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return handler(url, init);
  }) as unknown as typeof fetch;
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

describe('public GitHub repository reader', () => {
  it('parses the current repository embedded-data schema', () => {
    const metadata = parsePublicGitHubRepositoryHtml(
      repositoryHtml([
        { path: 'README.md', type: 'blob' },
        { path: 'skills', type: 'tree' },
      ]),
      OWNER,
      REPO
    );

    expect(metadata).toMatchObject({
      id: 123,
      name: REPO,
      ownerLogin: OWNER,
      ownerId: 456,
      defaultBranch: 'main',
      headSha: COMMIT_SHA,
      stars: 42,
      forks: 7,
      isFork: false,
      topics: ['agents', 'skills'],
    });
    expect(metadata.rootEntries).toEqual([
      { path: 'README.md', type: 'blob' },
      { path: 'skills', type: 'tree' },
    ]);
  });

  it('fails closed when critical public repository metadata is missing', () => {
    const html = repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]);
    const withoutVisibility = html
      .replace('"private":false,"public":true,', '')
      .replace('"isPrivate":false,', '');
    const withoutStars = html.replace('"stargazerCount":42,', '');

    expect(() => parsePublicGitHubRepositoryHtml(withoutVisibility, OWNER, REPO))
      .toThrow(expect.objectContaining({ reason: 'schema_changed' }));
    expect(() => parsePublicGitHubRepositoryHtml(withoutStars, OWNER, REPO))
      .toThrow(expect.objectContaining({ reason: 'schema_changed' }));
  });

  it('streams a pinned ZIP and captures files with Git blob SHAs', async () => {
    const skillMd = strToU8('# Demo\n');
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/skills/demo/SKILL.md`]: skillMd,
      [`${REPO}-${COMMIT_SHA}/skills/demo/references/guide.md`]: strToU8('Guide\n'),
    });
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'skills', type: 'tree' }]));
      }
      if (url === `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`) {
        return new Response(toArrayBuffer(archive), {
          headers: { 'Content-Type': 'application/zip' },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
    });

    const snapshot = await reader.getSnapshot({
      basePath: 'skills/demo',
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
    });
    const capturedSkillMd = await reader.getFile('skills/demo/SKILL.md', 1024);

    expect(snapshot.source).toBe('zip');
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'skills/demo', type: 'tree' }),
      expect.objectContaining({
        path: 'skills/demo/SKILL.md',
        type: 'blob',
        sha: gitBlobSha(skillMd),
      }),
    ]));
    expect(snapshot.capturedFiles.get('skills/demo/SKILL.md')).toMatchObject({
      size: skillMd.byteLength,
      blobSha: gitBlobSha(skillMd),
    });
    expect(capturedSkillMd?.bytes).toEqual(skillMd);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed when repository HEAD no longer matches the expected commit', async () => {
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      expectedHeadSha: OTHER_COMMIT_SHA,
    });

    await expect(reader.getMetadata()).rejects.toMatchObject({ reason: 'commit_mismatch' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('counts synthesized parent directories against the ZIP entry limit', async () => {
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/one/two/SKILL.md`]: strToU8('# Demo\n'),
    });
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      if (url === `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`) {
        return new Response(toArrayBuffer(archive));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      maxEntries: 2,
    });

    const snapshot = await reader.getSnapshot();

    expect(snapshot.source).toBe('html');
    expect(snapshot.diagnostics.zipFallbackReason).toBe('entry_limit');
    expect(snapshot.entries).toEqual([{ path: 'SKILL.md', type: 'blob' }]);
  });

  it('falls back from an oversized ZIP to recursive HTML tree pages', async () => {
    let zipBodyCancelled = false;
    const zipBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        zipBodyCancelled = true;
      },
    });
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'skills', type: 'tree' }]));
      }
      if (url === `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`) {
        return new Response(zipBody, { headers: { 'Content-Length': '1024' } });
      }
      if (url.endsWith(`/tree/${COMMIT_SHA}/skills`)) {
        return new Response(treeHtml('skills', [{ path: 'skills/demo', type: 'tree' }]));
      }
      if (url.endsWith(`/tree/${COMMIT_SHA}/skills/demo`)) {
        return new Response(treeHtml('skills/demo', [
          { path: 'skills/demo/SKILL.md', type: 'blob' },
        ]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      maxZipBytes: 8,
      maxHtmlPages: 4,
    });

    const snapshot = await reader.getSnapshot();

    expect(zipBodyCancelled).toBe(true);
    expect(snapshot.source).toBe('html');
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.diagnostics).toMatchObject({
      htmlPages: 3,
      zipFallbackReason: 'zip_too_large',
    });
    expect(snapshot.entries).toContainEqual({
      path: 'skills/demo/SKILL.md',
      type: 'blob',
    });
  });

  it('cancels a chunked ZIP as soon as streamed bytes exceed the limit', async () => {
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/SKILL.md`]: strToU8('# Demo\n'),
    });
    let cancelled = false;
    const zipBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(archive);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      if (url.includes('codeload.github.com')) {
        return new Response(zipBody);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      maxZipBytes: 8,
    });

    const snapshot = await reader.getSnapshot();

    expect(cancelled).toBe(true);
    expect(snapshot.source).toBe('html');
    expect(snapshot.diagnostics.zipFallbackReason).toBe('zip_too_large');
  });

  it('marks HTML scans truncated when the directory page budget is exhausted', async () => {
    const fetchedTreeUrls: string[] = [];
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([
          { path: 'alpha', type: 'tree' },
          { path: 'beta', type: 'tree' },
        ]));
      }
      if (url.includes('codeload.github.com')) {
        return new Response(new Uint8Array([0]), { headers: { 'Content-Length': '2' } });
      }
      if (url.includes(`/tree/${COMMIT_SHA}/`)) {
        fetchedTreeUrls.push(url);
        const path = url.endsWith('/alpha') ? 'alpha' : 'beta';
        return new Response(treeHtml(path, [{ path: `${path}/SKILL.md`, type: 'blob' }]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      maxZipBytes: 1,
      maxHtmlPages: 2,
      htmlConcurrency: 3,
    });

    const snapshot = await reader.getSnapshot();

    expect(snapshot.source).toBe('html');
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.diagnostics.htmlPages).toBe(2);
    expect(fetchedTreeUrls).toHaveLength(1);
  });

  it('fails closed when a recursive HTML page no longer has the expected schema', async () => {
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'skills', type: 'tree' }]));
      }
      if (url.includes('codeload.github.com')) {
        return new Response(new Uint8Array([0]), { headers: { 'Content-Length': '2' } });
      }
      if (url.includes(`/tree/${COMMIT_SHA}/skills`)) {
        return new Response('<html>GitHub changed this page</html>');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      maxZipBytes: 1,
    });

    await expect(reader.getSnapshot()).rejects.toMatchObject({ reason: 'schema_changed' });
  });

  it('pins raw and Atom requests to the commit and never forwards credentials', async () => {
    const skillMd = strToU8('# Demo\n');
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/SKILL.md`]: skillMd,
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = createFetch((url, init) => {
      calls.push({ url, init });
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      if (url === `https://raw.githubusercontent.com/${OWNER}/${REPO}/${COMMIT_SHA}/SKILL.md`) {
        return new Response(toArrayBuffer(skillMd));
      }
      if (url === `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`) {
        return new Response(toArrayBuffer(archive));
      }
      if (url === `https://github.com/${OWNER}/${REPO}/commits/${COMMIT_SHA}/SKILL.md.atom`) {
        return new Response('<feed><entry><updated>2026-07-08T09:10:11Z</updated></entry></feed>');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
    });

    const file = await reader.getFile('SKILL.md', 1024);
    await reader.getSnapshot();
    const latestCommitAt = await reader.getLatestCommitAt('SKILL.md');

    expect(file?.blobSha).toBe(gitBlobSha(skillMd));
    expect(latestCommitAt).toBe(Date.parse('2026-07-08T09:10:11Z'));
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${COMMIT_SHA}/SKILL.md`,
      `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`,
      `https://github.com/${OWNER}/${REPO}/commits/${COMMIT_SHA}/SKILL.md.atom`,
    ]));
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);
      expect(call.init?.credentials).toBe('omit');
    }
  });

  it('keeps the timeout active while consuming the response body', async () => {
    let aborted = false;
    const fetchImpl = createFetch((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            controller.error(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        },
      });
      return new Response(body);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      fetchTimeoutMs: 5,
    });

    await expect(reader.getMetadata()).rejects.toMatchObject({ reason: 'request_failed' });
    expect(aborted).toBe(true);
  });

  it('memoizes snapshots per capture scope so different basePaths capture independently', async () => {
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/skills/alpha/SKILL.md`]: strToU8('# Alpha\n'),
      [`${REPO}-${COMMIT_SHA}/skills/beta/SKILL.md`]: strToU8('# Beta\n'),
    });
    let zipDownloads = 0;
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'skills', type: 'tree' }]));
      }
      if (url === `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`) {
        zipDownloads++;
        return new Response(toArrayBuffer(archive));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
    });
    const capture = (basePath: string) => ({
      basePath,
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
    });

    const alphaSnapshot = await reader.getSnapshot(capture('skills/alpha'));
    const betaSnapshot = await reader.getSnapshot(capture('skills/beta'));
    const alphaAgain = await reader.getSnapshot(capture('skills/alpha'));

    expect(alphaSnapshot.capturedFiles.has('skills/alpha/SKILL.md')).toBe(true);
    expect(alphaSnapshot.capturedFiles.has('skills/beta/SKILL.md')).toBe(false);
    expect(betaSnapshot.capturedFiles.has('skills/beta/SKILL.md')).toBe(true);
    expect(alphaAgain).toBe(alphaSnapshot);
    expect(zipDownloads).toBe(2);

    // getFile sees bytes captured under any earlier capture scope.
    const betaFile = await reader.getFile('skills/beta/SKILL.md', 1024);
    expect(betaFile?.bytes).toEqual(strToU8('# Beta\n'));
    expect(zipDownloads).toBe(2);
  });

  it('keeps no-capture and whole-repo capture snapshots under distinct keys', async () => {
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/SKILL.md`]: strToU8('# Demo\n'),
    });
    let zipDownloads = 0;
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      if (url === `https://codeload.github.com/${OWNER}/${REPO}/zip/${COMMIT_SHA}`) {
        zipDownloads++;
        return new Response(toArrayBuffer(archive));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
    });
    const wholeRepoCapture = {
      basePath: null,
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
    };

    const plainSnapshot = await reader.getSnapshot();
    const capturedSnapshot = await reader.getSnapshot(wholeRepoCapture);

    // undefined (no capture) and { basePath: null } (capture everything)
    // are different scopes and must not share a memoized snapshot.
    expect(capturedSnapshot).not.toBe(plainSnapshot);
    expect(plainSnapshot.capturedFiles.size).toBe(0);
    expect(capturedSnapshot.capturedFiles.has('SKILL.md')).toBe(true);
    expect(zipDownloads).toBe(2);

    // Each scope still memoizes on its own key.
    expect(await reader.getSnapshot()).toBe(plainSnapshot);
    expect(await reader.getSnapshot(wholeRepoCapture)).toBe(capturedSnapshot);
    expect(zipDownloads).toBe(2);
  });

  it('abandons in-flight captures without hanging when the ZIP stream is cut short', async () => {
    const archive = zipSync({
      [`${REPO}-${COMMIT_SHA}/SKILL.md`]: strToU8('# Demo\n'),
    });
    const zipBody = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < archive.byteLength; offset += 32) {
          controller.enqueue(archive.subarray(offset, offset + 32));
        }
        controller.close();
      },
    });
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      if (url.includes('codeload.github.com')) {
        return new Response(zipBody);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      cache: false,
      // The local header fits in the first chunks, so the SKILL.md capture is
      // already in flight when the stream crosses the byte limit.
      maxZipBytes: 96,
    });

    const snapshot = await reader.getSnapshot({
      basePath: null,
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
    });

    expect(snapshot.source).toBe('html');
    expect(snapshot.diagnostics.zipFallbackReason).toBe('zip_too_large');
  });

  it('offloads cache writes to waitUntil when an execution context is provided', async () => {
    const pending: Promise<unknown>[] = [];
    const fetchImpl = createFetch((url) => {
      if (url === `https://github.com/${OWNER}/${REPO}`) {
        return new Response(repositoryHtml([{ path: 'SKILL.md', type: 'blob' }]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const reader = new PublicGitHubRepositoryReader(OWNER, REPO, {
      fetch: fetchImpl,
      waitUntil: (promise) => {
        pending.push(promise);
      },
    });

    const metadata = await reader.getMetadata();

    expect(metadata?.name).toBe(REPO);
    expect(pending).toHaveLength(1);
    // The detached cache write must settle without rejecting.
    await expect(pending[0]).resolves.toBeUndefined();
  });
});
