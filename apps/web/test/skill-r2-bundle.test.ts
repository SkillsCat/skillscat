import { describe, expect, it } from 'vitest';

import {
  buildBundleExpectationFromRawFileStructure,
  chooseBestR2Bundle,
} from '../src/lib/server/skill/r2-bundle';

describe('chooseBestR2Bundle', () => {
  it('prefers the richer legacy bundle when only a fallback SKILL.md expectation exists', () => {
    const result = chooseBestR2Bundle([
      {
        index: 0,
        files: [
          { path: 'SKILL.md', content: '# Canonical only' },
        ],
      },
      {
        index: 1,
        files: [
          { path: 'SKILL.md', content: '# Legacy full' },
          { path: 'templates/prompt.txt', content: 'prompt' },
        ],
      },
    ], { paths: ['SKILL.md'], structured: false });

    expect(result.complete).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'templates/prompt.txt']);
  });

  it('prefers the complete cached bundle when structured file paths are available', () => {
    const result = chooseBestR2Bundle([
      {
        index: 0,
        files: [
          { path: 'SKILL.md', content: '# Partial' },
        ],
      },
      {
        index: 1,
        files: [
          { path: 'SKILL.md', content: '# Full' },
          { path: 'templates/prompt.txt', content: 'prompt' },
        ],
      },
    ], buildBundleExpectationFromRawFileStructure(JSON.stringify({
      files: [
        { path: 'SKILL.md' },
        { path: 'templates/prompt.txt' },
      ],
    })));

    expect(result.complete).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'templates/prompt.txt']);
  });

  it('does not mark a bundle as complete when a structured text file is missing everywhere', () => {
    const result = chooseBestR2Bundle([
      {
        index: 0,
        files: [
          { path: 'SKILL.md', content: '# Partial' },
        ],
      },
      {
        index: 1,
        files: [
          { path: 'SKILL.md', content: '# Also partial' },
        ],
      },
    ], buildBundleExpectationFromRawFileStructure(JSON.stringify({
      files: [
        { path: 'SKILL.md', type: 'text' },
        { path: 'templates/prompt.txt', type: 'text' },
      ],
    })));

    expect(result.complete).toBe(false);
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md']);
  });

  it('prefers the bundle with fewer unexpected files when structured paths match', () => {
    const result = chooseBestR2Bundle([
      {
        index: 0,
        files: [
          { path: 'SKILL.md', content: '# Current' },
          { path: 'templates/prompt.txt', content: 'prompt' },
        ],
      },
      {
        index: 1,
        files: [
          { path: 'SKILL.md', content: '# Older' },
          { path: 'templates/prompt.txt', content: 'prompt' },
          { path: 'old.txt', content: 'stale' },
        ],
      },
    ], buildBundleExpectationFromRawFileStructure(JSON.stringify({
      files: [
        { path: 'SKILL.md' },
        { path: 'templates/prompt.txt' },
      ],
    })));

    expect(result.complete).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'templates/prompt.txt']);
  });
});
