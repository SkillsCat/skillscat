import { describe, expect, it } from 'vitest';

import {
  isValidGitHubRepoUrlForSubmit,
  normalizeGitHubRepoShorthandForSubmit,
  normalizeGitHubSubmitInput,
  parseGitHubRepoShorthand,
  parseGitHubRepoUrl,
} from '../src/lib/github-url';

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

describe('parseGitHubRepoShorthand', () => {
  it('accepts owner/repo shorthand', () => {
    expect(parseGitHubRepoShorthand(' demo-owner/repo.name_1 ')).toEqual({
      owner: 'demo-owner',
      repo: 'repo.name_1',
    });
  });

  it('normalizes owner/repo shorthand to a GitHub URL', () => {
    expect(normalizeGitHubRepoShorthandForSubmit('demo/repo')).toBe('https://github.com/demo/repo');
    expect(normalizeGitHubRepoShorthandForSubmit('demo/repo.git')).toBe('https://github.com/demo/repo');
  });

  it('rejects non-root shorthand and invalid owners', () => {
    expect(parseGitHubRepoShorthand('demo/repo/path')).toBeNull();
    expect(parseGitHubRepoShorthand('demo_owner/repo')).toBeNull();
    expect(parseGitHubRepoShorthand('-demo/repo')).toBeNull();
    expect(parseGitHubRepoShorthand('https://github.com/demo/repo')).toBeNull();
  });

  it('normalizes submit input while preserving full GitHub URLs', () => {
    expect(normalizeGitHubSubmitInput('demo/repo')).toBe('https://github.com/demo/repo');
    expect(normalizeGitHubSubmitInput('https://github.com/demo/repo/tree/main/.claude')).toBe(
      'https://github.com/demo/repo/tree/main/.claude'
    );
    expect(normalizeGitHubSubmitInput('not a repo')).toBeNull();
  });
});
