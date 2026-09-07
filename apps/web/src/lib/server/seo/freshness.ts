/** CASE expressions also round-trip correctly through Drizzle's SQLite index generator. */
export function firstPublishedSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `CASE WHEN ${p}first_published_at IS NOT NULL THEN ${p}first_published_at WHEN ${p}created_at IS NOT NULL THEN ${p}created_at ELSE ${p}indexed_at END`;
}

export function seoFreshnessSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  const source = `(CASE WHEN ${p}last_commit_at IS NOT NULL THEN ${p}last_commit_at ELSE ${p}updated_at END)`;
  const changed = `(CASE WHEN ${p}content_updated_at > ${source} THEN ${p}content_updated_at ELSE ${source} END)`;
  const published = `(${firstPublishedSql(alias)})`;
  return `CASE WHEN ${published} > ${changed} THEN ${published} ELSE ${changed} END`;
}
