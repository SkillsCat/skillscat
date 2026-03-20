import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillDetail } from '../src/lib/types';

function createSkillDetail(overrides: Partial<SkillDetail>): SkillDetail {
  return {
    id: 'skill-1',
    name: 'Demo Skill',
    slug: 'demo-owner/demo-skill',
    description: 'Demo skill',
    repoOwner: 'demo-owner',
    repoName: 'demo-repo',
    stars: 0,
    forks: 0,
    trendingScore: 0,
    updatedAt: 1710000000000,
    categories: [],
    githubUrl: 'https://github.com/demo-owner/demo-repo',
    skillPath: '',
    readme: '# Demo',
    fileStructure: null,
    lastCommitAt: null,
    createdAt: 1710000000000,
    indexedAt: 1710000000000,
    visibility: 'public',
    sourceType: 'github',
    ...overrides,
  };
}

function createMockR2(entries: Record<string, string>): R2Bucket {
  const sortedKeys = Object.keys(entries).sort();

  return {
    async list(options?: { prefix?: string; cursor?: string }) {
      const prefix = options?.prefix ?? '';
      const filtered = sortedKeys.filter((key) => key.startsWith(prefix));
      const start = Number.parseInt(options?.cursor ?? '0', 10) || 0;
      const pageSize = 2;
      const slice = filtered.slice(start, start + pageSize);

      return {
        objects: slice.map((key) => ({
          key,
          size: new TextEncoder().encode(entries[key]).byteLength,
        })) as R2Object[],
        truncated: start + pageSize < filtered.length,
        cursor: String(start + pageSize),
      } as R2Objects;
    },
    async get(key: string) {
      if (!(key in entries)) return null;

      return {
        async arrayBuffer() {
          return new TextEncoder().encode(entries[key]).buffer;
        },
      } as R2ObjectBody;
    },
  } as unknown as R2Bucket;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../src/lib/server/github-client/rest');
});

describe('resolveOpenClawBundleFiles', () => {
  it('reads all upload bundle files from paginated R2 listings', async () => {
    const { resolveOpenClawBundleFiles } = await import('../src/lib/server/openclaw/bundle-files');
    const files = await resolveOpenClawBundleFiles({
      skill: createSkillDetail({
        slug: 'demo-owner/demo-skill',
        sourceType: 'upload',
        repoOwner: 'demo-owner',
        repoName: 'demo-skill',
      }),
      r2: createMockR2({
        'skills/demo-owner/demo-skill/SKILL.md': '# Demo',
        'skills/demo-owner/demo-skill/templates/prompt.txt': 'prompt',
        'skills/demo-owner/demo-skill/config/settings.json': '{"ok":true}',
      }),
    });

    expect(files.map((file) => file.path)).toEqual([
      'config/settings.json',
      'SKILL.md',
      'templates/prompt.txt',
    ]);
  });

  it('fetches root GitHub bundles from the repository tree instead of only returning SKILL.md', async () => {
    vi.doMock('../src/lib/server/github-client/rest', () => ({
      getRepo: vi.fn(async () => ({
        ok: true,
        json: async () => ({ default_branch: 'main' }),
      })),
      getTreeRecursive: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob', sha: 'skill-md' },
            { path: 'templates/prompt.txt', type: 'blob', sha: 'prompt' },
            { path: '.claude/commands/review.md', type: 'blob', sha: 'dot-companion' },
          ],
        }),
      })),
      getBlob: vi.fn(async (_owner: string, _repo: string, sha: string) => ({
        ok: true,
        json: async () => {
          const contentBySha: Record<string, string> = {
            'skill-md': btoa('# Demo'),
            prompt: btoa('Write a better prompt'),
            'dot-companion': btoa('Review the current change set'),
          };

          return {
            encoding: 'base64',
            content: contentBySha[sha],
          };
        },
      })),
    }));

    const { resolveOpenClawBundleFiles } = await import('../src/lib/server/openclaw/bundle-files');
    const files = await resolveOpenClawBundleFiles({
      skill: createSkillDetail({
        sourceType: 'github',
        skillPath: '',
      }),
      r2: undefined,
      githubToken: 'token',
    });

    expect(files.map((file) => file.path)).toEqual([
      '.claude/commands/review.md',
      'SKILL.md',
      'templates/prompt.txt',
    ]);
  });

  it('reads nested GitHub bundles from the canonical isolated R2 prefix', async () => {
    const { resolveOpenClawBundleFiles } = await import('../src/lib/server/openclaw/bundle-files');
    const files = await resolveOpenClawBundleFiles({
      skill: createSkillDetail({
        sourceType: 'github',
        repoOwner: 'demo-owner',
        repoName: 'demo-repo',
        skillPath: '.claude',
        readme: null,
      }),
      r2: createMockR2({
        'skills/github/demo-owner/demo-repo/p:.claude/SKILL.md': '# Demo',
        'skills/github/demo-owner/demo-repo/p:.claude/templates/prompt.txt': 'prompt',
      }),
    });

    expect(files.map((file) => file.path)).toEqual(['SKILL.md', 'templates/prompt.txt']);
  });
});
