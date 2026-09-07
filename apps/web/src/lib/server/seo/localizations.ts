import { parseLocalizedSummaries, sanitizeSummary, SUMMARY_GENERATION_VERSION, type SummaryLocale } from '$lib/seo/summary';

export async function readSkillLocalizations(db: D1Database, skillId: string, sourceHash: string) {
  const rows = await db.prepare(`
    SELECT locale, summary, updated_at FROM skill_localizations
    WHERE skill_id = ? AND source_hash = ? AND generation_version = ? AND summary IS NOT NULL
  `).bind(skillId, sourceHash, SUMMARY_GENERATION_VERSION)
    .all<{ locale: SummaryLocale; summary: string; updated_at: number }>();
  const summaries: Partial<Record<SummaryLocale, string>> = {};
  for (const row of rows.results || []) {
    const summary = sanitizeSummary(row.summary, row.locale);
    if (summary) summaries[row.locale] = summary;
  }
  return summaries;
}

/** Guard against a source changing while a model request was in flight. */
export async function persistSkillLocalizations(
  db: D1Database, skillId: string, sourceHash: string, value: unknown, now = Date.now()
): Promise<boolean> {
  const summaries = parseLocalizedSummaries(value);
  const statements = Object.entries(summaries).map(([locale, summary]) => db.prepare(`
    INSERT INTO skill_localizations
      (skill_id, locale, summary, source_hash, generation_version, updated_at, next_attempt_at, fail_count)
    SELECT id, ?, ?, ?, ?, ?, 0, 0 FROM skills
    WHERE id = ? AND COALESCE(content_hash, commit_sha, CAST(indexed_at AS TEXT)) = ?
    ON CONFLICT(skill_id, locale) DO UPDATE SET
      summary = excluded.summary, source_hash = excluded.source_hash,
      generation_version = excluded.generation_version, updated_at = excluded.updated_at,
      next_attempt_at = 0, fail_count = 0
    WHERE skill_localizations.source_hash <> excluded.source_hash
      OR skill_localizations.generation_version <> excluded.generation_version
      OR skill_localizations.summary IS NOT excluded.summary
  `).bind(locale, summary, sourceHash, SUMMARY_GENERATION_VERSION, now, skillId, sourceHash));
  if (summaries.en) statements.push(db.prepare(`
    UPDATE skills SET summary = ?, content_updated_at = ? WHERE id = ?
      AND COALESCE(content_hash, commit_sha, CAST(indexed_at AS TEXT)) = ?
      AND summary IS NOT ?
  `).bind(summaries.en, now, skillId, sourceHash, summaries.en));
  if (!statements.length) return false;
  statements.push(db.prepare(`UPDATE skills SET content_updated_at = ?
    WHERE id = ? AND COALESCE(content_hash, commit_sha, CAST(indexed_at AS TEXT)) = ?
      AND content_updated_at IS NOT ?
      AND EXISTS (SELECT 1 FROM skill_localizations WHERE skill_id = ? AND updated_at = ?)`)
    .bind(now, skillId, sourceHash, now, skillId, now));
  const results = await db.batch(statements);
  return results.some((result) => (result.meta.changes || 0) > 0);
}

export async function recordLocalizationFailure(db: D1Database, skillId: string, sourceHash: string, now = Date.now()) {
  await db.prepare(`
    INSERT INTO skill_localizations
      (skill_id, locale, source_hash, generation_version, updated_at, next_attempt_at, fail_count)
    VALUES (?, 'zh-CN', ?, ?, ?, ?, 1)
    ON CONFLICT(skill_id, locale) DO UPDATE SET
      fail_count = MIN(skill_localizations.fail_count + 1, 6),
      next_attempt_at = ? + MIN(86400000, 3600000 * (1 << MIN(skill_localizations.fail_count, 5)))
  `).bind(skillId, sourceHash, SUMMARY_GENERATION_VERSION, now, now + 3600000, now).run();
}
