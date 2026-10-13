import { describe, expect, it } from 'vitest';
import { table } from '../src/utils/core/ui';
import { runCommand } from './helpers/output';

describe('CLI table rendering', () => {
  it('aligns CJK text, combining characters and emoji using terminal columns', async () => {
    const result = await runCommand(() => table(['Skill', 'Description'], [
      ['中文', '中文说明'], ['👩🏽‍💻e\u0301', '短'],
    ]));
    expect(result.stdout.split('\n')).toContain('│ 中文  │ 中文说明    │');
    expect(result.stdout.split('\n')).toContain(`│ 👩🏽‍💻e\u0301   │ 短${' '.repeat(10)}│`);
    expect(result.stdout.split('\n')[0]).toBe('┌───────┬─────────────┐');
  });

  it('renders missing cells as empty columns instead of dropping table borders', async () => {
    const result = await runCommand(() => table(['A', 'B'], [['x']]));
    expect(result.stdout.split('\n')).toContain('│ x │   │');
  });
});
