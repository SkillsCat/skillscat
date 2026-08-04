import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateCache: vi.fn(),
  invalidateOpenClawSkillCaches: vi.fn(),
  syncCategoryPublicStats: vi.fn(),
  scheduleIndexNowSubmission: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  invalidateCache: mocks.invalidateCache,
}));

vi.mock('../src/lib/server/openclaw/cache', () => ({
  invalidateOpenClawSkillCaches: mocks.invalidateOpenClawSkillCaches,
}));

vi.mock('../src/lib/server/db/business/stats', () => ({
  syncCategoryPublicStats: mocks.syncCategoryPublicStats,
}));

vi.mock('../src/lib/server/seo/indexnow', () => ({
  buildIndexNowSkillUrls: vi.fn(() => []),
  resolveIndexNowOwnerHandle: vi.fn(() => null),
  scheduleIndexNowSubmission: mocks.scheduleIndexNowSubmission,
}));

describe('hard deleting an OpenClaw-published skill', () => {
  it('removes current files, manifest, and every version snapshot', async () => {
    const deletedKeys: string[] = [];
    const listedPrefixes: string[] = [];
    const events: string[] = [];
    const r2 = {
      head: vi.fn(async () => null),
      put: vi.fn(async () => ({ etag: 'mutation-lock-etag' })),
      list: vi.fn(async ({ prefix }: { prefix: string }) => {
        listedPrefixes.push(prefix);
        return {
          objects: prefix.startsWith('openclaw/versions/')
            ? [{ key: `${prefix}1.0.0/SKILL.md` }]
            : [{ key: `${prefix}SKILL.md` }],
          truncated: false,
        };
      }),
      delete: vi.fn(async (key: string) => {
        events.push(`r2-delete:${key}`);
        deletedKeys.push(key);
      }),
    };
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM skills s')) {
              return {
                file_structure: JSON.stringify({ fileTree: [] }),
                visibility: 'public',
                org_id: 'org-1',
                repo_owner: 'acme',
                org_slug: 'acme',
                owner_username: null,
              };
            }
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => {
            if (sql.includes('DELETE FROM skills')) {
              events.push('db-delete');
            }
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

    const { deleteSkillArtifactsAndInvalidateCaches } = await import('../src/lib/server/skill/delete');
    await deleteSkillArtifactsAndInvalidateCaches({
      db: db as never,
      r2: r2 as never,
      skill: {
        id: 'skill-1',
        slug: 'acme/demo',
        sourceType: 'upload',
        repoOwner: 'acme',
        repoName: 'demo',
        skillPath: null,
      },
    });

    expect(listedPrefixes).toEqual(expect.arrayContaining([
      'skills/acme/demo/',
      'openclaw/versions/acme~demo/',
      'derived/readme-html/v1/skill-1/',
    ]));
    expect(deletedKeys).toEqual(expect.arrayContaining([
      'openclaw/manifests/acme~demo.json',
      'openclaw/versions/acme~demo/1.0.0/SKILL.md',
      'derived/readme-html/v1/skill-1/SKILL.md',
    ]));
    expect(events.indexOf('db-delete')).toBeGreaterThan(
      Math.max(...events.map((event, index) => event.startsWith('r2-delete:') ? index : -1))
    );
    expect(mocks.invalidateOpenClawSkillCaches).toHaveBeenCalledWith(
      'skill-1',
      'acme/demo',
      'acme',
      { owner: 'acme', name: 'demo' }
    );
  });

  it('keeps the authoritative row when R2 cleanup is incomplete', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let dbDeleted = false;
    const r2 = {
      head: vi.fn(async () => null),
      put: vi.fn(async () => ({ etag: 'mutation-lock-etag' })),
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        objects: [{ key: `${prefix}SKILL.md` }],
        truncated: false,
      })),
      delete: vi.fn(async (key: string) => {
        if (key.startsWith('skills/')) throw new Error('R2 delete failed');
      }),
    };
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => sql.includes('FROM skills s')
            ? {
                file_structure: null,
                visibility: 'private',
                org_id: 'org-1',
                repo_owner: 'acme',
                org_slug: 'acme',
                owner_username: null,
              }
            : null,
          all: async () => ({ results: [] }),
          run: async () => {
            if (sql.includes('DELETE FROM skills')) dbDeleted = true;
            return { meta: { changes: 1 } };
          },
        }),
      })),
    };

    const { deleteSkillArtifactsAndInvalidateCaches } = await import('../src/lib/server/skill/delete');
    await expect(deleteSkillArtifactsAndInvalidateCaches({
      db: db as never,
      r2: r2 as never,
      skill: {
        id: 'skill-1',
        slug: 'acme/demo',
        sourceType: 'upload',
        repoOwner: 'acme',
        repoName: 'demo',
        skillPath: null,
      },
    })).rejects.toThrow('R2 delete failed');

    expect(dbDeleted).toBe(false);
    consoleError.mockRestore();
  });
});
