import type { GitHubGraphQLRepoData, SkillRecord } from '../types';

const SKILL_REFRESH_SELECT_COLUMNS = `
  id, repo_owner, repo_name, stars, forks, star_snapshots, indexed_at, last_commit_at,
  tier, last_accessed_at, access_count_7d, download_count_7d, next_update_at`;

export function getSkillRefreshSelectColumns(): string {
  return SKILL_REFRESH_SELECT_COLUMNS;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function resolveRefreshRepoMetrics(
  skill: Pick<SkillRecord, 'id' | 'stars' | 'forks' | 'last_commit_at'>,
  ghData?: Pick<GitHubGraphQLRepoData, 'stargazerCount' | 'forkCount' | 'pushedAt'> | null
): { stars: number; forks: number; lastCommitAt: number | null } | null {
  const fallbackStars = isFiniteNumber(skill.stars) ? skill.stars : null;
  const fallbackForks = isFiniteNumber(skill.forks) ? skill.forks : null;

  const stars = ghData?.stargazerCount ?? fallbackStars;
  const forks = ghData?.forkCount ?? fallbackForks;

  if (stars === null || forks === null) {
    return null;
  }

  if (!ghData?.pushedAt) {
    return { stars, forks, lastCommitAt: skill.last_commit_at };
  }

  const pushedAt = new Date(ghData.pushedAt).getTime();
  return {
    stars,
    forks,
    lastCommitAt: Number.isFinite(pushedAt) ? pushedAt : skill.last_commit_at,
  };
}
