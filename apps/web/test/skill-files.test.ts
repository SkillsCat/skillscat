import { describe, expect, it } from 'vitest';
import { parseSkillFilesInput } from '../src/lib/server/skill/files';

describe('parseSkillFilesInput', () => {
  it('normalizes valid slugs', () => {
    expect(parseSkillFilesInput({ slug: ' backrunner/react-skill ' })).toEqual({
      slug: 'backrunner/react-skill',
    });
  });

  it('rejects invalid slugs', () => {
    expect(parseSkillFilesInput({ slug: '' })).toBeNull();
    expect(parseSkillFilesInput({ slug: '../secret' })).toBeNull();
  });
});
