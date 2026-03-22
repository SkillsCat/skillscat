import { describe, expect, it } from 'vitest';
import {
  buildAgentInstallPrompt,
  buildSkillInstallData,
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

describe('buildAgentInstallPrompt', () => {
  it('includes preferred and fallback commands for public GitHub skills', () => {
    const prompt = buildAgentInstallPrompt({
      slug: 'testowner/testrepo/nested-skill',
      skillName: 'Nested Skill',
      skillPath: 'skills/nested-skill',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
    });

    expect(prompt).toContain('Install this SkillsCat skill into the current workspace.');
    expect(prompt).toContain('Preferred command:\nnpx skills add testowner/testrepo --skill "Nested Skill"');
    expect(prompt).toContain('Fallback command:\nnpx skillscat add testowner/testrepo --skill "Nested Skill"');
    expect(prompt).toContain('https://skills.cat/api/skills/testowner%2Ftestrepo%2Fnested-skill/files');
  });

  it('adds private-auth guidance when the skill is private', () => {
    const prompt = buildAgentInstallPrompt({
      slug: 'testowner/private-skill',
      skillName: 'Private Skill',
      sourceType: 'upload',
      visibility: 'private',
    });

    expect(prompt).toContain('This skill is private.');
    expect(prompt).toContain('npx skillscat login');
    expect(prompt).not.toContain('Fallback command:');
  });
});

describe('buildSkillInstallData', () => {
  it('returns both CLI methods for public GitHub skills', () => {
    expect(buildSkillInstallData({
      slug: 'testowner/testrepo',
      skillName: 'Test Repo',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
    }).cli).toEqual([
      { id: 'skillscat', command: 'npx skillscat add testowner/testrepo' },
      { id: 'skills', command: 'npx skills add testowner/testrepo' },
    ]);
  });

  it('keeps only the SkillsCat CLI for non-public installs', () => {
    expect(buildSkillInstallData({
      slug: 'testowner/private-skill',
      skillName: 'Private Skill',
      sourceType: 'github',
      repoOwner: 'testowner',
      repoName: 'private-skill',
      visibility: 'private',
    }).cli).toEqual([
      { id: 'skillscat', command: 'npx skillscat add testowner/private-skill' },
    ]);
  });
});
