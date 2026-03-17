import { describe, expect, it } from 'vitest';
import { parseRegistryRepoInput } from '../src/lib/server/registry/repo';

describe('parseRegistryRepoInput', () => {
  it('normalizes repo tool input and preserves explicit empty path', () => {
    expect(
      parseRegistryRepoInput({
        owner: ' backrunner ',
        repo: ' skillscat ',
        path: 'skills/react/SKILL.md',
      })
    ).toEqual({
      owner: 'backrunner',
      repo: 'skillscat',
      pathFilter: 'skills/react',
    });

    expect(
      parseRegistryRepoInput({
        owner: 'backrunner',
        repo: 'skillscat',
        path: '',
      })
    ).toEqual({
      owner: 'backrunner',
      repo: 'skillscat',
      pathFilter: '',
    });
  });

  it('rejects invalid owner repo or path', () => {
    expect(parseRegistryRepoInput({ owner: '', repo: 'skillscat' })).toBeNull();
    expect(parseRegistryRepoInput({ owner: 'backrunner', repo: 'bad/repo' })).toBeNull();
    expect(parseRegistryRepoInput({ owner: 'backrunner', repo: 'skillscat', path: 'a'.repeat(600) })).toBeNull();
  });
});
