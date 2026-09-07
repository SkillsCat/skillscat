import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ eof: false }));
vi.mock('node:readline', () => ({
  createInterface: () => {
    const rl = new EventEmitter();
    return Object.assign(rl, {
      question: (_question: string, answer: (value: string) => void) => {
        queueMicrotask(() => state.eof ? rl.emit('close') : answer('y'));
      },
      close: () => rl.emit('close'),
    });
  },
}));
import { prompt } from '../src/utils/core/ui';

describe('confirmation input', () => {
  afterEach(() => { state.eof = false; });
  it('returns an answer before closing the interface', async () => {
    await expect(prompt('Continue?')).resolves.toBe('y');
  });
  it('rejects EOF instead of leaving the operation pending', async () => {
    state.eof = true;
    await expect(prompt('Continue?')).rejects.toThrow('Input closed');
  });
});
