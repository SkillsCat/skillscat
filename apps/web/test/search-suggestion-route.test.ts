import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

  async run() {
    this.db.prepare(this.sql).run(...this.params);
    return { success: true };
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

function createSearchSuggestionDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      repo_owner TEXT,
      repo_name TEXT,
      stars INTEGER NOT NULL DEFAULT 0,
      trending_score REAL NOT NULL DEFAULT 0,
      download_count_30d INTEGER NOT NULL DEFAULT 0,
      download_count_90d INTEGER NOT NULL DEFAULT 0,
      access_count_30d INTEGER NOT NULL DEFAULT 0,
      last_commit_at INTEGER,
      updated_at INTEGER,
      tier TEXT,
      visibility TEXT NOT NULL
    );
    CREATE INDEX skills_visibility_trending_desc_idx ON skills (visibility, trending_score);
    CREATE INDEX skills_visibility_lower_name_idx ON skills (visibility, LOWER(name));
    CREATE INDEX skills_visibility_lower_slug_idx ON skills (visibility, LOWER(slug));
    CREATE INDEX skills_visibility_lower_repo_owner_idx ON skills (visibility, LOWER(repo_owner));
    CREATE INDEX skills_visibility_lower_repo_name_idx ON skills (visibility, LOWER(repo_name));

    CREATE TABLE authors (
      username TEXT PRIMARY KEY NOT NULL,
      avatar_url TEXT
    );

    CREATE TABLE skill_search_prefixes (
      skill_id TEXT NOT NULL,
      prefix TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'token',
      weight REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (skill_id, prefix)
    );
    CREATE INDEX skill_search_prefixes_prefix_weight_skill_idx
      ON skill_search_prefixes (prefix, weight DESC, skill_id);

    CREATE TABLE skill_categories (
      skill_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (skill_id, category_slug)
    );
    CREATE INDEX skill_categories_category_skill_idx
      ON skill_categories (category_slug, skill_id);
  `);

  return sqlite;
}

afterEach(() => {
  vi.resetModules();
});

describe('/api/search suggestion route', () => {
  it('uses the precomputed prefix table for skill suggestions', async () => {
    const sqlite = createSearchSuggestionDb();
    sqlite.exec(`
      INSERT INTO authors (username, avatar_url)
      VALUES ('acme', 'https://img.example/acme.png');

      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, stars, trending_score,
        download_count_30d, download_count_90d, access_count_30d, last_commit_at,
        updated_at, tier, visibility
      ) VALUES
        ('skill-react', 'React Toolkit', 'react-toolkit', 'Fast React helpers', 'acme', 'toolkit', 120, 80, 50, 90, 60, 1710000000000, 1710000000000, 'hot', 'public'),
        ('skill-redis', 'Redis Agent', 'redis-agent', 'Redis helpers', 'acme', 'redis-agent', 80, 60, 30, 70, 25, 1710000000000, 1710000000000, 'warm', 'public');

      INSERT INTO skill_search_prefixes (skill_id, prefix, source, weight, created_at, updated_at)
      VALUES
        ('skill-react', 're', 'name', 18, 1, 1),
        ('skill-react', 'rea', 'name', 18, 1, 1),
        ('skill-react', 'reac', 'name', 18, 1, 1),
        ('skill-react', 'react', 'name', 18, 1, 1),
        ('skill-redis', 're', 'name', 12, 1, 1);
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const { GET } = await import('../src/routes/api/search/+server');
    const response = await GET({
      platform: { env: { DB: db } },
      request: new Request('https://skills.cat/api/search?q=rea&limit=5'),
      url: new URL('https://skills.cat/api/search?q=rea&limit=5'),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-cache')).toBe('MISS');

    const payload = await response.json();
    expect(payload.data.skills.map((skill: { id: string }) => skill.id)).toEqual(['skill-react']);
    expect(db.queries.some((sql) => sql.includes('FROM skill_search_prefixes'))).toBe(true);
    expect(db.queries.some((sql) => sql.includes('FROM skill_search_terms'))).toBe(false);
  });

  it('applies category filtering on precomputed prefix candidates', async () => {
    const sqlite = createSearchSuggestionDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, stars, trending_score,
        download_count_30d, download_count_90d, access_count_30d, last_commit_at,
        updated_at, tier, visibility
      ) VALUES
        ('skill-agent', 'Agent Runner', 'agent-runner', 'Automation runner', 'acme', 'agent-runner', 90, 70, 40, 80, 20, 1710000000000, 1710000000000, 'hot', 'public'),
        ('skill-api', 'API Runner', 'api-runner', 'API runner', 'acme', 'api-runner', 85, 65, 38, 79, 19, 1710000000000, 1710000000000, 'warm', 'public');

      INSERT INTO skill_search_prefixes (skill_id, prefix, source, weight, created_at, updated_at)
      VALUES
        ('skill-agent', 'ru', 'name', 16, 1, 1),
        ('skill-agent', 'run', 'name', 16, 1, 1),
        ('skill-api', 'ru', 'name', 15, 1, 1),
        ('skill-api', 'run', 'name', 15, 1, 1);

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-agent', 'automation'),
        ('skill-api', 'api');
    `);

    const { GET } = await import('../src/routes/api/search/+server');
    const response = await GET({
      platform: { env: { DB: new LoggingSqliteD1Database(sqlite) } },
      request: new Request('https://skills.cat/api/search?q=run&category=automation&limit=5'),
      url: new URL('https://skills.cat/api/search?q=run&category=automation&limit=5'),
    } as never);

    const payload = await response.json();
    expect(payload.data.skills.map((skill: { id: string }) => skill.id)).toEqual(['skill-agent']);
  });

  it('supplements long queries with indexed text prefix matches when the prefix table is incomplete', async () => {
    const sqlite = createSearchSuggestionDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, stars, trending_score,
        download_count_30d, download_count_90d, access_count_30d, last_commit_at,
        updated_at, tier, visibility
      ) VALUES
        ('skill-tools', 'Langchain Tools', 'langchain-tools', 'Tooling', 'acme', 'langchain-tools', 90, 50, 20, 30, 10, 1710000000000, 1710000000000, 'hot', 'public'),
        ('skill-tasks', 'Langchain Tasks', 'langchain-tasks', 'Tasks', 'acme', 'langchain-tasks', 120, 80, 30, 40, 12, 1710000000000, 1710000000000, 'hot', 'public');

      INSERT INTO skill_search_prefixes (skill_id, prefix, source, weight, created_at, updated_at)
      VALUES
        ('skill-tasks', 'langchai', 'name', 20, 1, 1);
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const { GET } = await import('../src/routes/api/search/+server');
    const response = await GET({
      platform: { env: { DB: db } },
      request: new Request('https://skills.cat/api/search?q=langchain%20to&limit=5'),
      url: new URL('https://skills.cat/api/search?q=langchain%20to&limit=5'),
    } as never);

    const payload = await response.json();
    expect(payload.data.skills.map((skill: { id: string }) => skill.id)).toEqual(['skill-tools', 'skill-tasks']);
    expect(db.queries.filter((sql) => sql.includes('FROM skill_search_prefixes')).length).toBeGreaterThan(0);
    expect(db.queries.filter((sql) => sql.includes('skills_visibility_lower_name_idx')).length).toBeGreaterThan(0);
  });
});
