import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, resetTestConfigDir } from './helpers/env';

describe('installed db identity', () => {
  beforeEach(() => {
    createWorkspace('db');
    resetTestConfigDir();
  });

  it('keeps project and global records separate, while replacing exact identity', async () => {
    const { recordInstallation, getInstalledSkills } = await import('../src/utils/storage/db');

    const baseRecord = {
      name: 'Shared Skill',
      description: 'test',
      source: { platform: 'github' as const, owner: 'owner', repo: 'repo' },
      agents: ['claude-code'],
      path: 'SKILL.md',
    };

    recordInstallation({
      ...baseRecord,
      global: false,
      installedAt: 1,
    });

    recordInstallation({
      ...baseRecord,
      global: true,
      installedAt: 2,
    });

    let skills = getInstalledSkills();
    expect(skills).toHaveLength(2);
    expect(skills.some((skill) => !skill.global)).toBe(true);
    expect(skills.some((skill) => skill.global)).toBe(true);

    recordInstallation({
      ...baseRecord,
      global: false,
      installedAt: 3,
      agents: ['cursor'],
    });

    skills = getInstalledSkills();
    expect(skills).toHaveLength(2);

    const projectSkill = skills.find((skill) => !skill.global);
    expect(projectSkill?.agents).toEqual(['cursor']);
    expect(projectSkill?.installedAt).toBe(3);
  });
});
