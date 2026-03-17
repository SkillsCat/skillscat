import { afterEach, describe, expect, it, vi } from 'vitest';

type Step = {
  match: string;
  first?: unknown;
  run?: unknown;
};

function createDbMock(steps: Step[]) {
  let index = 0;

  return {
    get stepCount() {
      return index;
    },
    prepare(sql: string) {
      const step = steps[index];
      if (!step) {
        throw new Error(`Unexpected SQL after ${index} statements: ${sql}`);
      }
      expect(sql).toContain(step.match);
      index += 1;

      return {
        bind: (..._args: unknown[]) => ({
          first: step.first === undefined
            ? undefined
            : vi.fn(async () => step.first),
          run: step.run === undefined
            ? undefined
            : vi.fn(async () => step.run),
        }),
      };
    },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('$lib/server/auth/middleware');
  vi.unmock('$lib/server/auth/permissions');
});

describe('skill report route', () => {
  it('rejects unauthenticated users', async () => {
    vi.doMock('$lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({ userId: null })),
      requireScope: vi.fn(),
    }));
    vi.doMock('$lib/server/auth/permissions', () => ({
      checkSkillAccess: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/skills/[slug]/report/+server');

    await expect(POST({
      params: { slug: 'test/demo' },
      platform: { env: { DB: {} } },
      locals: {},
      request: new Request('https://skills.cat/api/skills/test/demo/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'security' }),
      }),
    } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('records security reports, refreshes summary, and queues premium review', async () => {
    const db = createDbMock([
      { match: 'SELECT id, stars, visibility', first: { id: 'skill_1', stars: 150, visibility: 'public' } },
      { match: 'INSERT OR IGNORE INTO skill_reports', run: { meta: { changes: 1 } } },
      {
        match: 'COUNT(DISTINCT sr.reporter_user_id)',
        first: {
          openSecurityReportCount: 10,
          stars: 150,
          contentFingerprint: 'fp-current',
          premiumLastAnalyzedFingerprint: 'fp-old',
        },
      },
      { match: 'open_security_report_count', run: {} },
      { match: 'premium_due_reason', run: {} },
    ]);
    const queueSend = vi.fn(async () => undefined);

    vi.doMock('$lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({ userId: 'user_1' })),
      requireScope: vi.fn(),
    }));
    vi.doMock('$lib/server/auth/permissions', () => ({
      checkSkillAccess: vi.fn(async () => true),
    }));

    const { POST } = await import('../src/routes/api/skills/[slug]/report/+server');
    const response = await POST({
      params: { slug: 'test/demo' },
      platform: {
        env: {
          DB: db,
          SECURITY_ANALYSIS_QUEUE: {
            send: queueSend,
          },
        },
      },
      locals: {},
      request: new Request('https://skills.cat/api/skills/test/demo/report', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'skillscat-cli/0.1.0',
        },
        body: JSON.stringify({ reason: 'security', details: 'dangerous prompt injection' }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      report: {
        openSecurityReportCount: number;
        riskLevel: string;
        premiumEscalated: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.report).toEqual({
      openSecurityReportCount: 10,
      riskLevel: 'fatal',
      premiumEscalated: true,
    });
    expect(queueSend).toHaveBeenCalledWith({
      type: 'analyze_security',
      skillId: 'skill_1',
      trigger: 'report',
      requestedTier: 'premium',
    });
    expect(db.stepCount).toBe(5);
  });

  it('updates an existing open copyright report without queueing security work', async () => {
    const db = createDbMock([
      { match: 'SELECT id, stars, visibility', first: { id: 'skill_1', stars: 12, visibility: 'public' } },
      { match: 'INSERT OR IGNORE INTO skill_reports', run: { meta: { changes: 0 } } },
      { match: 'FROM skill_reports\n      WHERE skill_id = ?', first: { id: 'report_1' } },
      { match: 'UPDATE skill_reports', run: { meta: { changes: 1 } } },
    ]);
    const queueSend = vi.fn(async () => undefined);

    vi.doMock('$lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({ userId: 'user_1' })),
      requireScope: vi.fn(),
    }));
    vi.doMock('$lib/server/auth/permissions', () => ({
      checkSkillAccess: vi.fn(async () => true),
    }));

    const { POST } = await import('../src/routes/api/skills/[slug]/report/+server');
    const response = await POST({
      params: { slug: 'test/demo' },
      platform: {
        env: {
          DB: db,
          SECURITY_ANALYSIS_QUEUE: {
            send: queueSend,
          },
        },
      },
      locals: {},
      request: new Request('https://skills.cat/api/skills/test/demo/report', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'skillscat-cli/0.1.0',
        },
        body: JSON.stringify({ reason: 'copyright', details: 'copied without attribution' }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      reason: string;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      reason: 'copyright',
    });
    expect(queueSend).not.toHaveBeenCalled();
    expect(db.stepCount).toBe(4);
  });
});
