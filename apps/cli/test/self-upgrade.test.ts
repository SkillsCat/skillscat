import { describe, expect, it, vi } from 'vitest';
import { runCommand } from './helpers/output';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    throw new Error('not found');
  }),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

describe('self-upgrade', () => {
  it('warns when global install is missing', async () => {
    const { selfUpgrade } = await import('../src/commands/self-upgrade');
    const result = await runCommand(() => selfUpgrade({}));

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('Global installation not detected');
  });
});
