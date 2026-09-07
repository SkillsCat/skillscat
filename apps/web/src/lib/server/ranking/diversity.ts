interface Candidate { id: string; repoOwner: string; repoName: string }

export function diversify<T extends Candidate>(rows: T[], limit: number, authorLimit = Infinity): T[] {
  const repos = new Map<string, number>();
  const authors = new Map<string, number>();
  const ids = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const author = row.repoOwner?.toLowerCase() || row.id;
    const repo = row.repoName ? `${author}/${row.repoName.toLowerCase()}` : row.id;
    if (ids.has(row.id) || (repos.get(repo) || 0) >= 2 || (authors.get(author) || 0) >= authorLimit) continue;
    ids.add(row.id);
    repos.set(repo, (repos.get(repo) || 0) + 1);
    authors.set(author, (authors.get(author) || 0) + 1);
    result.push(row);
    if (result.length >= limit) break;
  }
  return result;
}
