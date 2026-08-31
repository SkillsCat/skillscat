import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  requireSubmitPublishScope: vi.fn(),
  canWriteSkill: vi.fn(),
  getRepo: vi.fn(),
  invalidateCache: vi.fn(),
  invalidateOpenClawSkillCaches: vi.fn(),
  syncCategoryPublicStats: vi.fn(),
  scheduleIndexNowSubmission: vi.fn(),
}));

vi.mock('../src/lib/server/auth/middleware', () => ({
  getAuthContext: mocks.getAuthContext,
  requireSubmitPublishScope: mocks.requireSubmitPublishScope,
}));

vi.mock('../src/lib/server/auth/permissions', () => ({
  canWriteSkill: mocks.canWriteSkill,
}));

vi.mock('../src/lib/server/github-client/rest', () => ({
  getRepo: mocks.getRepo,
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

interface SkillRow {
  slug: string;
  visibility: string;
  source_type: string;
  org_id: string | null;
  repo_owner: string | null;
  description: string | null;
  tier: string | null;
  indexed_at: number | null;
  has_readme: number | null;
  org_slug: string | null;
  github_org_id: number | null;
  org_verified_at: number | null;
  owner_username: string | null;
}

function userPrincipal() {
  return {
    userId: 'user-1',
    orgId: null,
    principalType: 'user',
    principalId: 'user-1',
    user: { id: 'user-1' },
    authMethod: 'session',
    tokenInfo: null,
    scopes: ['publish'],
  };
}

function orgPrincipal() {
  return {
    userId: null,
    orgId: 'org-1',
    principalType: 'org',
    principalId: 'org-1',
    user: null,
    authMethod: 'token',
    tokenInfo: null,
    scopes: ['publish'],
  };
}

function createDb(skillOverrides: Partial<SkillRow> = {}, accountId: string | null = '123') {
  const skill: SkillRow = {
    slug: 'alice/demo',
    visibility: 'private',
    source_type: 'upload',
    org_id: null,
    repo_owner: null,
    description: 'Demo skill',
    tier: 'hot',
    indexed_at: null,
    has_readme: 0,
    org_slug: null,
    github_org_id: null,
    org_verified_at: null,
    owner_username: 'alice',
    ...skillOverrides,
  };
  const updates: unknown[][] = [];
  const securityUpdates: Array<{ sql: string; bindings: unknown[] }> = [];
  const touchedOrgIds: unknown[] = [];

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: async <T>() => {
          if (sql.includes('FROM skills s')) return skill as T;
          if (sql.includes('SELECT account_id FROM account')) {
            return accountId === null ? null : ({ account_id: accountId } as T);
          }
          throw new Error(`Unexpected first SQL: ${sql}`);
        },
        all: async <T>() => {
          if (sql.includes('SELECT category_slug FROM skill_categories')) {
            return { results: [] as T[] };
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        },
        run: async () => {
          if (sql.includes('UPDATE skills')) {
            updates.push(bindings);
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE skill_security_state')) {
            securityUpdates.push({ sql, bindings });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE organizations')) {
            touchedOrgIds.push(bindings[2]);
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
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

  return { db, updates, securityUpdates, touchedOrgIds };
}

function visibilityRequest(
  repoUrl?: string,
  visibility: 'public' | 'private' | 'unlisted' = 'public'
) {
  return new Request('https://skills.cat/api/skills/skill-1/visibility', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visibility, ...(repoUrl ? { repoUrl } : {}) }),
  });
}

beforeEach(() => {
  mocks.getAuthContext.mockResolvedValue(userPrincipal());
  mocks.canWriteSkill.mockResolvedValue(true);
  mocks.invalidateCache.mockResolvedValue(undefined);
  mocks.invalidateOpenClawSkillCaches.mockResolvedValue(undefined);
  mocks.syncCategoryPublicStats.mockResolvedValue(undefined);
  mocks.scheduleIndexNowSubmission.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('uploaded skill visibility transitions', () => {
  it('returns a client error for malformed visibility request bodies', async () => {
    const { db } = createDb();
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    await expect(PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: new Request('https://skills.cat/api/skills/skill-1/visibility', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    } as never)).rejects.toMatchObject({ status: 400 });
  });

  it('does not let an unlisted skill bypass public verification', async () => {
    const { db, updates } = createDb({ visibility: 'unlisted' });
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    await expect(PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest(),
    } as never)).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('requires a valid linked GitHub account ID', async () => {
    const { db, updates } = createDb({}, 'not-a-number');
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    await expect(PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest('https://github.com/alice/demo'),
    } as never)).rejects.toMatchObject({ status: 400 });
    expect(mocks.getRepo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('rejects URLs that only contain github.com outside the hostname', async () => {
    const { db, updates } = createDb();
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    await expect(PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest('https://example.com/github.com/alice/demo'),
    } as never)).rejects.toMatchObject({ status: 400 });
    expect(mocks.getRepo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('requires the repository owner ID to match the linked account', async () => {
    mocks.getRepo.mockResolvedValue(new Response(JSON.stringify({
      owner: { id: 999, type: 'User' },
      fork: false,
    }), { status: 200 }));
    const { db, updates } = createDb();
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    await expect(PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest('https://github.com/other/demo'),
    } as never)).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('stores the canonical URL after verifying a user-owned repository', async () => {
    mocks.getRepo.mockResolvedValue(new Response(JSON.stringify({
      owner: { id: 123, type: 'User' },
      fork: false,
    }), { status: 200 }));
    const { db, updates } = createDb();
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    const response = await PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest('https://www.github.com/alice/demo.git'),
    } as never);

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe('public');
    expect(updates[0][1]).toBe('https://github.com/alice/demo');
  });

  it('lets an organization token publish a verified organization skill', async () => {
    mocks.getAuthContext.mockResolvedValue(orgPrincipal());
    const { db, updates, touchedOrgIds } = createDb({
      slug: 'acme/demo',
      org_id: 'org-1',
      org_slug: 'acme',
      github_org_id: 456,
      org_verified_at: 1,
    });
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    const response = await PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest(),
    } as never);

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe('public');
    expect(touchedOrgIds).toEqual(['org-1']);
    expect(mocks.getRepo).not.toHaveBeenCalled();
  });

  it('rejects public transitions for an unverified organization', async () => {
    mocks.getAuthContext.mockResolvedValue(orgPrincipal());
    const { db, updates } = createDb({
      slug: 'acme/demo',
      org_id: 'org-1',
      org_slug: 'acme',
      github_org_id: 456,
      org_verified_at: null,
    });
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    await expect(PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest(),
    } as never)).rejects.toMatchObject({ status: 403 });
    expect(updates).toHaveLength(0);
  });

  it.each(['private', 'unlisted'] as const)(
    'moves a public skill to %s and invalidates protected content paths',
    async (visibility) => {
      const { db, updates } = createDb({
        visibility: 'public',
        source_type: 'upload',
        org_slug: 'acme',
        repo_owner: 'acme',
        repo_name: 'demo',
      });
      const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

      const response = await PUT({
        locals: {},
        platform: { env: { DB: db } },
        params: { id: 'skill-1' },
        request: visibilityRequest(undefined, visibility),
      } as never);

      expect(response.status).toBe(200);
      expect(updates).toHaveLength(1);
      expect(updates[0][0]).toBe(visibility);
      expect(mocks.invalidateOpenClawSkillCaches).toHaveBeenCalledWith(
        'skill-1',
        'alice/demo',
        'acme',
        { owner: 'acme', name: 'demo' }
      );
      expect(mocks.scheduleIndexNowSubmission).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete',
        source: `skill-visibility:alice/demo:${visibility}`,
      }));
    }
  );

  it.each(['private', 'unlisted'] as const)(
    'blocks queued VirusTotal work when a public skill becomes %s',
    async (visibility) => {
      const { db, updates, securityUpdates } = createDb({
        visibility: 'public',
        source_type: 'github',
        repo_owner: 'acme',
        repo_name: 'demo',
      });
      const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

      const response = await PUT({
        locals: {},
        platform: { env: { DB: db } },
        params: { id: 'skill-1' },
        request: visibilityRequest(undefined, visibility),
      } as never);

      expect(response.status).toBe(200);
      expect(updates).toHaveLength(1);
      expect(securityUpdates).toHaveLength(1);
      expect(securityUpdates[0].sql).toContain("vt_eligibility = 'skipped_visibility'");
      expect(securityUpdates[0].sql).toContain("vt_status = 'skipped'");
      expect(securityUpdates[0].sql).toContain('vt_next_attempt_at = NULL');
      expect(securityUpdates[0].bindings[1]).toBe('skill-1');
      // Visibility flip and VT reset must land in one atomic batch.
      expect(db.batch).toHaveBeenCalledTimes(1);
      expect(db.batch.mock.calls[0][0]).toHaveLength(2);
    }
  );

  it('re-arms VirusTotal evaluation when a skill returns to public', async () => {
    mocks.getRepo.mockResolvedValue(new Response(JSON.stringify({
      owner: { id: 123, type: 'User' },
      fork: false,
    }), { status: 200 }));
    const { db, updates, securityUpdates } = createDb({ visibility: 'private' });
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    const response = await PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest('https://github.com/alice/demo'),
    } as never);

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(securityUpdates).toHaveLength(1);
    expect(securityUpdates[0].sql).toContain("vt_eligibility = 'unknown'");
    expect(securityUpdates[0].sql).toContain("vt_status = 'pending'");
    expect(securityUpdates[0].sql).toContain('vt_next_attempt_at = NULL');
    expect(securityUpdates[0].bindings[1]).toBe('skill-1');
  });

  it('leaves VirusTotal state untouched for transitions that never leave private scope', async () => {
    const { db, updates, securityUpdates } = createDb({ visibility: 'private' });
    const { PUT } = await import('../src/routes/api/skills/[id]/visibility/+server');

    const response = await PUT({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: visibilityRequest(undefined, 'unlisted'),
    } as never);

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(securityUpdates).toHaveLength(0);
  });
});
