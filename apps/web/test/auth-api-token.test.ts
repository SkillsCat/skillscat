import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listUserTokens, validateApiToken } from '../src/lib/server/auth/api';

function createDb(lastUsedAt: number | null, scopes = '["read"]', orgId: string | null = null) {
  const updateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => sql.includes('SELECT id, user_id')
      ? {
          first: vi.fn(async () => ({
            id: 'token-1',
            user_id: 'user-1',
            org_id: orgId,
            name: 'CLI',
            scopes,
            expires_at: null,
            last_used_at: lastUsedAt,
          })),
        }
      : { run: updateRun }),
  }));

  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    updateRun,
  };
}

describe('API token validation cost guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write last_used_at again inside the write interval', async () => {
    const { db, updateRun } = createDb(Date.now());

    const result = await validateApiToken('sk_recent_token', db);

    expect(result?.userId).toBe('user-1');
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('updates stale last_used_at and rejects malformed scopes safely', async () => {
    const stale = createDb(1);
    expect(await validateApiToken('sk_stale_token', stale.db)).not.toBeNull();
    expect(stale.updateRun).toHaveBeenCalledTimes(1);

    const malformed = createDb(1, '{bad json');
    expect(await validateApiToken('sk_bad_token', malformed.db)).toBeNull();
    expect(malformed.updateRun).not.toHaveBeenCalled();
  });

  it('rejects ambiguous token principals and lists malformed legacy scopes safely', async () => {
    const ambiguous = createDb(1, '["read"]', 'org-1');
    expect(await validateApiToken('sk_ambiguous_token', ambiguous.db)).toBeNull();
    expect(ambiguous.updateRun).not.toHaveBeenCalled();

    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({
            results: [{
              id: 'legacy-token',
              name: 'Legacy',
              token_prefix: 'sk_legacy',
              scopes: '{bad json',
              last_used_at: null,
              expires_at: null,
              created_at: 1,
            }],
          })),
        })),
      })),
    } as unknown as D1Database;

    await expect(listUserTokens('user-1', db)).resolves.toEqual([
      expect.objectContaining({ id: 'legacy-token', scopes: [] }),
    ]);
  });
});
