import { describe, expect, it } from 'vitest';
import {
  buildSkillscatInstallCommand,
  buildVercelSkillsInstallCommand,
  splitShellCommand,
} from '../src/lib/skill-install';

describe('buildSkillscatInstallCommand', () => {
  it('uses repo install for root GitHub skills', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/testrepo',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
    })).toBe('npx skillscat add testowner/testrepo');
  });

  it('uses repo plus --skill for multi-skill GitHub skills', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/testrepo/nested-skill',
      skillName: 'Nested Skill',
      skillPath: 'skills/nested-skill',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
    })).toBe('npx skillscat add testowner/testrepo --skill "Nested Skill"');
  });

  it('falls back to slug for uploaded skills', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/uploaded-skill',
    })).toBe('npx skillscat add testowner/uploaded-skill');
  });

  it('falls back to exact slug for colliding GitHub root skills', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/testrepo-ab12',
      skillName: 'Test Repo',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
    })).toBe('npx skillscat add testowner/testrepo-ab12');
  });
});

describe('buildVercelSkillsInstallCommand', () => {
  it('uses add subcommand for root GitHub skills', () => {
    expect(buildVercelSkillsInstallCommand({
      slug: 'testowner/testrepo',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
    })).toBe('npx skills add testowner/testrepo');
  });

  it('uses --skill for multi-skill GitHub skills', () => {
    expect(buildVercelSkillsInstallCommand({
      slug: 'testowner/testrepo/nested-skill',
      skillName: 'Nested Skill',
      skillPath: 'skills/nested-skill',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
    })).toBe('npx skills add testowner/testrepo --skill "Nested Skill"');
  });

  it('returns null for uploaded skills', () => {
    expect(buildVercelSkillsInstallCommand({
      slug: 'testowner/uploaded-skill',
      sourceType: 'upload',
    })).toBeNull();
  });
});

describe('splitShellCommand', () => {
  it('keeps quoted skill names together', () => {
    expect(splitShellCommand('npx skills add testowner/testrepo --skill "Nested Skill"')).toEqual([
      'npx',
      'skills',
      'add',
      'testowner/testrepo',
      '--skill',
      '"Nested Skill"',
    ]);
  });
});
