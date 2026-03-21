import { describe, expect, it } from 'vitest';

import { cleanSkillCardDescription } from '../src/lib/text/skill-card-description';

describe('cleanSkillCardDescription', () => {
  it('removes markdown presentation markers while preserving readable text', () => {
    const result = cleanSkillCardDescription('# **Fast** _typed_ `CLI` helper');

    expect(result).toBe('Fast typed CLI helper');
  });

  it('strips html tags but keeps their text content', () => {
    const result = cleanSkillCardDescription('<h2>Title</h2><p>Use <strong>rich</strong> <em>markup</em> <code>tags</code>.</p>');

    expect(result).toBe('Title Use rich markup tags.');
  });

  it('flattens markdown tables and lists into plain text', () => {
    const result = cleanSkillCardDescription(`
| feature | value |
| --- | --- |
| lint | included |

- first item
- second item
    `);

    expect(result).toBe('feature value lint included first item second item');
  });

  it('drops fenced code blocks from card descriptions', () => {
    const result = cleanSkillCardDescription(`
Intro paragraph.

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

Final note.
    `);

    expect(result).toBe('Intro paragraph. Final note.');
  });

  it('decodes encoded html tags before stripping them', () => {
    const result = cleanSkillCardDescription('&lt;strong&gt;Portable&lt;/strong&gt; automation');

    expect(result).toBe('Portable automation');
  });

  it('does not throw on invalid numeric html entities', () => {
    expect(() => cleanSkillCardDescription('&#99999999;')).not.toThrow();
    expect(cleanSkillCardDescription('&#99999999;')).toBe('&#99999999;');
  });

  it('strips markdown links with nested parentheses in the target url', () => {
    const result = cleanSkillCardDescription('Use [name](https://x.com_(abc)) helper');

    expect(result).toBe('Use name helper');
  });

  it('preserves non-presentation angle-bracket placeholders', () => {
    expect(cleanSkillCardDescription('Install into <path> and sync <repo>.')).toBe(
      'Install into <path> and sync <repo>.'
    );
    expect(cleanSkillCardDescription('Use &lt;owner&gt;/&lt;repo&gt; in the command.')).toBe(
      'Use <owner>/<repo> in the command.'
    );
  });

  it('does not sanitize non-presentation html-like tags', () => {
    expect(cleanSkillCardDescription('&lt;script&gt;alert(1)&lt;/script&gt; safe')).toBe(
      '<script>alert(1)</script> safe'
    );
  });
});
