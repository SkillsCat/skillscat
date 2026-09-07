import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace } from './helpers/env';
import { assertSkillFilesSafe, syncCompanionFiles } from '../src/commands/add';

const skill = { name: 'demo', description: 'demo', path: 'SKILL.md', content: '# demo' };

describe('installation filesystem safety', () => {
  beforeEach(() => createWorkspace('safety'));
  it('rejects symlinked companion directories before writing outside the skill', () => {
    const root = join(process.cwd(), 'skill');
    const outside = join(process.cwd(), 'outside');
    mkdirSync(root); mkdirSync(outside);
    writeFileSync(join(outside, 'file.txt'), 'original');
    symlinkSync(outside, join(root, 'templates'), 'dir');
    expect(() => syncCompanionFiles(root, { ...skill, companionFiles: [{ path: 'templates/file.txt', content: Buffer.from('changed') }] })).toThrow('symbolic link');
    expect(readFileSync(join(outside, 'file.txt'), 'utf-8')).toBe('original');
  });
  it('rejects symlinked SKILL.md before installation writes', () => {
    const root = join(process.cwd(), 'skill');
    mkdirSync(root);
    symlinkSync(join(process.cwd(), 'outside.md'), join(root, 'SKILL.md'));
    expect(() => assertSkillFilesSafe(root, skill)).toThrow('symbolic link');
    expect(existsSync(join(process.cwd(), 'outside.md'))).toBe(false);
  });
  it('does not let a stale manifest delete SKILL.md or traverse directories', () => {
    const root = join(process.cwd(), 'skill');
    mkdirSync(root);
    writeFileSync(join(root, 'SKILL.md'), 'original');
    writeFileSync(join(process.cwd(), 'outside'), 'outside');
    writeFileSync(join(root, '.skillscat-companion-files.json'), JSON.stringify({ version: 1, files: ['SKILL.md', '../outside'] }));
    syncCompanionFiles(root, { ...skill, companionFiles: [] });
    expect(readFileSync(join(root, 'SKILL.md'), 'utf-8')).toBe('original');
    expect(readFileSync(join(process.cwd(), 'outside'), 'utf-8')).toBe('outside');
  });
  it('prunes empty directories after deleting stale companions', () => {
    const root = join(process.cwd(), 'skill');
    syncCompanionFiles(root, { ...skill, companionFiles: [{ path: 'templates/nested/file.txt', content: Buffer.from('old') }] });
    syncCompanionFiles(root, { ...skill, companionFiles: [] });
    expect(existsSync(join(root, 'templates'))).toBe(false);
  });
});
