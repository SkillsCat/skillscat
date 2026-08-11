import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('../src/lib/server/cache');
  vi.doUnmock('../src/lib/server/github-client/rest');
});

describe('parseSkillFilesInput', () => {
  it('normalizes valid slugs', async () => {
    const { parseSkillFilesInput } = await import('../src/lib/server/skill/files');
    expect(parseSkillFilesInput({ slug: ' backrunner/react-skill ' })).toEqual({
      slug: 'backrunner/react-skill',
    });
  });

  it('rejects invalid slugs', async () => {
    const { parseSkillFilesInput } = await import('../src/lib/server/skill/files');
    expect(parseSkillFilesInput({ slug: '' })).toBeNull();
    expect(parseSkillFilesInput({ slug: '../secret' })).toBeNull();
  });

  it('refreshes root GitHub skills with companion text files when cache is incomplete', async () => {
    const underlyingGetMany = vi.fn(async (keys: string[]) => keys.map(() => null));
    const durableRateLimitKv = {
      get: vi.fn(async () => null),
      getMany: underlyingGetMany,
      put: vi.fn(async () => undefined),
      putIfChanged: vi.fn(async (_key: string, value: string) => ({ written: true, value })),
      delete: vi.fn(async () => undefined),
    } as unknown as KVNamespace;
    const observeRateLimitState = async (options?: { rateLimitKV?: KVNamespace }) => {
      const store = options?.rateLimitKV as KVNamespace & {
        getMany(keys: string[]): Promise<(string | null)[]>;
      };
      await store.getMany(['github:rate-limit:rest:test-token']);
    };

    vi.doMock('../src/lib/server/cache', () => ({
      getCached: async <T>(_key: string, fetcher: () => Promise<T>) => ({
        data: await fetcher(),
        hit: false,
      }),
    }));
    vi.doMock('../src/lib/server/github-client/rest', () => ({
      getRepo: vi.fn(async (_owner: string, _repo: string, options?: { rateLimitKV?: KVNamespace }) => {
        await observeRateLimitState(options);
        return {
          ok: true,
          json: async () => ({ default_branch: 'main' }),
        };
      }),
      getCommitByRef: vi.fn(async (
        _owner: string,
        _repo: string,
        _ref: string,
        options?: { rateLimitKV?: KVNamespace }
      ) => {
        await observeRateLimitState(options);
        return {
          ok: true,
          json: async () => ({ sha: 'head-sha' }),
        };
      }),
      getTreeRecursive: vi.fn(async (
        _owner: string,
        _repo: string,
        _ref: string,
        options?: { rateLimitKV?: KVNamespace }
      ) => {
        await observeRateLimitState(options);
        return {
          ok: true,
          json: async () => ({
            tree: [
              { path: 'SKILL.md', type: 'blob', sha: 'skill-md', size: 7 },
              { path: 'templates/prompt.txt', type: 'blob', sha: 'prompt', size: 6 },
              { path: 'subskill/SKILL.md', type: 'blob', sha: 'subskill-skill', size: 11 },
              { path: 'subskill/extra.txt', type: 'blob', sha: 'subskill-extra', size: 10 },
            ],
          }),
        };
      }),
      getBlob: vi.fn(async (
        _owner: string,
        _repo: string,
        sha: string,
        options?: { rateLimitKV?: KVNamespace }
      ) => {
        await observeRateLimitState(options);
        return {
          ok: true,
          json: async () => ({
            content: ({
              'skill-md': btoa('# Demo'),
              prompt: btoa('Prompt'),
              'subskill-skill': btoa('# Subskill'),
              'subskill-extra': btoa('Child file'),
            })[sha],
          }),
        };
      }),
    }));
    const { resolveSkillFiles } = await import('../src/lib/server/skill/files');

    const skillRow = {
      id: 'skill-1',
      name: 'Demo Skill',
      slug: 'demo/demo-skill',
      source_type: 'github',
      repo_owner: 'demo',
      repo_name: 'repo',
      skill_path: null,
      readme: '# Demo',
      visibility: 'public',
      last_commit_at: null,
      indexed_at: 1710000000000,
      updated_at: 1710000000000,
      file_structure: JSON.stringify({
        files: [
          { path: 'SKILL.md', type: 'text' },
          { path: 'templates/prompt.txt', type: 'text' },
          { path: 'subskill/SKILL.md', type: 'text' },
          { path: 'subskill/extra.txt', type: 'text' },
        ],
      }),
    };
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => skillRow,
            };
          },
        };
      },
    } as unknown as D1Database;

    const cachedEntries: Record<string, string> = {
      'skills/github/demo/repo/_root_/SKILL.md': '# Demo',
    };
    const writtenEntries: Record<string, string> = {};
    const r2 = {
      async list(options?: { prefix?: string; limit?: number }) {
        const prefix = options?.prefix ?? '';
        const objects = Object.keys(cachedEntries)
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({
            key,
            size: new TextEncoder().encode(cachedEntries[key]).byteLength,
          })) as R2Object[];

        return {
          objects,
          truncated: false,
          cursor: undefined,
        } as R2Objects;
      },
      async get(key: string) {
        const content = cachedEntries[key] ?? writtenEntries[key];
        if (content === undefined) return null;

        return {
          async text() {
            return content;
          },
        } as R2ObjectBody;
      },
      async head(key: string) {
        if (!(key in cachedEntries) && !(key in writtenEntries)) {
          return null;
        }

        return {
          customMetadata: {
            commitSha: 'head-sha',
          },
        } as R2Object;
      },
      async put(key: string, value: string) {
        writtenEntries[key] = value;
      },
    } as unknown as R2Bucket;

    const result = await resolveSkillFiles({
      db,
      r2,
      githubToken: 'token',
      githubRateLimitKV: durableRateLimitKv,
      request: new Request('https://skills.cat/api/skills/demo/demo-skill/files'),
      locals: {} as App.Locals,
    }, {
      slug: 'demo/demo-skill',
    });

    expect(result.data.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'templates/prompt.txt',
      'subskill/SKILL.md',
      'subskill/extra.txt',
    ]);
    expect(writtenEntries['skills/github/demo/repo/_root_/templates/prompt.txt']).toBe('Prompt');
    expect(writtenEntries['skills/github/demo/repo/_root_/subskill/extra.txt']).toBe('Child file');
    expect(underlyingGetMany).toHaveBeenCalledOnce();
  });

  it('serves a complete indexed R2 bundle without synchronously refreshing GitHub', async () => {
    vi.doMock('../src/lib/server/cache', () => ({
      getCached: async <T>(_key: string, fetcher: () => Promise<T>) => ({
        data: await fetcher(),
        hit: false,
      }),
    }));
    vi.doMock('../src/lib/server/github-client/rest', () => ({
      getRepo: vi.fn(),
      getCommitByRef: vi.fn(),
      getTreeRecursive: vi.fn(),
      getBlob: vi.fn(),
    }));

    const rest = await import('../src/lib/server/github-client/rest');
    const { resolveSkillFiles } = await import('../src/lib/server/skill/files');
    const skillRow = {
      id: 'skill-1',
      name: 'Demo Skill',
      slug: 'demo/demo-skill',
      source_type: 'github',
      repo_owner: 'demo',
      repo_name: 'repo',
      skill_path: null,
      readme: '# Demo',
      visibility: 'public',
      file_structure: JSON.stringify({
        files: [{ path: 'SKILL.md', type: 'text' }],
      }),
    };
    const db = {
      prepare() {
        return {
          bind() {
            return { first: async () => skillRow };
          },
        };
      },
    } as unknown as D1Database;
    const r2 = {
      async list(options?: { prefix?: string }) {
        const prefix = options?.prefix ?? '';
        return {
          objects: [{ key: `${prefix}SKILL.md`, size: 6 }],
          truncated: false,
        } as R2Objects;
      },
      async get() {
        return { text: async () => '# Demo' } as R2ObjectBody;
      },
    } as unknown as R2Bucket;

    const result = await resolveSkillFiles({
      db,
      r2,
      githubToken: 'token',
      request: new Request('https://skills.cat/api/skills/demo/demo-skill/files'),
      locals: {} as App.Locals,
    }, { slug: 'demo/demo-skill' });

    expect(result.data.files).toEqual([{ path: 'SKILL.md', content: '# Demo' }]);
    expect(rest.getRepo).not.toHaveBeenCalled();
    expect(rest.getCommitByRef).not.toHaveBeenCalled();
    expect(rest.getTreeRecursive).not.toHaveBeenCalled();
    expect(rest.getBlob).not.toHaveBeenCalled();
  });
});
