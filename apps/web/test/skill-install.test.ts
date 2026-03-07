import { describe, expect, it } from 'vitest';
import { buildSkillscatInstallCommand } from '../src/lib/skill-install';

describe('buildSkillscatInstallCommand', () => {
  it('always uses slug for install command', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/testrepo',
    })).toBe('npx skillscat add testowner/testrepo');
  });

  it('uses slug for multi-skill repo skills', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/nested-skill',
    })).toBe('npx skillscat add testowner/nested-skill');
  });

  it('uses slug for uploaded or non-public skills', () => {
    expect(buildSkillscatInstallCommand({
      slug: 'testowner/uploaded-skill',
    })).toBe('npx skillscat add testowner/uploaded-skill');

    expect(buildSkillscatInstallCommand({
      slug: 'testowner/private-skill',
    })).toBe('npx skillscat add testowner/private-skill');
  });
});
