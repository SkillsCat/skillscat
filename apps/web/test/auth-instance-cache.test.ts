import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, type AuthEnv } from '../src/lib/server/auth';
import { createMigratedDb } from './helpers/migrated-db';

function environment(): AuthEnv {
  return {
    DB: { prepare: vi.fn(() => { throw new Error('Unexpected database query'); }) } as unknown as D1Database,
    BETTER_AUTH_SECRET: 'local-cpu-test-secret-01234567890123456789',
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
    PUBLIC_APP_URL: 'https://skills.cat',
  };
}

describe('auth instance reuse', () => {
  it('keeps signed sessions, response cookies and revocation isolated on a shared instance', async () => {
    const { sqlite, db } = createMigratedDb();
    const env = { ...environment(), DB: db };
    const now = Math.floor(Date.now() / 1000);
    try {
      for (const id of ['alice', 'bob']) {
        sqlite.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
          .run(id, id, `${id}@example.test`, now, now);
        sqlite.prepare('INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(`session-${id}`, id, `token-${id}`, now + 3600, now, now);
      }
      const headersFor = (id: string | null) => {
        if (!id) return new Headers();
        const token = `token-${id}`;
        const signature = createHmac('sha256', env.BETTER_AUTH_SECRET).update(token).digest('base64');
        return new Headers({ cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` });
      };
      const ids = ['alice', 'bob', null, 'alice', 'missing', 'bob'];
      const auth = createAuth(env);
      const sessions = await Promise.all(ids.map((id) =>
        createAuth({ ...env }).api.getSession({ headers: headersFor(id), returnHeaders: true })));
      expect(sessions.map(({ response }) => response?.user.id ?? null))
        .toEqual(['alice', 'bob', null, 'alice', null, 'bob']);
      const aliceCookie = sessions[0].headers.get('set-cookie');
      const bobCookie = sessions[1].headers.get('set-cookie');
      expect(aliceCookie).toContain('better-auth.session_data=');
      expect(bobCookie).toContain('better-auth.session_data=');
      expect(aliceCookie).not.toBe(bobCookie);
      expect(sessions[2].headers.get('set-cookie')).toBeNull();
      expect((await auth.$context).session).toBeNull();
      sqlite.prepare('DELETE FROM session WHERE user_id = ?').run('alice');
      expect(await auth.api.getSession({ headers: headersFor('alice') })).toBeNull();
      expect((await auth.api.getSession({ headers: headersFor('bob') }))?.user.id).toBe('bob');
      expect(createAuth(env)).toBe(auth);
    } finally { sqlite.close(); }
  });

  it('evicts failed initialization without evicting a newer configuration', async () => {
    const env = { ...environment(), PUBLIC_APP_URL: 'https://%' };
    const failed = createAuth(env);
    await expect(failed.$context).rejects.toThrow();
    const retry = createAuth(env);
    expect(retry).not.toBe(failed);
    const validEnv = { ...env, PUBLIC_APP_URL: 'https://skills.cat' };
    const valid = createAuth(validEnv);
    await expect(retry.$context).rejects.toThrow();
    await valid.$context;
    expect(createAuth(validEnv)).toBe(valid);
  });

  it('reuses initialization across equivalent env wrappers, but resolves sessions per request', async () => {
    const env = environment();
    const auth = createAuth(env);
    await auth.$context;
    expect(createAuth({ ...env })).toBe(auth);
    const sessions = await Promise.all(Array.from({ length: 4 }, () =>
      createAuth({ ...env }).api.getSession({ headers: new Headers() })));
    expect(sessions).toEqual([null, null, null, null]);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it.each(['BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'PUBLIC_APP_URL'] as const)(
    'rebuilds when %s changes', async (key) => {
      const env = environment();
      const before = createAuth(env);
      const after = createAuth({ ...env, [key]: key === 'PUBLIC_APP_URL' ? 'https://preview.example.com' : `${env[key]}-rotated` });
      await Promise.all([before.$context, after.$context]);
      expect(after).not.toBe(before);
    }
  );

  it('isolates database bindings and fallback origins', async () => {
    const env = environment();
    delete env.PUBLIC_APP_URL;
    const first = createAuth(env, 'https://first.example.com');
    const second = createAuth(env, 'https://second.example.com');
    const otherDB = createAuth({ ...env, DB: environment().DB }, 'https://second.example.com');
    await Promise.all([first.$context, second.$context, otherDB.$context]);
    expect(first).not.toBe(second);
    expect(otherDB).not.toBe(second);
  });
});
