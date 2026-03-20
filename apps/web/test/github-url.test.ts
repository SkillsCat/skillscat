import { describe, expect, it } from 'vitest';

import { isValidGitHubRepoUrlForSubmit, parseGitHubRepoUrl } from '../src/lib/github-url';

describe('parseGitHubRepoUrl', () => {
  it('accepts tree URLs that point to dot folders', () => {
    expect(parseGitHubRepoUrl('https://github.com/demo/repo/tree/main/.claude')).toEqual({
      owner: 'demo',
      repo: 'repo',
      path: '',
      refType: 'tree',
      refPath: 'main/.claude',
    });
  });

  it('accepts blob URLs with query strings and hashes', () => {
    expect(parseGitHubRepoUrl('https://www.github.com/demo/repo/blob/main/skills/agent/SKILL.md?plain=1#L1')).toEqual({
      owner: 'demo',
      repo: 'repo',
      path: '',
      refType: 'blob',
      refPath: 'main/skills/agent/SKILL.md',
    });
  });

  it('accepts direct nested repo paths', () => {
    expect(parseGitHubRepoUrl('https://github.com/demo/repo/.cursor/rules/agent/')).toEqual({
      owner: 'demo',
      repo: 'repo',
      path: '.cursor/rules/agent',
    });
  });

  it('rejects non-github urls', () => {
    expect(parseGitHubRepoUrl('https://gitlab.com/demo/repo')).toBeNull();
    expect(isValidGitHubRepoUrlForSubmit('https://gitlab.com/demo/repo')).toBe(false);
  });

  it('does not throw on malformed percent-encoding', () => {
    expect(() => parseGitHubRepoUrl('https://github.com/demo/repo/%')).not.toThrow();
    expect(parseGitHubRepoUrl('https://github.com/demo/repo/%')).toEqual({
      owner: 'demo',
      repo: 'repo',
      path: '%',
    });
    expect(isValidGitHubRepoUrlForSubmit('https://github.com/demo/repo/%')).toBe(true);
  });
});
