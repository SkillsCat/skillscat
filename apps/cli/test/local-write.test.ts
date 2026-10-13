import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createWorkspace } from './helpers/env';
import { writeLocalSkillBundle } from '../src/utils/storage/skill-files';

const failure = vi.hoisted(() => ({ kind: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    renameSync: (from: Parameters<typeof fs.renameSync>[0], to: Parameters<typeof fs.renameSync>[1]) => {
      const name = basename(String(from));
      if (failure.kind && (name === 'next' || (failure.kind === 'both' && name === 'previous'))) {
        throw new Error('Injected rename failure');
      }
      return fs.renameSync(from, to);
    },
  };
});

describe('local bundle replacement', () => {
  beforeEach(() => { createWorkspace('local-write'); failure.kind = ''; });
  const skill = { name: 'demo', description: 'demo', path: 'SKILL.md', content: 'new', companionFiles: [] };
  function target(): string {
    const directory = join(process.cwd(), '.codex/skills/demo');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), 'old');
    writeFileSync(join(directory, 'notes.txt'), 'unmanaged notes');
    return directory;
  }

  it('restores the original bundle when the prepared directory cannot be moved into place', () => {
    const directory = target();
    failure.kind = 'commit';
    expect(() => writeLocalSkillBundle(directory, skill)).toThrow('Injected rename failure');
    expect(readFileSync(join(directory, 'SKILL.md'), 'utf-8')).toBe('old');
    expect(readFileSync(join(directory, 'notes.txt'), 'utf-8')).toBe('unmanaged notes');
    expect(readdirSync(join(process.cwd(), '.codex/skills'))).toEqual(['demo']);
  });

  it('preserves the original backup and reports its location when restoration is blocked', () => {
    const directory = target();
    failure.kind = 'both';
    expect(() => writeLocalSkillBundle(directory, skill)).toThrow('original files preserved at');
    const transaction = readdirSync(join(process.cwd(), '.codex/skills')).find((name) => name.startsWith('.skillscat-txn-'))!;
    expect(readFileSync(join(process.cwd(), '.codex/skills', transaction, 'previous/SKILL.md'), 'utf-8')).toBe('old');
    expect(existsSync(directory)).toBe(false);
  });

  it('keeps the original manifest and bundle when a stale managed entry cannot be removed', () => {
    const directory = target();
    mkdirSync(join(directory, 'obsolete.txt'));
    const manifest = JSON.stringify({ version: 1, files: ['obsolete.txt'] });
    writeFileSync(join(directory, '.skillscat-companion-files.json'), manifest);
    expect(() => writeLocalSkillBundle(directory, skill)).toThrow();
    expect(readFileSync(join(directory, 'SKILL.md'), 'utf-8')).toBe('old');
    expect(readFileSync(join(directory, '.skillscat-companion-files.json'), 'utf-8')).toBe(manifest);
  });

  it('preserves unmanaged files after a successful replacement', () => {
    const directory = target();
    writeLocalSkillBundle(directory, skill);
    expect(readFileSync(join(directory, 'SKILL.md'), 'utf-8')).toBe('new');
    expect(readFileSync(join(directory, 'notes.txt'), 'utf-8')).toBe('unmanaged notes');
  });

  it.skipIf(process.platform === 'win32')('replaces readonly managed files without changing unmanaged file permissions', () => {
    const directory = target();
    writeFileSync(join(directory, 'run.sh'), 'old script');
    chmodSync(join(directory, 'SKILL.md'), 0o444);
    chmodSync(join(directory, 'run.sh'), 0o555);
    chmodSync(join(directory, 'notes.txt'), 0o444);
    writeLocalSkillBundle(directory, { ...skill, companionFiles: [{ path: 'run.sh', content: Buffer.from('new script'), mode: 0o555 }] });
    expect(readFileSync(join(directory, 'SKILL.md'), 'utf-8')).toBe('new');
    expect(readFileSync(join(directory, 'run.sh'), 'utf-8')).toBe('new script');
    expect(lstatSync(join(directory, 'run.sh')).mode & 0o777).toBe(0o555);
    expect(lstatSync(join(directory, 'notes.txt')).mode & 0o777).toBe(0o444);
  });
});
