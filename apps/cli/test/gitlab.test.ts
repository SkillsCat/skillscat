import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverSkills, fetchSkillCompanionFiles } from '../src/utils/source/git';
import { configureRegistry, createWorkspace, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';
import { add } from '../src/commands/add';
import { update } from '../src/commands/update';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = { platform: 'gitlab' as const, owner: 'group/sub', repo: 'repo', branch: 'feature/test&demo', path: 'skills/demo' };
const content = '---\nname: demo\ndescription: example\n---\n# Demo';

describe('GitLab file downloads', () => {
  beforeEach(async () => {
    createWorkspace('gitlab'); resetTestConfigDir();
    await configureRegistry('http://localhost:3000/registry');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('installs and updates binary and empty companion files from an explicit ref', async () => {
    let version = 1;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (!url.hostname.includes('gitlab')) return Response.json({}, { status: 404 });
      expect(url.searchParams.get('ref')).toBe(source.branch);
      if (url.pathname.endsWith('/repository/tree')) return Response.json([
        { path: 'skills/demo/SKILL.md', type: 'blob' },
        { path: 'skills/demo/image.bin', type: 'blob' },
        { path: 'skills/demo/empty.txt', type: 'blob' },
      ]);
      const path = decodeURIComponent(url.pathname.split('/files/')[1] ?? '');
      const bytes = path.endsWith('SKILL.md') ? Buffer.from(`${content}\nVersion ${version}`)
        : path.endsWith('empty.txt') ? Buffer.alloc(0) : Buffer.from([0, 255, version]);
      return Response.json({ encoding: 'base64', content: bytes.toString('base64') });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runCommand(() => add('https://gitlab.com/group/sub/repo/-/tree/feature%2Ftest%26demo/skills/demo', { yes: true, agent: ['agents'] }));
    expect(result.exitCode).toBeNull();
    const root = join(process.cwd(), '.agents', 'demo');
    expect(readFileSync(join(root, 'image.bin'))).toEqual(Buffer.from([0, 255, 1]));
    expect(readFileSync(join(root, 'empty.txt'))).toHaveLength(0);
    version = 2;
    expect((await runCommand(() => update('demo', {}))).exitCode).toBeNull();
    expect(readFileSync(join(root, 'SKILL.md'), 'utf-8')).toContain('Version 2');
    expect(readFileSync(join(root, 'image.bin'))).toEqual(Buffer.from([0, 255, 2]));
  });
  it('does not silently fetch master when an explicit ref fails', async () => {
    const fetchMock = vi.fn(async () => Response.json({}, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(discoverSkills(source)).rejects.toThrow('GitLab (500)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects a failed tree request instead of treating companion files as empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
    await expect(fetchSkillCompanionFiles(source, 'skills/demo/SKILL.md')).rejects.toThrow('tree (503)');
  });
});
