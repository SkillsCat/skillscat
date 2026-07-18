import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrgApiToken = vi.fn();

vi.mock('$lib/server/auth/api', () => ({
  createOrgApiToken,
  listOrgTokens: vi.fn(),
}));

describe('organization token route validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for malformed JSON', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ role: 'owner', org_id: 'org-1' })),
        })),
      })),
    } as unknown as D1Database;
    const { POST } = await import('../src/routes/api/orgs/[slug]/tokens/+server');

    await expect(POST({
      locals: { auth: async () => ({ user: { id: 'owner-1' } }) },
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid',
      }),
    } as never)).rejects.toMatchObject({ status: 400 });

    expect(createOrgApiToken).not.toHaveBeenCalled();
  });

  it.each([
    { name: 42 },
    { name: 'Deploy', scopes: null },
    { name: 'Deploy', scopes: ['read'], expiresInDays: '30' },
  ])('returns 400 for malformed token input %#', async (body) => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ role: 'owner', org_id: 'org-1' })),
        })),
      })),
    } as unknown as D1Database;
    const { POST } = await import('../src/routes/api/orgs/[slug]/tokens/+server');

    await expect(POST({
      locals: { auth: async () => ({ user: { id: 'owner-1' } }) },
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as never)).rejects.toMatchObject({ status: 400 });

    expect(createOrgApiToken).not.toHaveBeenCalled();
  });
});
