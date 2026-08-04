import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  invalidateCache: vi.fn(),
  getRegistrySearchCacheRevision: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  getCached: mocks.getCached,
  invalidateCache: mocks.invalidateCache,
}));

vi.mock('../src/lib/server/registry/cache', () => ({
  getRegistrySearchCacheRevision: mocks.getRegistrySearchCacheRevision,
}));

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

class SqliteD1Statement {
  private params: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    return {
      results: this.db.prepare(this.sql).all(...this.params) as T[],
    };
  }
}

class LoggingSqliteD1Database {
  readonly queries: string[] = [];

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    this.queries.push(normalizeSql(sql));
    return new SqliteD1Statement(this.db, sql);
  }
}

function createSkillsDb(rows: Array<{ id: string; visibility: string }>): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      visibility TEXT NOT NULL
    );
    CREATE INDEX skills_visibility_id_idx ON skills (visibility, id);
  `);
  for (const row of rows) {
    sqlite.prepare('INSERT INTO skills (id, visibility) VALUES (?, ?)').run(row.id, row.visibility);
  }
  return sqlite;
}

const cachedResult = {
  skills: [
    { id: 'skill-1', name: 'One', slug: 'one' },
    { id: 'skill-2', name: 'Two', slug: 'two' },
  ],
  total: 2,
};

const searchInput = {
  query: 'demo',
  category: '',
  limit: 20,
  offset: 0,
  includePrivate: false,
};

function createWaitUntilCapture() {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.getRegistrySearchCacheRevision.mockResolvedValue('rev1');
  mocks.getCached.mockResolvedValue({ data: cachedResult, hit: true });
  mocks.invalidateCache.mockResolvedValue(undefined);
});

describe('registry search cache visibility recheck', () => {
  it('serves a cache hit without waiting for the D1 visibility recheck', async () => {
    const sqlite = createSkillsDb([
      { id: 'skill-1', visibility: 'public' },
      { id: 'skill-2', visibility: 'public' },
    ]);
    const inner = new LoggingSqliteD1Database(sqlite);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = {
      prepare(sql: string) {
        const statement = inner.prepare(sql);
        return {
          bind(...params: unknown[]) {
            const bound = statement.bind(...params);
            return {
              ...bound,
              all: async <T,>() => {
                await gate;
                return bound.all<T>();
              },
            };
          },
        };
      },
    };
    const { tasks, waitUntil } = createWaitUntilCapture();
    const { resolveRegistrySearch } = await import('../src/lib/server/registry/search');

    // The D1 recheck query stays blocked; the response must not wait for it.
    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?q=demo'),
      locals: {} as App.Locals,
      waitUntil,
    }, searchInput);

    expect(resolved.cacheStatus).toBe('HIT');
    expect(resolved.data.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2']);
    expect(resolved.data.total).toBe(2);
    expect(tasks).toHaveLength(1);
    expect(mocks.invalidateCache).not.toHaveBeenCalled();

    release();
    await Promise.all(tasks);
    expect(inner.queries.some((sql) => sql.includes("visibility = 'public'"))).toBe(true);
    expect(mocks.invalidateCache).not.toHaveBeenCalled();
  });

  it('invalidates the search cache key when the async recheck finds a stale skill', async () => {
    const sqlite = createSkillsDb([
      { id: 'skill-1', visibility: 'public' },
      { id: 'skill-2', visibility: 'private' },
    ]);
    const db = new LoggingSqliteD1Database(sqlite);
    const { tasks, waitUntil } = createWaitUntilCapture();
    const { resolveRegistrySearch } = await import('../src/lib/server/registry/search');

    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?q=demo'),
      locals: {} as App.Locals,
      waitUntil,
    }, searchInput);

    expect(resolved.cacheStatus).toBe('HIT');
    expect(resolved.data.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2']);

    await Promise.all(tasks);
    expect(mocks.invalidateCache).toHaveBeenCalledWith('search:v2:rev1:demo::20:0');
  });

  it('keeps the response intact when the async recheck fails', async () => {
    const db = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    };
    const { tasks, waitUntil } = createWaitUntilCapture();
    const { resolveRegistrySearch } = await import('../src/lib/server/registry/search');

    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?q=demo'),
      locals: {} as App.Locals,
      waitUntil,
    }, searchInput);

    expect(resolved.cacheStatus).toBe('HIT');
    expect(resolved.data.skills).toHaveLength(2);
    expect(tasks).toHaveLength(1);
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    expect(mocks.invalidateCache).not.toHaveBeenCalled();
  });
});
