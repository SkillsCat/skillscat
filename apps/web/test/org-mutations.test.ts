import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { buildTouchOrganizationStatement } from '../src/lib/server/org/mutations';

class SqliteD1Statement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Database {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.sqlite, sql);
  }
}

describe('organization mutation markers', () => {
  it('always advances updated_at even when mutations share a millisecond', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO organizations (id, updated_at) VALUES ('org-1', 100);
    `);
    const db = new SqliteD1Database(sqlite) as unknown as D1Database;

    await buildTouchOrganizationStatement(db, 'org-1', 100).run();
    expect(sqlite.prepare(`SELECT updated_at FROM organizations WHERE id = 'org-1'`).get())
      .toEqual({ updated_at: 101 });

    await buildTouchOrganizationStatement(db, 'org-1', 50).run();
    expect(sqlite.prepare(`SELECT updated_at FROM organizations WHERE id = 'org-1'`).get())
      .toEqual({ updated_at: 102 });

    await buildTouchOrganizationStatement(db, 'org-1', 200).run();
    expect(sqlite.prepare(`SELECT updated_at FROM organizations WHERE id = 'org-1'`).get())
      .toEqual({ updated_at: 200 });
  });
});
