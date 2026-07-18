import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  getCurrentSkillVisibility: vi.fn(),
  getAuthContext: vi.fn(),
  requireScope: vi.fn(),
  checkSkillAccess: vi.fn(),
}));

vi.mock('$lib/server/cache', () => ({
  getCached: mocks.getCached,
}));

vi.mock('$lib/server/skill/visibility', () => ({
  getCurrentSkillVisibility: mocks.getCurrentSkillVisibility,
}));

vi.mock('$lib/server/auth/middleware', () => ({
  getAuthContext: mocks.getAuthContext,
  requireScope: mocks.requireScope,
}));

vi.mock('$lib/server/auth/permissions', () => ({
  checkSkillAccess: mocks.checkSkillAccess,
}));

const privateSkill = {
  id: 'skill-1',
  name: 'Private Skill',
  slug: 'acme/private-skill',
  source_type: 'upload',
  repo_owner: 'acme',
  repo_name: 'private-skill',
  skill_path: '',
  readme: '# Private content',
  visibility: 'private',
  updated_at: 2,
  last_commit_at: 2,
  indexed_at: 1,
  file_structure: null,
};

function createDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => privateSkill),
      })),
    })),
  };
}

beforeEach(() => {
  mocks.getCurrentSkillVisibility.mockResolvedValue('private');
  mocks.getAuthContext.mockResolvedValue({
    userId: null,
    orgId: null,
    scopes: [],
  });
  mocks.getCached.mockResolvedValue({
    data: {
      ...privateSkill,
      visibility: 'public',
      readme: '# Stale public content',
    },
    hit: true,
  });
});

describe('public-to-private cache boundaries', () => {
  it('does not read a stale public source cache before requiring authentication', async () => {
    const { resolveSkillSourceInfo } = await import('../src/lib/server/skill/source');
    const result = await resolveSkillSourceInfo({
      db: createDb() as never,
      request: new Request('https://skills.cat/api/skills/acme/private-skill'),
      locals: {} as App.Locals,
    }, 'acme/private-skill');

    expect(result.status).toBe(401);
    expect(result.skill).toBeNull();
    expect(mocks.getCached).not.toHaveBeenCalled();
  });

  it('does not read stale public file data before requiring authentication', async () => {
    const { resolveSkillFiles } = await import('../src/lib/server/skill/files');

    await expect(resolveSkillFiles({
      db: createDb() as never,
      r2: {} as R2Bucket,
      request: new Request('https://skills.cat/api/skills/acme/private-skill/files'),
      locals: {} as App.Locals,
    }, {
      slug: 'acme/private-skill',
    })).rejects.toMatchObject({ status: 401 });

    expect(mocks.getCached).not.toHaveBeenCalled();
  });
});
