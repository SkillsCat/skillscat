import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function createMigratedDb() {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
  }
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  function prepare(sql: string) {
    let params: unknown[] = [];
    const record = { sql, params };
    queries.push(record);
    return {
      bind(...values: unknown[]) { params = values; record.params = values; return this; },
      async first<T>() { return (sqlite.prepare(sql).get(...params) as T) ?? null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...params) as T[], success: true, meta: {} }; },
      async run() { const result = sqlite.prepare(sql).run(...params); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    };
  }
  const db = { prepare, async batch(statements: Array<ReturnType<typeof prepare>>) {
    sqlite.exec('BEGIN');
    try { const results = await Promise.all(statements.map((statement) => statement.run())); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  return { sqlite, db, queries };
}

export function createMemoryKv() {
  const values = new Map<string, string>();
  const kv = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) { values.set(key, value); },
    async delete(key: string) { values.delete(key); },
  } as unknown as KVNamespace;
  return { kv, values };
}
