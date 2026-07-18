import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCached = vi.fn();
const getCurrentSkillVisibility = vi.fn();

vi.mock('$lib/server/cache', () => ({ getCached }));
vi.mock('$lib/server/skill/visibility', () => ({ getCurrentSkillVisibility }));

describe('registry skill response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSkillVisibility.mockResolvedValue('public');
    getCached.mockImplementation(async (_key: string, loader: () => Promise<unknown>) => ({
      data: await loader(),
      hit: false,
    }));
  });

  it('returns the exact published slug and skill path required by the CLI', async () => {
    const row = {
      id: 'skill-1',
      name: 'Nested Skill',
      slug: 'acme/repo/nested',
      description: 'Nested',
      owner: 'acme',
      repo: 'repo',
      stars: 1,
      updatedAt: 123,
      githubUrl: 'https://github.com/acme/repo',
      skillPath: 'skills/nested',
      sourceType: 'github',
      readme: '# Nested',
      contentHash: 'hash',
      visibility: 'public',
      categories: 'automation',
    };
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn(async () => row) })),
      })),
    } as unknown as D1Database;

    const { GET } = await import('../src/routes/registry/skill/[owner]/[...name]/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'repo/nested' },
      platform: { env: { DB: db }, context: {} },
      request: new Request('https://skills.cat/registry/skill/acme/repo/nested'),
      locals: {},
    } as never);
    const payload = await response.json() as { slug: string; skillPath: string; content: string };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      slug: 'acme/repo/nested',
      skillPath: 'skills/nested',
      content: '# Nested',
    });
  });

  it('never falls back from a nested upload to another slug R2 object', async () => {
    const row = {
      id: 'skill-private-nested',
      name: 'Nested Upload',
      slug: 'acme/repo/nested',
      description: 'Nested upload',
      owner: 'acme',
      repo: 'repo',
      stars: 0,
      updatedAt: 123,
      githubUrl: null,
      skillPath: 'repo/nested',
      sourceType: 'upload',
      readme: '# Correct nested content',
      contentHash: 'hash',
      visibility: 'public',
      categories: null,
    };
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn(async () => row) })),
      })),
    } as unknown as D1Database;
    const get = vi.fn(async (key: string) => (
      key === 'skills/acme/repo/SKILL.md'
        ? { text: async () => '# Wrong root content' }
        : null
    ));

    const { GET } = await import('../src/routes/registry/skill/[owner]/[...name]/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'repo/nested' },
      platform: { env: { DB: db, R2: { get } }, context: {} },
      request: new Request('https://skills.cat/registry/skill/acme/repo/nested'),
      locals: {},
    } as never);
    const payload = await response.json() as { content: string };

    expect(payload.content).toBe('# Correct nested content');
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('skills/acme/repo/nested/SKILL.md');
  });
});
