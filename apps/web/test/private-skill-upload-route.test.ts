import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  requireSubmitPublishScope: vi.fn(),
  findSkillsByExactHashGroup: vi.fn(),
  storeSkillHashes: vi.fn(),
  invalidateCache: vi.fn(),
  invalidateCategoryCaches: vi.fn(),
  markSkillSecurityDirty: vi.fn(),
  queueSecurityAnalysis: vi.fn(),
  loadIndexNowSkillTarget: vi.fn(),
  scheduleIndexNowSubmission: vi.fn(),
}));

vi.mock('../src/lib/server/auth/middleware', () => ({
  getAuthContext: mocks.getAuthContext,
  requireSubmitPublishScope: mocks.requireSubmitPublishScope,
}));

vi.mock('../src/lib/server/skill/dedup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/server/skill/dedup')>();
  return {
    ...actual,
    findSkillsByExactHashGroup: mocks.findSkillsByExactHashGroup,
    storeSkillHashes: mocks.storeSkillHashes,
  };
});

vi.mock('../src/lib/server/cache', () => ({
  invalidateCache: mocks.invalidateCache,
}));

vi.mock('../src/lib/server/cache/categories', () => ({
  invalidateCategoryCaches: mocks.invalidateCategoryCaches,
}));

vi.mock('../src/lib/server/security/state', () => ({
  buildSecurityAnalysisMessage: vi.fn(() => ({ skillId: 'skill-id' })),
  markSkillSecurityDirty: mocks.markSkillSecurityDirty,
  queueSecurityAnalysis: mocks.queueSecurityAnalysis,
}));

vi.mock('../src/lib/server/security', () => ({
  buildSecurityContentFingerprint: vi.fn(async () => 'security-fingerprint'),
}));

vi.mock('../src/lib/server/seo/indexnow', () => ({
  buildIndexNowSkillUrls: vi.fn(() => []),
  loadIndexNowSkillTarget: mocks.loadIndexNowSkillTarget,
  scheduleIndexNowSubmission: mocks.scheduleIndexNowSubmission,
}));

interface PreparedStatement {
  sql: string;
  bindings: unknown[];
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

interface UploadDbOptions {
  org?: {
    id: string;
    slug: string;
    github_org_id: number | null;
    verified_at: number | null;
  } | null;
  categoryBatchError?: Error;
}

function createUploadDb(options: UploadDbOptions = {}) {
  const statements: PreparedStatement[] = [];
  const insertedSkills: unknown[][] = [];
  const categoryBindings: unknown[][] = [];
  const deletedSkillIds: unknown[] = [];
  const touchedOrgIds: unknown[] = [];

  const db = {
    prepare: vi.fn((sql: string): Omit<PreparedStatement, 'bindings'> & { bind: (...bindings: unknown[]) => PreparedStatement } => ({
      sql,
      first: async () => null,
      run: async () => ({ meta: { changes: 0 } }),
      bind: (...bindings: unknown[]) => {
        const statement: PreparedStatement = {
          sql,
          bindings,
          first: async <T>() => {
            if (sql.includes('SELECT name FROM user')) {
              return { name: 'Alice' } as T;
            }
            if (sql.includes('FROM organizations')) {
              return (options.org ?? null) as T | null;
            }
            if (sql.includes('SELECT id FROM skills WHERE slug')) {
              return null;
            }
            if (sql.includes('SELECT id, visibility FROM skills WHERE slug')) {
              return null;
            }
            throw new Error(`Unexpected first SQL: ${sql}`);
          },
          run: async () => {
            if (sql.includes('INSERT INTO skills')) {
              insertedSkills.push(bindings);
              return { meta: { changes: 1 } };
            }
            if (sql.includes('DELETE FROM skills')) {
              deletedSkillIds.push(bindings[0]);
              return { meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE organizations')) {
              touchedOrgIds.push(bindings[2]);
              return { meta: { changes: 1 } };
            }
            throw new Error(`Unexpected run SQL: ${sql}`);
          },
        };
        statements.push(statement);
        return statement;
      },
    })),
    batch: vi.fn(async (batchStatements: PreparedStatement[]) => {
      if (
        options.categoryBatchError
        && batchStatements.some((statement) => statement.sql.includes('INSERT INTO skill_categories'))
      ) {
        throw options.categoryBatchError;
      }
      for (const statement of batchStatements) {
        if (statement.sql.includes('INSERT INTO skill_categories')) {
          categoryBindings.push(statement.bindings);
        } else {
          await statement.run();
        }
      }
      return batchStatements.map(() => ({ meta: { changes: 1 } }));
    }),
  };

  return {
    db,
    statements,
    insertedSkills,
    categoryBindings,
    deletedSkillIds,
    touchedOrgIds,
  };
}

function orgPrincipal(orgId = 'org-1') {
  return {
    userId: null,
    orgId,
    principalType: 'org',
    principalId: orgId,
    user: null,
    authMethod: 'token',
    tokenInfo: null,
    scopes: ['read', 'write', 'publish'],
  };
}

function userPrincipal() {
  return {
    userId: 'user-1',
    orgId: null,
    principalType: 'user',
    principalId: 'user-1',
    user: { id: 'user-1', name: 'Alice' },
    authMethod: 'session',
    tokenInfo: null,
    scopes: ['read', 'write', 'publish'],
  };
}

function uploadRequest(content: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set('skill_md', content);
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request('https://skills.cat/api/skills/upload', {
    method: 'POST',
    body: form,
  });
}

function createR2(putImplementation: () => Promise<void> = async () => {}) {
  return {
    put: vi.fn(putImplementation),
    delete: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  mocks.getAuthContext.mockResolvedValue(orgPrincipal());
  mocks.findSkillsByExactHashGroup.mockResolvedValue([]);
  mocks.storeSkillHashes.mockResolvedValue(undefined);
  mocks.markSkillSecurityDirty.mockResolvedValue(undefined);
  mocks.queueSecurityAnalysis.mockResolvedValue(undefined);
  mocks.loadIndexNowSkillTarget.mockResolvedValue(null);
  mocks.scheduleIndexNowSubmission.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('private skill upload', () => {
  it('returns 400 when metadata fields are uploaded as files', async () => {
    const form = new FormData();
    form.set('skill_md', '# Valid Skill\n\nValid private content.');
    form.set('name', new File(['not text metadata'], 'name.txt'));
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: {}, R2: createR2() } },
      request: new Request('https://skills.cat/api/skills/upload', {
        method: 'POST',
        body: form,
      }),
    } as never)).rejects.toMatchObject({ status: 400 });
  });

  it('stores an org-token upload under the organization and persists normalized categories', async () => {
    const { db, insertedSkills, categoryBindings, touchedOrgIds } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: null, verified_at: null },
    });
    const r2 = createR2();
    const content = [
      '---\r',
      'name: Release Helper\r',
      'categories: Dev Tools, dev_tools, AI & ML\r',
      '---\r',
      '# Release Helper\r',
      'Ship releases safely.\r',
    ].join('\n');
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    const response = await POST({
      locals: {},
      platform: { env: { DB: db, R2: r2 } },
      request: uploadRequest(content, { visibility: 'private', org: 'ACME' }),
    } as never);

    expect(await response.json()).toMatchObject({
      success: true,
      slug: 'acme/release-helper',
      categories: ['dev-tools', 'ai-ml'],
    });
    expect(insertedSkills).toHaveLength(1);
    expect(insertedSkills[0][5]).toBeNull();
    expect(insertedSkills[0][6]).toBe('org-1');
    expect(touchedOrgIds).toEqual(['org-1']);
    expect(categoryBindings.map((bindings) => bindings[1])).toEqual(['dev-tools', 'ai-ml']);
    expect(r2.put).toHaveBeenCalledOnce();
  });

  it('stores companion files as a bounded upload bundle', async () => {
    const { db, insertedSkills } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: null, verified_at: null },
    });
    const r2 = createR2();
    const form = new FormData();
    form.set('skill_md', '# Bundle Skill\n\nPrivate bundle content.');
    form.append('files', new File(['Prompt template'], 'templates/prompt.txt', { type: 'text/plain' }));
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    const response = await POST({
      locals: {},
      platform: { env: { DB: db, R2: r2 } },
      request: new Request('https://skills.cat/api/skills/upload', {
        method: 'POST',
        body: form,
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(r2.put.mock.calls.map((call) => call[0])).toEqual([
      'skills/acme/bundle-skill/SKILL.md',
      'skills/acme/bundle-skill/templates/prompt.txt',
    ]);
    expect(JSON.parse(String(insertedSkills[0][8]))).toMatchObject({
      fileTree: expect.arrayContaining([
        expect.objectContaining({ name: 'SKILL.md', type: 'file' }),
        expect.objectContaining({ name: 'templates', type: 'directory' }),
      ]),
    });
    expect(mocks.storeSkillHashes).toHaveBeenCalledWith(
      db,
      expect.any(String),
      expect.objectContaining({
        fullHash: expect.any(String),
        bundleExactHash: expect.any(String),
        bundleManifestHash: expect.any(String),
      })
    );
  });

  it('rejects public personal uploads', async () => {
    mocks.getAuthContext.mockResolvedValue(userPrincipal());
    const { db, insertedSkills } = createUploadDb();
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: db, R2: createR2() } },
      request: uploadRequest('# Personal Skill\n\nPrivate content.', { visibility: 'public' }),
    } as never)).rejects.toMatchObject({ status: 403 });
    expect(insertedSkills).toHaveLength(0);
  });

  it('rejects public uploads for an unverified organization', async () => {
    const { db, insertedSkills } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: 123, verified_at: null },
    });
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: db, R2: createR2() } },
      request: uploadRequest('# Org Skill\n\nPublic content.', { visibility: 'public' }),
    } as never)).rejects.toMatchObject({ status: 403 });
    expect(insertedSkills).toHaveLength(0);
  });

  it('allows public uploads for a verified GitHub organization', async () => {
    const { db, insertedSkills } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: 123, verified_at: 1 },
    });
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    const response = await POST({
      locals: {},
      platform: { env: { DB: db, R2: createR2() } },
      request: uploadRequest('# Org Skill\n\nPublic content.', { visibility: 'public' }),
    } as never);

    expect(response.status).toBe(200);
    expect(insertedSkills[0][4]).toBe('public');
    expect(mocks.invalidateCache).toHaveBeenCalled();
  });

  it('rolls back the skill when hash metadata storage fails', async () => {
    mocks.storeSkillHashes.mockRejectedValueOnce(new Error('hash write failed'));
    const { db, deletedSkillIds } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: null, verified_at: null },
    });
    const r2 = createR2();
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: db, R2: r2 } },
      request: uploadRequest('# Rollback Skill\n\nPrivate content.'),
    } as never)).rejects.toMatchObject({ status: 500 });

    expect(deletedSkillIds).toHaveLength(1);
    expect(r2.put).not.toHaveBeenCalled();
  });

  it('rolls back the skill when R2 storage fails', async () => {
    const { db, deletedSkillIds } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: null, verified_at: null },
    });
    const r2 = createR2(async () => {
      throw new Error('R2 unavailable');
    });
    const { POST } = await import('../src/routes/api/skills/upload/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: db, R2: r2 } },
      request: uploadRequest('# Rollback Skill\n\nPrivate content.'),
    } as never)).rejects.toMatchObject({ status: 500 });

    expect(deletedSkillIds).toHaveLength(1);
    expect(r2.delete).toHaveBeenCalled();
  });
});

describe('private skill upload preview', () => {
  it('parses CRLF frontmatter and keeps an unverified org private', async () => {
    const { db } = createUploadDb({
      org: { id: 'org-1', slug: 'acme', github_org_id: 123, verified_at: null },
    });
    const content = '---\r\nname: Preview Skill\r\ncategories: Dev Tools, AI & ML\r\n---\r\n# Preview Skill\r\nBody';
    const { POST } = await import('../src/routes/api/skills/upload/preview/+server');

    const response = await POST({
      locals: {},
      platform: { env: { DB: db } },
      request: new Request('https://skills.cat/api/skills/upload/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, name: 'CLI Override' }),
      }),
    } as never);

    expect(await response.json()).toMatchObject({
      preview: {
        name: 'CLI Override',
        slug: 'acme/cli-override',
        categories: ['dev-tools', 'ai-ml'],
      },
      suggestedVisibility: 'private',
    });
  });
});
