import { describe, expect, it } from 'vitest';

import { SKILL_REFRESH_SELECT_COLUMNS, resolveRefreshRepoMetrics } from '../workers/trending';
import type { SkillRecord } from '../workers/shared/types';

type RefreshSkill = Pick<SkillRecord, 'id' | 'stars' | 'forks' | 'last_commit_at'>;

const baseSkill: RefreshSkill = {
  id: 'skill-1',
  stars: 123,
  forks: 17,
  last_commit_at: 1_700_000_000_000,
};

describe('SKILL_REFRESH_SELECT_COLUMNS', () => {
  it('selects forks for refresh fallbacks', () => {
    expect(SKILL_REFRESH_SELECT_COLUMNS).toContain('forks');
  });
});

describe('resolveRefreshRepoMetrics', () => {
  it('keeps stored metrics when GitHub metadata is unavailable', () => {
    expect(resolveRefreshRepoMetrics(baseSkill, null)).toEqual({
      stars: 123,
      forks: 17,
      lastCommitAt: 1_700_000_000_000,
    });
  });

  it('keeps the stored last commit timestamp when pushedAt is null', () => {
    expect(resolveRefreshRepoMetrics(baseSkill, {
      stargazerCount: 150,
      forkCount: 23,
      pushedAt: null,
    })).toEqual({
      stars: 150,
      forks: 23,
      lastCommitAt: 1_700_000_000_000,
    });
  });

  it('refuses to build an update when fallback metrics are missing', () => {
    const incompleteSkill = {
      ...baseSkill,
      forks: undefined,
    } as unknown as RefreshSkill;

    expect(resolveRefreshRepoMetrics(incompleteSkill, null)).toBeNull();
  });
});
