import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteSkillArtifactsAndInvalidateCaches: vi.fn(),
  invalidateOpenClawSkillCaches: vi.fn(),
}));

vi.mock('$lib/server/skill/delete', () => ({
  deleteSkillArtifactsAndInvalidateCaches: mocks.deleteSkillArtifactsAndInvalidateCaches,
}));

vi.mock('$lib/server/openclaw/cache', () => ({
  invalidateOpenClawSkillCaches: mocks.invalidateOpenClawSkillCaches,
}));

interface RecordedStatement {
  sql: string;
  bindings: unknown[];
}

function createDb() {
  const runs: RecordedStatement[] = [];
  const personalSkills = [
    {
      id: 'personal-private',
      slug: 'alice/personal-private',
      visibility: 'private',
      source_type: 'upload',
      repo_owner: 'alice',
      repo_name: 'personal-private',
      skill_path: '',
      org_id: null,
    },
    {
      id: 'personal-public',
      slug: 'alice/personal-public',
      visibility: 'public',
      source_type: 'github',
      repo_owner: 'alice',
      repo_name: 'personal-public',
      skill_path: '',
      org_id: null,
    },
  ];
  const organizationSkills = [
    {
      id: 'transferred-private',
      slug: 'transfer/private-skill',
      visibility: 'private',
      source_type: 'upload',
      repo_owner: 'transfer',
      repo_name: 'private-skill',
      skill_path: '',
      org_id: 'org-transfer',
    },
    {
      id: 'deleted-private',
      slug: 'deleted/private-skill',
      visibility: 'private',
      source_type: 'upload',
      repo_owner: 'deleted',
      repo_name: 'private-skill',
      skill_path: '',
      org_id: 'org-delete',
    },
    {
      id: 'detached-public',
      slug: 'deleted/public-skill',
      visibility: 'public',
      source_type: 'upload',
      repo_owner: 'deleted',
      repo_name: 'public-skill',
      skill_path: '',
      org_id: 'org-delete',
    },
  ];

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT account_id FROM account')) {
            return { account_id: '123' };
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        all: async () => {
          if (sql.includes('FROM skills') && sql.includes('owner_id = ?') && sql.includes('org_id IS NULL')) {
            return { results: personalSkills };
          }
          if (sql.includes('FROM organizations o')) {
            return {
              results: [
                { id: 'org-transfer', slug: 'transfer' },
                { id: 'org-delete', slug: 'deleted' },
              ],
            };
          }
          if (sql.includes('WITH ranked_members')) {
            return { results: [{ org_id: 'org-transfer', user_id: 'replacement-user' }] };
          }
          if (sql.includes('WHERE org_id IN')) {
            return { results: organizationSkills };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        run: async () => {
          runs.push({ sql, bindings });
          return { meta: { changes: 1 } };
        },
      }),
    })),
    batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    }),
  };

  return { db, runs };
}

beforeEach(() => {
  mocks.deleteSkillArtifactsAndInvalidateCaches.mockResolvedValue(undefined);
  mocks.invalidateOpenClawSkillCaches.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('account deletion organization ownership', () => {
  it('preserves transferred org skills and fully cleans only deleted private skills', async () => {
    const { db, runs } = createDb();
    const r2 = { delete: vi.fn() };
    const { DELETE } = await import('../src/routes/api/account/+server');

    const response = await DELETE({
      locals: { auth: vi.fn(async () => ({ user: { id: 'user-1' } })) },
      platform: { env: { DB: db, R2: r2 } },
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.deleteSkillArtifactsAndInvalidateCaches).toHaveBeenCalledTimes(2);
    expect(mocks.deleteSkillArtifactsAndInvalidateCaches.mock.calls.map((call) => call[0].skill.id))
      .toEqual(['personal-private', 'deleted-private']);
    expect(mocks.deleteSkillArtifactsAndInvalidateCaches.mock.calls[0]?.[0]?.r2).toBe(r2);

    expect(runs.some(({ sql, bindings }) => (
      sql.includes('UPDATE organizations')
      && bindings[0] === 'replacement-user'
      && bindings[3] === 'org-transfer'
    ))).toBe(true);
    expect(runs.some(({ sql, bindings }) => (
      sql.includes("WHERE org_id = ? AND visibility = 'public'")
      && bindings[0] === 'org-delete'
    ))).toBe(true);
    expect(runs.some(({ sql, bindings }) => (
      sql.includes('DELETE FROM organizations WHERE id = ?')
      && bindings[0] === 'org-delete'
    ))).toBe(true);
    expect(runs.some(({ sql, bindings }) => (
      sql.includes('DELETE FROM organizations WHERE id = ?')
      && bindings[0] === 'org-transfer'
    ))).toBe(false);
    expect(runs.some(({ sql }) => sql.includes('DELETE FROM skills'))).toBe(false);
    expect(runs.some(({ sql }) => sql.includes('UPDATE user_actions SET user_id = NULL'))).toBe(true);
    expect(runs.some(({ sql }) => sql.includes('DELETE FROM session WHERE user_id = ?'))).toBe(true);

    expect(mocks.invalidateOpenClawSkillCaches).toHaveBeenCalledWith(
      'personal-public',
      'alice/personal-public'
    );
    expect(mocks.invalidateOpenClawSkillCaches).toHaveBeenCalledWith(
      'detached-public',
      'deleted/public-skill',
      'deleted'
    );
  });

  it('keeps the session available when resource cleanup fails before finalization', async () => {
    const { db, runs } = createDb();
    mocks.deleteSkillArtifactsAndInvalidateCaches.mockRejectedValueOnce(new Error('R2 unavailable'));
    const { DELETE } = await import('../src/routes/api/account/+server');

    await expect(DELETE({
      locals: { auth: vi.fn(async () => ({ user: { id: 'user-1' } })) },
      platform: { env: { DB: db, R2: {} } },
    } as never)).rejects.toMatchObject({ status: 500 });

    expect(db.batch).not.toHaveBeenCalled();
    expect(runs.some(({ sql }) => sql.includes('DELETE FROM session'))).toBe(false);
    expect(runs.some(({ sql }) => sql.includes('DELETE FROM user WHERE id'))).toBe(false);
  });
});
