import { describe, expect, it } from 'vitest';
import { buildSkillscatInstallCommand, shouldScopeSkillscatInstall } from '../src/lib/skill-install';

describe('buildSkillscatInstallCommand', () => {
  it('uses the repo shorthand for the repo entrypoint skill', () => {
    expect(buildSkillscatInstallCommand({
      name: 'Repo Skill',
      slug: 'testowner/testrepo',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
      sourceType: 'github',
    })).toBe('npx skillscat add testowner/testrepo');
  });

  it('scopes multi-skill repo installs to the current skill', () => {
    expect(buildSkillscatInstallCommand({
      name: 'Nested Skill',
      slug: 'testowner/nested-skill',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
      sourceType: 'github',
    })).toBe('npx skillscat add testowner/testrepo --skill "Nested Skill"');
  });

  it('escapes shell-sensitive characters in scoped skill names', () => {
    expect(buildSkillscatInstallCommand({
      name: 'Bill "$HOME" `pwd`',
      slug: 'testowner/bill-home',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
      sourceType: 'github',
    })).toBe('npx skillscat add testowner/testrepo --skill "Bill \\"\\$HOME\\" \\`pwd\\`"');
  });

  it('uses the slug for uploaded or non-public skills', () => {
    expect(buildSkillscatInstallCommand({
      name: 'Uploaded Skill',
      slug: 'testowner/uploaded-skill',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
      sourceType: 'upload',
    })).toBe('npx skillscat add testowner/uploaded-skill');

    expect(buildSkillscatInstallCommand({
      name: 'Private Skill',
      slug: 'testowner/private-skill',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'private',
      sourceType: 'github',
    })).toBe('npx skillscat add testowner/private-skill');
  });
});

describe('shouldScopeSkillscatInstall', () => {
  it('only scopes public github skills whose slug differs from owner/repo', () => {
    expect(shouldScopeSkillscatInstall({
      name: 'Repo Skill',
      slug: 'testowner/testrepo',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
      sourceType: 'github',
    })).toBe(false);

    expect(shouldScopeSkillscatInstall({
      name: 'Nested Skill',
      slug: 'testowner/nested-skill',
      repoOwner: 'testowner',
      repoName: 'testrepo',
      visibility: 'public',
      sourceType: 'github',
    })).toBe(true);
  });
});
