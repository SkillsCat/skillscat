import { DatabaseSync } from 'node:sqlite';

import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  default as indexingWorker,
  determineSkillVersionRelationType,
  extractStoredFileShas,
  getExistingSkillSnapshot,
  getGitHubPathCommitCreatedAt,
  getLatestCommitSha,
  getRepositoryTree,
  getSkillCommitDates,
  getSkillMd,
  getStoredSourceCommitSha,
  mergeSkillPersistenceMetadata,
  queueDiscoveredSkillPaths,
  resolveVisibleSkillOriginMetadata,
} from '../workers/indexing';
import type { IndexingMessage } from '../workers/shared/types';
import { PublicGitHubRepositoryReader } from '../src/lib/server/github-client/public-web';

afterEach(() => {
  vi.restoreAllMocks();
});

class SqliteD1Statement {
  private params: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

class SqliteD1Database {
  public prepareCalls = 0;

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    this.prepareCalls += 1;
    return new SqliteD1Statement(this.db, sql);
  }
}

class MemoryKv {
  private readonly store = new Map<string, string>();
  putCalls = 0;
  deleteCalls = 0;

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.putCalls += 1;
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.deleteCalls += 1;
    this.store.delete(key);
  }
}

function createIndexingMessage(): IndexingMessage {
  return {
    type: 'check_skill',
    repoOwner: 'backrunner',
    repoName: 'skillscat',
  };
}

describe('indexing worker snapshot lookup', () => {
  it('loads the stored skill snapshot in one query and reuses file_structure data', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL,
        source_type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        repo_owner TEXT,
        repo_name TEXT,
        skill_path TEXT,
        stars INTEGER NOT NULL,
        commit_sha TEXT,
        file_structure TEXT,
        last_commit_at INTEGER,
        skill_md_first_commit_at INTEGER,
        repo_created_at INTEGER,
        created_at INTEGER NOT NULL,
        indexed_at INTEGER
      );
    `);
    sqlite.prepare(`
      INSERT INTO skills (
        id, slug, source_type, visibility, repo_owner, repo_name, skill_path, stars,
        commit_sha, file_structure, last_commit_at, skill_md_first_commit_at,
        repo_created_at, created_at, indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'skill-1',
      'backrunner/skillscat/cursor',
      'github',
      'public',
      'backrunner',
      'skillscat',
      'agents/cursor',
      42,
      'sha-123',
      JSON.stringify({
        files: [
          { path: 'SKILL.md', sha: 'blob-skill' },
          { path: 'README.md', sha: 'blob-readme' },
        ],
      }),
      1710000000000,
      1700000000000,
      1690000000000,
      1680000000000,
      1715000000000
    );

    const db = new SqliteD1Database(sqlite);
    const snapshot = await getExistingSkillSnapshot(
      'backrunner',
      'skillscat',
      'agents/cursor',
      { DB: db } as never
    );

    expect(db.prepareCalls).toBe(1);
    expect(snapshot).toEqual(expect.objectContaining({
      id: 'skill-1',
      slug: 'backrunner/skillscat/cursor',
      sourceType: 'github',
      visibility: 'public',
      repoOwner: 'backrunner',
      repoName: 'skillscat',
      skillPath: 'agents/cursor',
      stars: 42,
      commitSha: 'sha-123',
      lastCommitAt: 1710000000000,
      skillMdFirstCommitAt: 1700000000000,
      repoCreatedAt: 1690000000000,
      createdAt: 1680000000000,
      indexedAt: 1715000000000,
      fileStructure: JSON.stringify({
        files: [
          { path: 'SKILL.md', sha: 'blob-skill' },
          { path: 'README.md', sha: 'blob-readme' },
        ],
      }),
    }));

    expect(
      Array.from(extractStoredFileShas(snapshot?.fileStructure || null, 'backrunner/skillscat').entries())
    ).toEqual([
      ['SKILL.md', 'blob-skill'],
      ['README.md', 'blob-readme'],
    ]);
  });
});

describe('indexing worker commit timestamp selection', () => {
  it('prefers author date when deriving the first SKILL.md commit timestamp', () => {
    expect(getGitHubPathCommitCreatedAt({
      commit: {
        author: { date: '2024-01-02T03:04:05Z' },
        committer: { date: '2024-02-03T04:05:06Z' },
      },
    })).toBe(Date.parse('2024-01-02T03:04:05Z'));
  });

  it('falls back to committer date when author date is missing', () => {
    expect(getGitHubPathCommitCreatedAt({
      commit: {
        author: null,
        committer: { date: '2024-02-03T04:05:06Z' },
      },
    })).toBe(Date.parse('2024-02-03T04:05:06Z'));
  });
});

describe('indexing worker commit pinning', () => {
  it('pins Contents, Tree, and commit history requests to the same commit SHA', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      calls.push(url);

      if (url === `https://api.github.com/repos/octocat/skills/contents/demo/SKILL.md?ref=${commitSha}`) {
        return new Response(JSON.stringify({
          name: 'SKILL.md',
          path: 'demo/SKILL.md',
          sha: 'blob-sha',
          size: 7,
          url,
          html_url: '',
          git_url: '',
          download_url: '',
          type: 'file',
          content: 'IyBEZW1v',
          encoding: 'base64',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `https://api.github.com/repos/octocat/skills/git/trees/${commitSha}?recursive=1`) {
        return new Response(JSON.stringify({
          sha: 'tree-sha',
          tree: [],
          truncated: false,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === `https://api.github.com/repos/octocat/skills/commits?sha=${commitSha}&per_page=1&path=demo%2FSKILL.md`) {
        return new Response(JSON.stringify([{
          sha: commitSha,
          commit: {
            author: { date: '2026-01-02T03:04:05Z' },
            committer: { date: '2026-02-03T04:05:06Z' },
          },
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const env = { GITHUB_TOKEN: 'test-token' } as never;
    await getSkillMd('octocat', 'skills', commitSha, env, 'demo');
    await getRepositoryTree('octocat', 'skills', commitSha, env);
    await getSkillCommitDates('octocat', 'skills', 'demo/SKILL.md', commitSha, env);

    expect(calls).toEqual([
      `https://api.github.com/repos/octocat/skills/contents/demo/SKILL.md?ref=${commitSha}`,
      `https://api.github.com/repos/octocat/skills/git/trees/${commitSha}?recursive=1`,
      `https://api.github.com/repos/octocat/skills/commits?sha=${commitSha}&per_page=1&path=demo%2FSKILL.md`,
    ]);
  });

  it('downloads the pinned ZIP before falling back to raw file reads', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const apiCalls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      apiCalls.push(url);
      return new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
          'x-ratelimit-remaining': '0',
        },
      });
    });

    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: { name: 'main', refType: 'branch', currentOid: commitSha },
          tree: {
            items: [{ path: 'demo', contentType: 'directory' }],
            totalCount: 1,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'skills',
            ownerLogin: 'octocat',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'skills',
          ownerLogin: 'octocat',
          stargazerCount: 0,
          forksCount: 0,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const archive = zipSync({
      [`skills-${commitSha}/demo/SKILL.md`]: strToU8('# Demo\n'),
    });
    const publicCalls: string[] = [];
    const publicReader = new PublicGitHubRepositoryReader('octocat', 'skills', {
      cache: false,
      expectedHeadSha: commitSha,
      fetch: vi.fn(async (input) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        publicCalls.push(url);
        if (url === 'https://github.com/octocat/skills') {
          return new Response(repositoryHtml);
        }
        if (url === `https://codeload.github.com/octocat/skills/zip/${commitSha}`) {
          return new Response(Uint8Array.from(archive).buffer);
        }
        throw new Error(`Unexpected public GitHub request: ${url}`);
      }) as typeof fetch,
    });

    const skillMd = await getSkillMd(
      'octocat',
      'skills',
      commitSha,
      { GITHUB_TOKEN: 'test-token' } as never,
      'demo',
      publicReader
    );

    expect(skillMd).toMatchObject({ path: 'demo/SKILL.md', type: 'file' });
    expect(skillMd?.content ? atob(skillMd.content) : '').toBe('# Demo\n');
    expect(apiCalls).toEqual([
      `https://api.github.com/repos/octocat/skills/contents/demo/SKILL.md?ref=${commitSha}`,
      'https://api.github.com/graphql',
    ]);
    expect(publicCalls).toEqual([
      'https://github.com/octocat/skills',
      `https://codeload.github.com/octocat/skills/zip/${commitSha}`,
    ]);
  });

  it('propagates failure when both latest-commit sources are unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ message: 'rate limited' }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
          'x-ratelimit-remaining': '0',
        },
      }
    ));
    const publicReader = new PublicGitHubRepositoryReader('octocat', 'skills', {
      cache: false,
      fetch: vi.fn(async () => new Response('unavailable', { status: 503 })) as typeof fetch,
    });

    await expect(getLatestCommitSha(
      'octocat',
      'skills',
      { GITHUB_TOKEN: 'test-token' } as never,
      'main',
      publicReader
    )).rejects.toMatchObject({ reason: 'request_failed' });
  });

  it('serves sha-pinned commit history through the GraphQL fallback when REST is rate limited', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      calls.push(url);

      if (url === 'https://api.github.com/graphql') {
        return new Response(JSON.stringify({
          data: {
            repository: {
              object: {
                __typename: 'Commit',
                history: {
                  nodes: [{ oid: commitSha, committedDate: '2026-02-03T04:05:06Z' }],
                },
              },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
          'x-ratelimit-remaining': '0',
        },
      });
    });

    const result = await getSkillCommitDates(
      'octocat',
      'skills',
      'demo/SKILL.md',
      commitSha,
      { GITHUB_TOKEN: 'test-token' } as never
    );

    expect(calls).toEqual([
      `https://api.github.com/repos/octocat/skills/commits?sha=${commitSha}&per_page=1&path=demo%2FSKILL.md`,
      'https://api.github.com/graphql',
    ]);
    // The GraphQL fallback only exposes the committer date, so the first
    // commit timestamp stays unknown instead of being guessed.
    expect(result).toEqual({
      lastCommitAt: Date.parse('2026-02-03T04:05:06Z'),
      firstCommitAt: null,
    });
  });

  it('captures ZIP contents per basePath when one reader serves multiple skill paths', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ message: 'rate limited' }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
          'x-ratelimit-remaining': '0',
        },
      }
    ));

    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: { name: 'main', refType: 'branch', currentOid: commitSha },
          tree: {
            items: [{ path: 'skills', contentType: 'directory' }],
            totalCount: 1,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'skills',
            ownerLogin: 'octocat',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'skills',
          ownerLogin: 'octocat',
          stargazerCount: 0,
          forksCount: 0,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const archive = zipSync({
      [`skills-${commitSha}/skills/alpha/SKILL.md`]: strToU8('# Alpha\n'),
      [`skills-${commitSha}/skills/beta/SKILL.md`]: strToU8('# Beta\n'),
    });
    const publicCalls: string[] = [];
    const publicReader = new PublicGitHubRepositoryReader('octocat', 'skills', {
      cache: false,
      expectedHeadSha: commitSha,
      fetch: vi.fn(async (input) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        publicCalls.push(url);
        if (url === 'https://github.com/octocat/skills') {
          return new Response(repositoryHtml);
        }
        if (url === `https://codeload.github.com/octocat/skills/zip/${commitSha}`) {
          return new Response(Uint8Array.from(archive).buffer);
        }
        throw new Error(`Unexpected public GitHub request: ${url}`);
      }) as typeof fetch,
    });

    const env = { GITHUB_TOKEN: 'test-token' } as never;
    const alphaTree = await getRepositoryTree('octocat', 'skills', commitSha, env, publicReader, 'skills/alpha');
    const betaTree = await getRepositoryTree('octocat', 'skills', commitSha, env, publicReader, 'skills/beta');

    expect(alphaTree.publicSnapshot?.capturedFiles.has('skills/alpha/SKILL.md')).toBe(true);
    expect(alphaTree.publicSnapshot?.capturedFiles.has('skills/beta/SKILL.md')).toBe(false);
    expect(betaTree.publicSnapshot?.capturedFiles.has('skills/beta/SKILL.md')).toBe(true);
    // One metadata page plus one ZIP download per capture scope.
    expect(publicCalls).toEqual([
      'https://github.com/octocat/skills',
      `https://codeload.github.com/octocat/skills/zip/${commitSha}`,
      `https://codeload.github.com/octocat/skills/zip/${commitSha}`,
    ]);
  });
});

describe('indexing worker persistence metadata merge', () => {
  it('keeps the earliest known creation timestamps for an existing skill', () => {
    expect(mergeSkillPersistenceMetadata({
      lastCommitAt: 1_710_000_000_000,
      skillMdFirstCommitAt: 1_700_000_000_000,
      repoCreatedAt: 1_690_000_000_000,
    }, {
      contentHash: 'hash-next',
      lastCommitAt: null,
      skillMdFirstCommitAt: 1_720_000_000_000,
      repoCreatedAt: 1_695_000_000_000,
    })).toEqual({
      contentHash: 'hash-next',
      lastCommitAt: 1_710_000_000_000,
      skillMdFirstCommitAt: 1_700_000_000_000,
      repoCreatedAt: 1_690_000_000_000,
    });
  });

  it('accepts newly discovered earlier timestamps from a reindex', () => {
    expect(mergeSkillPersistenceMetadata({
      lastCommitAt: 1_710_000_000_000,
      skillMdFirstCommitAt: 1_700_000_000_000,
      repoCreatedAt: 1_690_000_000_000,
    }, {
      contentHash: 'hash-next',
      lastCommitAt: 1_715_000_000_000,
      skillMdFirstCommitAt: 1_680_000_000_000,
      repoCreatedAt: 1_685_000_000_000,
    })).toEqual({
      contentHash: 'hash-next',
      lastCommitAt: 1_715_000_000_000,
      skillMdFirstCommitAt: 1_680_000_000_000,
      repoCreatedAt: 1_685_000_000_000,
    });
  });
});

describe('indexing worker lineage helpers', () => {
  it('prefers the source current commit sha over the last version commit sha', () => {
    expect(getStoredSourceCommitSha({
      currentCommitSha: 'sha-current',
      latestVersionCommitSha: 'sha-old-version',
    })).toBe('sha-current');
  });

  it('marks a source as modified when its current snapshot differs from the lineage root', () => {
    expect(determineSkillVersionRelationType({
      sourceId: 'source-copy',
      currentSnapshotId: 'snapshot-modified',
      lineageRootSnapshotId: 'snapshot-origin',
      canonicalSourceId: 'source-copy',
    })).toBe('modified_from');
  });

  it('marks an unchanged copied snapshot as a historical copy', () => {
    expect(determineSkillVersionRelationType({
      sourceId: 'source-copy',
      currentSnapshotId: 'snapshot-origin',
      lineageRootSnapshotId: 'snapshot-origin',
      canonicalSourceId: 'source-original',
    })).toBe('historical_copy_of');
  });

  it('returns canonical when the source still owns its root snapshot', () => {
    expect(determineSkillVersionRelationType({
      sourceId: 'source-original',
      currentSnapshotId: 'snapshot-origin',
      lineageRootSnapshotId: 'snapshot-origin',
      canonicalSourceId: 'source-original',
    })).toBe('canonical');
  });

  it('only surfaces origin metadata when the visible skill truly derives from another source', () => {
    expect(resolveVisibleSkillOriginMetadata({
      sourceId: 'source-copy',
      currentSnapshotId: 'snapshot-modified',
      lineageRootSnapshotId: 'snapshot-origin',
      lineageRootSnapshot: {
        canonicalSourceId: 'source-original',
        canonicalSkillId: 'skill-original',
        canonicalSlug: 'origin/toolbox/claude',
        canonicalRepoOwner: 'origin',
        canonicalRepoName: 'toolbox',
        canonicalSkillPath: '.claude',
        canonicalCommitSha: 'sha-origin',
      },
    })).toEqual({
      originSkillId: 'skill-original',
      originSlug: 'origin/toolbox/claude',
      originRepoOwner: 'origin',
      originRepoName: 'toolbox',
      originSkillPath: '.claude',
      originCommitSha: 'sha-origin',
      originRelationType: 'modified_from',
    });

    expect(resolveVisibleSkillOriginMetadata({
      sourceId: 'source-original',
      currentSnapshotId: 'snapshot-origin',
      lineageRootSnapshotId: 'snapshot-origin',
      lineageRootSnapshot: {
        canonicalSourceId: 'source-original',
        canonicalSkillId: 'skill-original',
        canonicalSlug: 'origin/toolbox/claude',
        canonicalRepoOwner: 'origin',
        canonicalRepoName: 'toolbox',
        canonicalSkillPath: '.claude',
        canonicalCommitSha: 'sha-origin',
      },
    })).toEqual({
      originSkillId: null,
      originSlug: null,
      originRepoOwner: null,
      originRepoName: null,
      originSkillPath: null,
      originCommitSha: null,
      originRelationType: null,
    });
  });
});

describe('queueDiscoveredSkillPaths', () => {
  it('suppresses duplicate discovered path enqueues while the first batch is still pending', async () => {
    const kv = new MemoryKv();
    const send = vi.fn(async () => undefined);

    const queuedFirst = await queueDiscoveredSkillPaths(
      createIndexingMessage(),
      'backrunner',
      'skillscat',
      'sha-123',
      ['agents/cursor', 'agents/opencode'],
      {
        KV: kv,
        INDEXING_QUEUE: { send },
      } as never
    );

    const queuedSecond = await queueDiscoveredSkillPaths(
      createIndexingMessage(),
      'backrunner',
      'skillscat',
      'sha-123',
      ['agents/cursor', 'agents/opencode'],
      {
        KV: kv,
        INDEXING_QUEUE: { send },
      } as never
    );

    expect(queuedFirst).toBe(2);
    expect(queuedSecond).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({
      skillPath: 'agents/cursor',
      queuedAsPending: true,
    }));
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      skillPath: 'agents/opencode',
      queuedAsPending: true,
    }));
  });

  it('clears the pending marker when enqueue fails so the path can be retried', async () => {
    const kv = new MemoryKv();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(
      queueDiscoveredSkillPaths(
        createIndexingMessage(),
        'backrunner',
        'skillscat',
        'sha-123',
        ['agents/cursor'],
        {
          KV: kv,
          INDEXING_QUEUE: { send },
        } as never
      )
    ).rejects.toThrow('queue unavailable');

    await expect(
      queueDiscoveredSkillPaths(
        createIndexingMessage(),
        'backrunner',
        'skillscat',
        'sha-123',
        ['agents/cursor'],
        {
          KV: kv,
          INDEXING_QUEUE: { send },
        } as never
      )
    ).resolves.toBe(1);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('skips pending KV markers for force reindex discovered paths', async () => {
    const kv = new MemoryKv();
    const send = vi.fn(async () => undefined);

    const queued = await queueDiscoveredSkillPaths(
      {
        ...createIndexingMessage(),
        forceReindex: true,
      },
      'backrunner',
      'skillscat',
      'sha-123',
      ['agents/cursor'],
      {
        KV: kv,
        INDEXING_QUEUE: { send },
      } as never
    );

    expect(queued).toBe(1);
    expect(kv.putCalls).toBe(0);
    expect(kv.deleteCalls).toBe(0);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      skillPath: 'agents/cursor',
      forceReindex: true,
      queuedAsPending: false,
    }));
  });

  it('lets a pending-backed duplicate clean up its marker after a non-pending message processed first', async () => {
    const kv = new MemoryKv();
    const processedKey = 'indexing:processed:backrunner/skillscat:agents/cursor:sha-123';
    const pendingKey = 'indexing:pending:backrunner/skillscat:agents/cursor:sha-123';
    await kv.put(processedKey, '1');
    await kv.put(pendingKey, '1');
    kv.putCalls = 0;
    kv.deleteCalls = 0;

    const repoResponse = {
      fork: false,
      owner: { login: 'backrunner' },
      name: 'skillscat',
      stargazers_count: 10,
      forks_count: 1,
      default_branch: 'main',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (rawUrl === 'https://api.github.com/repos/backrunner/skillscat') {
        return new Response(JSON.stringify(repoResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (rawUrl === 'https://api.github.com/repos/backrunner/skillscat/commits/main') {
        return new Response(JSON.stringify({ sha: 'sha-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected GitHub request: ${rawUrl}`);
    });

    const ackFirst = vi.fn();
    const ackSecond = vi.fn();
    const retryFirst = vi.fn();
    const retrySecond = vi.fn();

    await indexingWorker.queue({
      messages: [
        {
          id: 'msg-non-pending',
          body: {
            type: 'check_skill',
            repoOwner: 'backrunner',
            repoName: 'skillscat',
            skillPath: 'agents/cursor',
          },
          ack: ackFirst,
          retry: retryFirst,
        },
        {
          id: 'msg-pending',
          body: {
            type: 'check_skill',
            repoOwner: 'backrunner',
            repoName: 'skillscat',
            skillPath: 'agents/cursor',
            queuedAsPending: true,
          },
          ack: ackSecond,
          retry: retrySecond,
        },
      ],
    } as never, {
      KV: kv,
      GITHUB_TOKEN: 'token-a',
    } as never, {} as never);

    expect(ackFirst).toHaveBeenCalledTimes(1);
    expect(ackSecond).toHaveBeenCalledTimes(1);
    expect(retryFirst).not.toHaveBeenCalled();
    expect(retrySecond).not.toHaveBeenCalled();
    await expect(kv.get(pendingKey)).resolves.toBeNull();
    expect(kv.deleteCalls).toBe(1);
  });
});
