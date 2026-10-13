import { describe, expect, it } from 'vitest';
import { createMigratedDb } from './helpers/migrated-db';
import { replaceSearchTermsForSkill, replaceSearchPrefixesForSkill } from '../src/lib/server/ranking/search-precompute';

describe('bounded search index inserts', () => {
  it.each(['terms', 'prefixes'] as const)('retains the previous %s if a later insert chunk fails', async (kind) => {
    const { sqlite, db } = createMigratedDb();
    try {
      sqlite.exec(`INSERT INTO skills (id, name, slug, repo_owner, repo_name, indexed_at)
        VALUES ('one', 'One', 'test/one', 'test', 'one', 1)`);
      const replace = (values: string[], now: number) => kind === 'terms'
        ? replaceSearchTermsForSkill(db, { skillId: 'one', terms: values.map((term) => ({ term, source: 'name', weight: 1 })), now })
        : replaceSearchPrefixesForSkill(db, { skillId: 'one', prefixes: values.map((prefix) => ({ prefix, source: 'name', weight: 1 })), now });
      await replace(['previous'], 123);
      // Repeat a key in the second chunk, after the first chunk has succeeded.
      const invalid = Array.from({ length: 17 }, (_, index) => `value${index % 16}`);
      await expect(replace(invalid, 456)).rejects.toThrow(/UNIQUE constraint failed/);
      const column = kind === 'terms' ? 'term' : 'prefix';
      expect(sqlite.prepare(`SELECT ${column} AS value, created_at, updated_at FROM skill_search_${kind} WHERE skill_id = ?`).all('one'))
        .toEqual([{ value: 'previous', created_at: 123, updated_at: 123 }]);
      await replace(['retry'], 789);
      expect(sqlite.prepare(`SELECT ${column} AS value FROM skill_search_${kind} WHERE skill_id = ?`).all('one'))
        .toEqual([{ value: 'retry' }]);
    } finally { sqlite.close(); }
  });

  it('preserves values and isolates skills while keeping every statement below 100 parameters', async () => {
    const { sqlite, db, queries } = createMigratedDb();
    try {
      sqlite.exec(`INSERT INTO skills (id, name, slug, repo_owner, repo_name, indexed_at)
        VALUES ('one', 'One', 'test/one', 'test', 'one', 1), ('two', 'Two', 'test/two', 'test', 'two', 1)`);
      const terms = Array.from({ length: 96 }, (_, index) => ({ term: `词${index}`, source: 'name', weight: index / 10 }));
      const prefixes = Array.from({ length: 160 }, (_, index) => ({ prefix: `pre${index}`, source: 'tag', weight: index / 10 }));
      await replaceSearchTermsForSkill(db, { skillId: 'two', terms: [{ term: 'keep', source: '', weight: 1 }], now: 1 });
      queries.length = 0;
      await replaceSearchTermsForSkill(db, { skillId: 'one', terms, now: 123 });
      await replaceSearchPrefixesForSkill(db, { skillId: 'one', prefixes, now: 123 });
      const inserts = queries.filter((query) => query.sql.includes('INSERT INTO'));
      expect(inserts).toHaveLength(16);
      expect(inserts.every((query) => query.params.length <= 100)).toBe(true);
      expect(sqlite.prepare('SELECT term, source, weight FROM skill_search_terms WHERE skill_id = ? ORDER BY rowid').all('one')).toEqual(terms);
      expect(sqlite.prepare('SELECT prefix, source, weight FROM skill_search_prefixes WHERE skill_id = ? ORDER BY rowid').all('one')).toEqual(prefixes);
      expect(sqlite.prepare('SELECT DISTINCT created_at, updated_at FROM skill_search_terms WHERE skill_id = ?').all('one')).toEqual([{ created_at: 123, updated_at: 123 }]);

      await replaceSearchTermsForSkill(db, { skillId: 'one', terms: [{ term: 'replacement', source: '', weight: 2 }], now: 456 });
      expect(sqlite.prepare('SELECT term, source FROM skill_search_terms WHERE skill_id = ?').all('one')).toEqual([{ term: 'replacement', source: 'token' }]);
      await replaceSearchPrefixesForSkill(db, { skillId: 'one', prefixes: [], now: 456 });
      expect(sqlite.prepare('SELECT count(*) AS count FROM skill_search_prefixes WHERE skill_id = ?').get('one')).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT term FROM skill_search_terms WHERE skill_id = ?').all('two')).toEqual([{ term: 'keep' }]);
    } finally { sqlite.close(); }
  });
});
