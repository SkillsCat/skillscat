import { describe, expect, it } from 'vitest';

import { getNestedSkillPaths, resolveSkillRelativePath } from '../src/lib/server/skill/scope';

describe('skill scope helpers', () => {
  it('detects nested skill paths from a repository tree', () => {
    expect(getNestedSkillPaths([
      'SKILL.md',
      '.claude/SKILL.md',
      'agents/reviewer/skill.md',
      'docs/guide.md',
    ])).toEqual(['agents/reviewer', '.claude']);
  });

  it('keeps root skill files but excludes nested skill subtrees', () => {
    const nestedSkillPaths = ['agents/reviewer', '.claude'];

    expect(resolveSkillRelativePath('SKILL.md', null, nestedSkillPaths)).toBe('SKILL.md');
    expect(resolveSkillRelativePath('docs/guide.md', null, nestedSkillPaths)).toBe('docs/guide.md');
    expect(resolveSkillRelativePath('.claude/commands.md', null, nestedSkillPaths)).toBeNull();
    expect(resolveSkillRelativePath('agents/reviewer/prompt.md', null, nestedSkillPaths)).toBeNull();
  });

  it('maps nested skill files to relative paths inside their own scope', () => {
    expect(resolveSkillRelativePath('.claude/SKILL.md', '.claude')).toBe('SKILL.md');
    expect(resolveSkillRelativePath('.claude/prompts/review.md', '.claude')).toBe('prompts/review.md');
    expect(resolveSkillRelativePath('docs/guide.md', '.claude')).toBeNull();
  });
});
