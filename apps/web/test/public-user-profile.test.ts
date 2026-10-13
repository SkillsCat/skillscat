import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/routes/u/[username]/+page.server';
import { createMigratedDb } from './helpers/migrated-db';

const databases: ReturnType<typeof createMigratedDb>[] = [];

function fixture(registered = false, count = 137) {
  const context = createMigratedDb();
  databases.push(context);
  const { sqlite, db } = context;
  sqlite.exec(`
    INSERT INTO authors (id, github_id, username) VALUES ('author', 1, 'large-author');
    INSERT INTO categories (id, slug, name) VALUES ('testing', 'testing', 'Testing');
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('owner', 'registered-author', 'fixture@example.invalid', 1, 100, 100);
    INSERT INTO organizations (id, name, slug, owner_id) VALUES ('org', 'Org', 'org', 'owner');
  `);
  if (registered) {
    sqlite.exec(`INSERT INTO account (id, user_id, account_id, provider_id, created_at, updated_at)
      VALUES ('account', 'owner', 'large-author', 'github', 100, 100)`);
  }
  const insert = sqlite.prepare(`INSERT INTO skills
    (id, name, slug, repo_owner, owner_id, org_id, visibility, stars, updated_at, tier)
    VALUES (?, ?, ?, 'large-author', ?, ?, ?, 10, 100, 'hot')`);
  for (let index = 0; index < count; index++) {
    const id = `skill-${String(index).padStart(3, '0')}`;
    insert.run(id, id, `large-author/${id}`, registered ? 'owner' : null, null, 'public');
    sqlite.prepare('INSERT INTO skill_categories (skill_id, category_slug) VALUES (?, ?)').run(id, 'testing');
  }
  insert.run('private', 'Private', 'large-author/private', 'owner', null, 'private');
  insert.run('unlisted', 'Unlisted', 'large-author/unlisted', 'owner', null, 'unlisted');
  if (registered) insert.run('org-skill', 'Org Skill', 'org/skill', 'owner', 'org', 'public');

  // SQLite permits more variables than D1. Enforce D1's ceiling so this fixture
  // reproduces the original unpaginated hydrateCategories failure.
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...params: unknown[]) => {
      if (params.length > 100) throw new Error('D1_ERROR: too many SQL variables');
      return bind(...params);
    };
    return statement;
  });
  const cacheEntries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => cacheEntries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => { cacheEntries.set(request.url, response.clone()); }),
  };
  const headers: Record<string, string> = {};
  const pending: Promise<unknown>[] = [];
  async function request(page = 1, username = 'large-author', useCache = false) {
    const url = new URL(`https://skills.cat/u/${username}?page=${page}`);
    return load({
      params: { username }, url, request: new Request(url), locals: { user: null },
      setHeaders: (value: Record<string, string>) => Object.assign(headers, value),
      platform: { env: { DB: db }, caches: useCache ? { default: cache } : undefined,
        context: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } },
    } as never);
  }
  return { ...context, request, headers, cache, cacheEntries, pending };
}

afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach(({ sqlite }) => sqlite.close());
});

describe('public user profile pagination', () => {
  it.each([false, true])('paginates more than 100 skills with bounded D1 binds (registered=%s)', async (registered) => {
    const { request, queries, sqlite } = fixture(registered);
    const first = await request();
    const second = await request(2);
    const last = await request(6);
    expect(first.profile).toMatchObject({ skillCount: 137, totalStars: 1370, isRegistered: registered });
    expect(first.skills).toHaveLength(24);
    expect(second.skills).toHaveLength(24);
    expect(last.skills).toHaveLength(17);
    expect(first.skills[0]).toMatchObject({ id: 'skill-000', categories: ['testing'] });
    expect(second.skills[0].id).toBe('skill-024');
    expect(last.skills.at(-1)?.id).toBe('skill-136');
    expect(first.pagination).toEqual({ currentPage: 1, totalPages: 6, totalItems: 137, itemsPerPage: 24, baseUrl: '/u/large-author' });
    expect(second.profile).toEqual(first.profile);
    expect(Math.max(...queries.map((query) => query.params.length))).toBeLessThanOrEqual(26);
    for (const query of queries.filter(({ sql }) => sql.includes('FROM skill_categories'))) {
      expect(query.params.length).toBeLessThanOrEqual(24);
    }
    const idsQuery = queries.find(({ sql }) => sql.includes('SELECT s.id\n'))!;
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${idsQuery.sql}`).all(...idsQuery.params) as Array<{ detail: string }>;
    expect(plan.map(({ detail }) => detail).join('\n')).toContain(registered ? 'skills_owner_visibility_stars_idx' : 'skills_visibility_repo_owner_idx');
    expect(JSON.stringify(first)).not.toContain('fixture@example.invalid');
  });

  it('returns 404 for pages beyond the collection and rejects the global cap before querying', async () => {
    const { request, queries } = fixture();
    await expect(request(7)).rejects.toMatchObject({ status: 404 });
    queries.length = 0;
    await expect(request(101)).rejects.toMatchObject({ status: 404 });
    expect(queries).toEqual([]);
  });

  it('handles empty authors and nonexistent authors with the correct status', async () => {
    const { request, headers } = fixture(false, 0);
    const empty = await request();
    expect(empty.profile).toMatchObject({ skillCount: 0, totalStars: 0 });
    expect(empty.skills).toEqual([]);
    expect((await request(1, 'missing')).profile).toBeNull();
    expect(headers['X-Skillscat-Status-Override']).toBe('404');
  });

  it('keeps page caches separate and never reuses an unpaginated v2 payload', async () => {
    const { request, cacheEntries, pending, queries } = fixture();
    cacheEntries.set('https://cache/user-profile:v2:large-author', Response.json({ profile: {}, skills: Array(137).fill({}) }));
    const first = await request(1, 'large-author', true);
    const second = await request(2, 'large-author', true);
    await Promise.all(pending);
    expect(first.skills[0].id).toBe('skill-000');
    expect(second.skills[0].id).toBe('skill-024');
    queries.length = 0;
    expect(await request(2, 'large-author', true)).toEqual(second);
    expect(queries).toEqual([]);
  });
});
