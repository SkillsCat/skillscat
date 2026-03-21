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
});
