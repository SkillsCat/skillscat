import { describe, expect, it } from 'vitest';
import { parseSource, parseSkillFrontmatter } from '../src/utils/source/source';

describe('repository source parsing', () => {
  it.each([
    ['git@github.com:owner/repo.git', 'github', 'owner', 'repo'],
    ['git@gitlab.com:group/subgroup/repo.git', 'gitlab', 'group/subgroup', 'repo'],
    ['https://gitlab.com/group/repo', 'gitlab', 'group', 'repo'],
    ['https://gitlab.com/group/subgroup/repo.git', 'gitlab', 'group/subgroup', 'repo'],
  ])('parses %s', (input, platform, owner, repo) => {
    expect(parseSource(input)).toMatchObject({ platform, owner, repo });
  });
  it('parses GitLab tree and blob URLs with namespaces and encoded refs', () => {
    for (const kind of ['tree', 'blob']) {
      expect(parseSource(`https://gitlab.com/group/sub/repo/-/${kind}/feature%2Ftest/skills/demo/SKILL.md`))
        .toMatchObject({ platform: 'gitlab', owner: 'group/sub', repo: 'repo', branch: 'feature/test', path: 'skills/demo/SKILL.md' });
    }
  });
  it.each(['https://evil.test/gitlab.com/group/repo', 'https://github.com/owner/repo/tree', '../repo', 'owner/../skill', 'owner/repo/../skill'])('rejects %s', (input) => {
    expect(parseSource(input)).toBeNull();
  });
});

describe('SKILL.md frontmatter', () => {
  it('accepts BOM and Windows line endings', () => {
    expect(parseSkillFrontmatter('\uFEFF---\r\nname: demo\r\ndescription: example\r\n---\r\n# Body'))
      .toMatchObject({ name: 'demo', description: 'example' });
  });
  it('parses YAML block scalars, quoted strings and comments', () => {
    expect(parseSkillFrontmatter(`---
name: "demo" # comment
description: >-
  First line
  second line
allowed-tools:
  - Read
  - Write
---
# Body`)).toMatchObject({ name: 'demo', description: 'First line second line', 'allowed-tools': ['Read', 'Write'] });
  });
  it.each(['name:\ndescription: example', 'name: 123\ndescription: example', 'name: demo\ndescription:', 'name: [broken'])('rejects invalid metadata: %s', (metadata) => {
    expect(parseSkillFrontmatter(`---\n${metadata}\n---\n`)).toBeNull();
  });
});
