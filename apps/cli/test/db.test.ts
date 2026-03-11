import { beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, resetTestConfigDir } from './helpers/env';
import { getAgentById } from '../src/utils/agents/agents';

describe('installed db identity', () => {
  beforeEach(() => {
    createWorkspace('db');
    resetTestConfigDir();
  });

  it('keeps project and global records separate, while replacing exact identity', async () => {
    const { recordInstallation, getInstalledSkills } = await import('../src/utils/storage/db');
    const globalClaude = getAgentById('claude-code');
    const projectClaude = join(process.cwd(), '.claude', 'skills', 'Shared Skill');
    const projectCursor = join(process.cwd(), '.cursor', 'skills', 'Shared Skill');
    if (!globalClaude) {
      throw new Error('claude-code agent missing in test');
    }

    const globalSkillDir = join(globalClaude.globalPath, 'Shared Skill');
    mkdirSync(projectClaude, { recursive: true });
    mkdirSync(projectCursor, { recursive: true });
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(join(projectClaude, 'SKILL.md'), '# shared skill', 'utf-8');
    writeFileSync(join(projectCursor, 'SKILL.md'), '# shared skill', 'utf-8');
    writeFileSync(join(globalSkillDir, 'SKILL.md'), '# shared skill', 'utf-8');

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
      installRoot: process.cwd(),
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
      installRoot: process.cwd(),
    });

    skills = getInstalledSkills();
    expect(skills).toHaveLength(2);

    const projectSkill = skills.find((skill) => !skill.global);
    expect(projectSkill?.agents).toEqual(['cursor']);
    expect(projectSkill?.installedAt).toBe(3);
  });

  it('can copy tracked installs from .agents to a specific agent target', async () => {
    const {
      copyInstallationAgent,
      getInstalledSkills,
      recordInstallation,
    } = await import('../src/utils/storage/db');

    recordInstallation({
      name: 'Shared Skill',
      description: 'test',
      source: { platform: 'github', owner: 'owner', repo: 'repo' },
      agents: ['agents'],
      global: false,
      installedAt: 1,
      path: 'SKILL.md',
    });

    const updated = copyInstallationAgent('agents', 'claude-code', { global: false });
    const skills = getInstalledSkills();

    expect(updated).toBe(1);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.agents).toEqual(['agents', 'claude-code']);
  });

  it('prunes tracked agents after the local skill is manually deleted', async () => {
    const workspace = process.cwd();
    const { getInstalledSkills, recordInstallation } = await import('../src/utils/storage/db');

    const skillDir = join(workspace, '.agents', 'Deleted Skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# deleted skill', 'utf-8');

    recordInstallation({
      name: 'Deleted Skill',
      description: 'test',
      source: { platform: 'github', owner: 'owner', repo: 'repo' },
      agents: ['agents'],
      global: false,
      installedAt: 1,
      path: 'SKILL.md',
      installRoot: workspace,
    });

    expect(getInstalledSkills()).toHaveLength(1);

    rmSync(skillDir, { recursive: true, force: true });

    expect(getInstalledSkills()).toHaveLength(0);
  });
});
