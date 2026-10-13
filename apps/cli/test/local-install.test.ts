import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import inquirer from 'inquirer';
import { add } from '../src/commands/add';
import { update } from '../src/commands/update';
import { publish } from '../src/commands/publish';
import { discoverLocalSkills, isLocalSource, loadLocalSkill } from '../src/utils/source/local';
import { getInstalledSkills } from '../src/utils/storage/db';
import * as ui from '../src/utils/core/ui';
import { configureAuth, createWorkspace, resetTestConfigDir } from './helpers/env';
import { mockInteractiveTerminal, runCommand } from './helpers/output';

const supportsCaseAliases = existsSync(join(process.cwd(), '..', basename(process.cwd()).toUpperCase()));

function makeSkill(path: string, name = 'demo', body = 'Version one'): string {
  const directory = join(process.cwd(), path);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: A local skill\n---\n${body}\n`);
  return directory;
}

describe('local installation', () => {
  beforeEach(() => {
    createWorkspace('local-install');
    resetTestConfigDir();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Local install must not contact the registry'); }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = 0;
  });

  it('discovers root, nested and hidden skills while excluding dependencies and links', () => {
    makeSkill('.', 'root');
    makeSkill('nested/skill', 'nested');
    makeSkill('.claude/skills/hidden', 'hidden');
    makeSkill('node_modules/dependency', 'dependency');
    makeSkill('.git/internal', 'git');
    symlinkSync(join(process.cwd(), 'nested'), join(process.cwd(), 'linked'), 'dir');
    const result = discoverLocalSkills('.');
    expect(result.skills.map((skill) => skill.name).sort()).toEqual(['hidden', 'nested', 'root']);
  });

  it('reports invalid definitions and continues finding valid skills', () => {
    makeSkill('good');
    makeSkill('bad');
    writeFileSync(join(process.cwd(), 'bad/SKILL.md'), '# Missing frontmatter');
    const result = discoverLocalSkills('.');
    expect(result.skills).toHaveLength(1);
    expect(result.warnings).toEqual(['Skipped invalid or oversized SKILL.md: bad']);
  });

  it('loads binary companions and excludes nested skills, manifests and symlinks', () => {
    const source = makeSkill('source');
    makeSkill('source/nested', 'nested');
    mkdirSync(join(source, 'scripts'));
    writeFileSync(join(source, 'scripts/run.sh'), 'echo hello');
    writeFileSync(join(source, 'image.bin'), Buffer.from([0, 255, 15]));
    writeFileSync(join(source, '.skillscat-companion-files.json'), '{}');
    symlinkSync(join(source, 'SKILL.md'), join(source, 'linked.md'));
    const bundle = loadLocalSkill(source);
    expect(bundle.companionFiles?.map((file) => file.path)).toEqual(['image.bin', 'scripts/run.sh']);
    expect(bundle.companionFiles?.[0].content).toEqual(Buffer.from([0, 255, 15]));
  });

  it('shows a table in list mode without prompting, writing or making requests', async () => {
    makeSkill('nested/skill');
    const promptSpy = vi.spyOn(inquirer, 'prompt');
    const result = await runCommand(() => add('.', { list: true }));
    expect(result.stdout).toContain('Description');
    expect(result.stdout).toContain('nested/skill');
    expect(promptSpy).not.toHaveBeenCalled();
    expect(getInstalledSkills()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('installs full bundles to selected agents and tracks local sources', async () => {
    const source = makeSkill('source');
    mkdirSync(join(source, 'references'));
    writeFileSync(join(source, 'references/guide.md'), 'A reference');
    writeFileSync(join(source, 'run.sh'), '#!/bin/sh\necho local');
    chmodSync(join(source, 'run.sh'), 0o755);
    await runCommand(() => add('.', { yes: true, agent: ['claude', 'codex'] }));
    for (const agent of ['.claude', '.codex']) {
      expect(readFileSync(join(process.cwd(), agent, 'skills/demo/references/guide.md'), 'utf-8')).toBe('A reference');
      if (process.platform !== 'win32') expect(lstatSync(join(process.cwd(), agent, 'skills/demo/run.sh')).mode & 0o777).toBe(0o755);
    }
    expect(getInstalledSkills()).toMatchObject([{ name: 'demo', updateStrategy: 'local', localPath: source,
      agents: ['claude-code', 'codex'], installRoot: process.cwd() }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets users select multiple skills and agents interactively', async () => {
    const first = makeSkill('first', 'first');
    const second = makeSkill('second', 'second');
    makeSkill('third', 'third');
    mockInteractiveTerminal();
    const selection = vi.spyOn(inquirer, 'prompt').mockResolvedValueOnce({ skills: [first, second] })
      .mockResolvedValueOnce({ agents: ['codex', 'cursor'] });
    vi.spyOn(ui, 'prompt').mockResolvedValue('y');
    await runCommand(() => add('.', {}));
    expect(selection).toHaveBeenCalledTimes(2);
    expect(getInstalledSkills().map((skill) => skill.name)).toEqual(['first', 'second']);
    expect(existsSync(join(process.cwd(), '.cursor/skills/first/SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.codex/skills/second/SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.codex/skills/third'))).toBe(false);
  });

  it('cancels empty skill selection before writes', async () => {
    makeSkill('source');
    mockInteractiveTerminal();
    vi.spyOn(inquirer, 'prompt').mockResolvedValue({ skills: [] });
    const result = await runCommand(() => add('.', {}));
    expect(result.stdout).toContain('cancelled');
    expect(getInstalledSkills()).toEqual([]);
  });

  it('cancels empty agent selection before writes', async () => {
    makeSkill('source');
    mockInteractiveTerminal();
    vi.spyOn(inquirer, 'prompt').mockResolvedValue({ agents: [] });
    await runCommand(() => add('.', { skill: ['demo'] }));
    expect(getInstalledSkills()).toEqual([]);
  });

  it('retains tracking for completed agents when a later overwrite prompt is cancelled', async () => {
    const source = makeSkill('source');
    const existing = makeSkill('.cursor/skills/demo', 'demo', 'Keep cursor version');
    vi.spyOn(ui, 'prompt').mockResolvedValueOnce('y').mockRejectedValueOnce(new ui.PromptCancelledError());
    await expect(add(source, { skill: ['demo'], agent: ['codex', 'cursor'] })).rejects.toBeInstanceOf(ui.PromptCancelledError);
    expect(readFileSync(join(process.cwd(), '.codex/skills/demo/SKILL.md'), 'utf-8')).toContain('Version one');
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf-8')).toContain('Keep cursor version');
    expect(getInstalledSkills()).toMatchObject([{ localPath: source, agents: ['codex'] }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing skill names and invalid agents before writes', async () => {
    makeSkill('source');
    await expect(add('.', { yes: true, skill: ['absent'], agent: ['codex'] })).rejects.toThrow('No local skills found matching');
    await expect(add('.', { yes: true, agent: ['absent'] })).rejects.toThrow('Invalid agent(s)');
    expect(getInstalledSkills()).toEqual([]);
  });

  it('rejects colliding names before any writes and supports selection by path', async () => {
    makeSkill('one', 'same');
    makeSkill('two', 'same');
    await expect(add('.', { yes: true, agent: ['codex'] })).rejects.toThrow('same installation directory');
    expect(existsSync(join(process.cwd(), '.codex'))).toBe(false);
    await runCommand(() => add('.', { yes: true, skill: ['two'], agent: ['codex'] }));
    expect(getInstalledSkills()[0]?.localPath).toBe(join(process.cwd(), 'two'));
  });

  it('skips different existing content with --yes and replaces it only with --force', async () => {
    makeSkill('source');
    makeSkill('.codex/skills/demo', 'demo', 'Existing');
    const options = { yes: true, skill: ['source'], agent: ['codex'] };
    const result = await runCommand(() => add('.', options));
    expect(result.stderr).toContain('--force');
    expect(readFileSync(join(process.cwd(), '.codex/skills/demo/SKILL.md'), 'utf-8')).toContain('Existing');
    expect(getInstalledSkills()).toEqual([]);
    await runCommand(() => add('.', { ...options, force: true }));
    expect(readFileSync(join(process.cwd(), '.codex/skills/demo/SKILL.md'), 'utf-8')).toContain('Version one');
  });

  it('skips identical bundles on repeat installations', async () => {
    const source = makeSkill('source');
    const options = { yes: true, agent: ['codex'] };
    await runCommand(() => add(source, options));
    const result = await runCommand(() => add(source, options));
    expect(result.stdout).toContain('Skipped 1');
    expect(getInstalledSkills()).toHaveLength(1);
  });

  it('rejects symlinked target parents without changing outside files', async () => {
    const source = makeSkill('source');
    const outside = join(process.cwd(), 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(process.cwd(), '.codex'), 'dir');
    await expect(add(source, { yes: true, agent: ['codex'] })).rejects.toThrow('symbolic link');
    expect(existsSync(join(outside, 'skills'))).toBe(false);
  });

  it('never writes a manifest into a skill already at its target directory', async () => {
    const source = makeSkill('.codex/skills/demo');
    await runCommand(() => add(source, { yes: true, force: true, agent: ['codex'] }));
    expect(existsSync(join(source, '.skillscat-companion-files.json'))).toBe(false);
    expect(getInstalledSkills()).toHaveLength(0);
  });

  it('supports global-agent aliases and deduplicates targets', async () => {
    const source = makeSkill('source');
    await runCommand(() => add(source, { yes: true, globalAgent: ['claude', 'claude-code'] }));
    expect(getInstalledSkills()).toMatchObject([{ global: true, agents: ['claude-code'] }]);
  });

  it('updates local definitions and changed, added and removed companions without registry calls', async () => {
    const source = makeSkill('source');
    writeFileSync(join(source, 'old.txt'), 'old');
    writeFileSync(join(source, 'changed.txt'), 'v1');
    await runCommand(() => add(source, { yes: true, agent: ['codex'] }));
    makeSkill('source', 'demo', 'Version two');
    rmSync(join(source, 'old.txt'));
    writeFileSync(join(source, 'changed.txt'), 'v2');
    writeFileSync(join(source, 'new.txt'), 'new');
    const result = await runCommand(() => update('demo', {}));
    expect(result.exitCode).toBeNull();
    const target = join(process.cwd(), '.codex/skills/demo');
    expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toContain('Version two');
    expect(readFileSync(join(target, 'changed.txt'), 'utf-8')).toBe('v2');
    expect(readFileSync(join(target, 'new.txt'), 'utf-8')).toBe('new');
    expect(existsSync(join(target, 'old.txt'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    const repeated = await runCommand(() => update('demo', {}));
    expect(repeated.stdout).toContain('All skills are up to date');
  });

  it('reports a missing local update source without changing the installation', async () => {
    const source = makeSkill('source');
    await runCommand(() => add(source, { yes: true, agent: ['codex'] }));
    rmSync(source, { recursive: true });
    const result = await runCommand(() => update('demo', {}));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Local skill directory unavailable');
    expect(readFileSync(join(process.cwd(), '.codex/skills/demo/SKILL.md'), 'utf-8')).toContain('Version one');
  });

  it('prints publishing guidance for logged-in unattended installs without uploading or refreshing auth', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    const result = await runCommand(() => add(source, { yes: true, agent: ['codex'] }));
    expect(result.stdout).toContain(`npx skillscat publish '${source}'`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows logged-in users to decline publication after successful installation', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    const prompts = vi.spyOn(ui, 'prompt').mockResolvedValueOnce('y').mockResolvedValueOnce('n');
    await runCommand(() => add(source, { skill: ['demo'], agent: ['codex'] }));
    expect(prompts).toHaveBeenLastCalledWith(expect.stringContaining('Submit installed skills'));
    expect(getInstalledSkills()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('publishes selected installed skills through preview and explicit final confirmation', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    writeFileSync(join(source, 'guide.txt'), 'guide');
    vi.spyOn(ui, 'prompt').mockResolvedValueOnce('y').mockResolvedValueOnce('y').mockResolvedValueOnce('y');
    mockInteractiveTerminal();
    vi.spyOn(inquirer, 'prompt').mockResolvedValue({ skills: [source] });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/skills/upload/preview')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ files: [{ path: 'guide.txt', content: 'guide' }] });
        return Response.json({ success: true, preview: { name: 'demo', slug: 'tester/demo', description: 'A local skill', categories: [], owner: 'tester' }, suggestedVisibility: 'private' });
      }
      if (url.endsWith('/api/skills/upload')) {
        expect((init?.body as FormData).get('visibility')).toBe('private');
        return Response.json({ success: true, slug: 'tester/demo', categories: [] });
      }
      throw new Error(`Unexpected request ${url}`);
    }));
    const result = await runCommand(() => add(source, { skill: ['demo'], agent: ['codex'] }));
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Skill published successfully');
    expect(result.stdout).toContain('npx skillscat add tester/demo');
    expect(requests.map((url) => new URL(url).pathname)).toEqual(['/api/skills/upload/preview', '/api/skills/upload']);
  });

  it('rejects a missing or symlinked directory and an empty directory without falling back to network', async () => {
    await expect(add('./missing', { yes: true })).rejects.toThrow('Local source must be a directory');
    const source = makeSkill('source');
    symlinkSync(source, join(process.cwd(), 'link'), 'dir');
    await expect(add('./link', { yes: true })).rejects.toThrow('Local source must be a directory');
    mkdirSync(join(process.cwd(), 'empty'));
    await expect(add('./empty', { yes: true })).rejects.toThrow('No installable skills');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('repeats install . without discovering tracked target copies as new sources', async () => {
    const source = makeSkill('source');
    writeFileSync(join(source, 'guide.txt'), 'guide');
    const options = { yes: true, agent: ['codex', 'cursor'] };
    await runCommand(() => add('.', options));
    const repeated = await runCommand(() => add('.', options));
    expect(repeated.stdout).toContain('Found 1 local skill');
    expect(repeated.stdout).toContain('Skipped 2');
    expect(getInstalledSkills()).toMatchObject([{ localPath: source }]);
  });

  it('keeps registry slugs remote even when a same-named directory exists', () => {
    makeSkill('owner/skill');
    expect(isLocalSource('owner/skill')).toBe(false);
    expect(isLocalSource('./owner/skill')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('rejects attachment paths which would otherwise be silently normalized or dropped', () => {
    const source = makeSkill('source');
    writeFileSync(join(source, '..\\outside.txt'), 'This companion would be silently dropped');
    expect(() => loadLocalSkill(source)).toThrow('Unsupported companion file path');
  });

  it('does not leave half-updated content after an attachment write fails', async () => {
    const source = makeSkill('source');
    writeFileSync(join(source, 'guide.txt'), 'new guide');
    const target = makeSkill('.codex/skills/demo', 'demo', 'Existing version');
    mkdirSync(join(target, 'guide.txt'));
    const previous = readFileSync(join(target, 'SKILL.md'), 'utf-8');
    await runCommand(() => add(source, { yes: true, force: true, agent: ['codex'] }));
    expect(process.exitCode).toBe(1);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toBe(previous);
    expect(lstatSync(join(target, 'guide.txt')).isDirectory()).toBe(true);
    expect(getInstalledSkills()).toEqual([]);
  });

  it('does not overwrite a hard-linked external file when replacing a target', async () => {
    const source = makeSkill('source');
    const target = join(process.cwd(), '.codex/skills/demo');
    mkdirSync(target, { recursive: true });
    const original = join(process.cwd(), 'original.md');
    writeFileSync(original, 'Original external content');
    linkSync(original, join(target, 'SKILL.md'));
    await runCommand(() => add(source, { yes: true, force: true, agent: ['codex'] }));
    expect(readFileSync(original, 'utf-8')).toBe('Original external content');
    expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toContain('Version one');
  });

  it('rejects overlapping agent destinations before any writes', async () => {
    const source = makeSkill('source', 'skills');
    await expect(add(source, { yes: true, agent: ['agents', 'amp'] })).rejects.toThrow('overlap');
    expect(existsSync(join(process.cwd(), '.agents'))).toBe(false);
  });

  it('protects an unselected skill located inside an installation destination', async () => {
    makeSkill('source', 'demo');
    const original = makeSkill('.codex/skills/demo/nested', 'nested');
    await expect(add('.', { yes: true, force: true, skill: ['source'], agent: ['codex'] })).rejects.toThrow('source skill');
    expect(readFileSync(join(original, 'SKILL.md'), 'utf-8')).toContain('Version one');
  });

  it('preserves the previous definition and tracking hash after a local update write fails', async () => {
    const source = makeSkill('source');
    await runCommand(() => add(source, { yes: true, agent: ['codex'] }));
    const previousHash = getInstalledSkills()[0].contentHash;
    const target = join(process.cwd(), '.codex/skills/demo');
    mkdirSync(join(target, 'guide.txt'));
    makeSkill('source', 'demo', 'Updated definition');
    writeFileSync(join(source, 'guide.txt'), 'new guide');
    const result = await runCommand(() => update('demo', {}));
    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toContain('Version one');
    expect(getInstalledSkills()[0].contentHash).toBe(previousHash);
  });

  it('continues publishing other selected skills after a preview fails', async () => {
    await configureAuth('local-test-token');
    const first = makeSkill('first', 'first');
    const second = makeSkill('second', 'second');
    vi.spyOn(ui, 'prompt').mockResolvedValue('y');
    mockInteractiveTerminal();
    vi.spyOn(inquirer, 'prompt').mockResolvedValue({ skills: [first, second] });
    let previews = 0;
    const uploads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/skills/upload/preview')) {
        previews++;
        if (previews === 1) return Response.json({ success: false, error: 'Preview unavailable' }, { status: 503 });
        return Response.json({ success: true, preview: { name: 'second', slug: 'tester/second', description: 'local', categories: [], owner: 'tester' } });
      }
      uploads.push(String((init?.body as FormData).get('name')));
      return Response.json({ success: true, slug: 'tester/second' });
    }));
    const result = await runCommand(() => add('.', { skill: ['first', 'second'], agent: ['codex'] }));
    expect(result.exitCode).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(previews).toBe(2);
    expect(uploads).toEqual(['second']);
    expect(result.stderr).toContain('Preview unavailable');
    expect(getInstalledSkills()).toHaveLength(2);
  });

  it('can cancel one publishing preview and proceed to the next selection', async () => {
    await configureAuth('local-test-token');
    const first = makeSkill('first', 'first');
    const second = makeSkill('second', 'second');
    vi.spyOn(ui, 'prompt').mockResolvedValueOnce('y').mockResolvedValueOnce('y')
      .mockResolvedValueOnce('n').mockResolvedValueOnce('y');
    mockInteractiveTerminal();
    vi.spyOn(inquirer, 'prompt').mockResolvedValue({ skills: [first, second] });
    let previews = 0;
    const uploads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/skills/upload/preview')) {
        const name = previews++ === 0 ? 'first' : 'second';
        return Response.json({ success: true, preview: { name, slug: `tester/${name}`, description: 'local', categories: [], owner: 'tester' } });
      }
      uploads.push(String((init?.body as FormData).get('name')));
      return Response.json({ success: true, slug: 'tester/second' });
    }));
    await runCommand(() => add('.', { skill: ['first', 'second'], agent: ['codex'] }));
    expect(uploads).toEqual(['second']);
    expect(process.exitCode).toBe(0);
  });

  it('selects an exact relative path without also selecting another skill with that name', async () => {
    const source = makeSkill('chosen', 'first');
    makeSkill('other', 'chosen');
    await runCommand(() => add('.', { yes: true, skill: ['./chosen/'], agent: ['codex'] }));
    expect(getInstalledSkills()).toMatchObject([{ name: 'first', localPath: source }]);
    expect(existsSync(join(process.cwd(), '.codex/skills/chosen'))).toBe(false);
  });

  it('publishes the installed snapshot without adding excluded build files or later source changes', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    writeFileSync(join(source, 'guide.txt'), 'Installed guide');
    mkdirSync(join(source, 'dist'));
    writeFileSync(join(source, 'dist/internal.txt'), 'Excluded build material');
    vi.spyOn(ui, 'prompt').mockImplementation(async (question) => {
      if (question.startsWith('Submit installed')) writeFileSync(join(source, 'guide.txt'), 'Changed after installation');
      return 'y';
    });
    mockInteractiveTerminal();
    vi.spyOn(inquirer, 'prompt').mockResolvedValue({ skills: [source] });
    let previewFiles: unknown;
    let uploadedGuide = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/skills/upload/preview')) {
        previewFiles = JSON.parse(String(init?.body)).files;
        return Response.json({ success: true, preview: { name: 'demo', slug: 'tester/demo', description: 'local', categories: [], owner: 'tester' } });
      }
      uploadedGuide = await ((init?.body as FormData).getAll('files')[0] as File).text();
      return Response.json({ success: true, slug: 'tester/demo' });
    }));
    await runCommand(() => add(source, { skill: ['demo'], agent: ['codex'] }));
    expect(previewFiles).toEqual([{ path: 'guide.txt', content: 'Installed guide' }]);
    expect(uploadedGuide).toBe('Installed guide');
  });

  it('supports publishing a skill directory whose name ends with .md', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('bundle.md');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/skills/upload/preview')) {
        return Response.json({ success: true, preview: { name: 'demo', slug: 'tester/demo', description: 'local', categories: [], owner: 'tester' } });
      }
      return Response.json({ success: true, slug: 'tester/demo' });
    }));
    const result = await runCommand(() => publish(source, { yes: true }));
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Skill published successfully');
  });

  it('enforces upload limits for a direct SKILL.md path before making requests', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    writeFileSync(join(source, 'SKILL.md'), 'x'.repeat(512 * 1024 + 1));
    const result = await runCommand(() => publish(join(source, 'SKILL.md'), { yes: true }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('byte limit');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not publish when a failed HTTP response contains a preview-shaped payload', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ success: true, preview: { name: 'demo', slug: 'tester/demo', description: 'local', categories: [], owner: 'tester' } }, { status: 503 });
    }));
    const result = await runCommand(() => publish(source, { yes: true }));
    expect(result.exitCode).toBe(1);
    expect(requests).toHaveLength(1);
    expect(result.stderr).toContain('503');
  });

  it('canonicalizes an explicit parent directory alias before checking self-installation', async () => {
    const source = makeSkill('.codex/skills/demo');
    writeFileSync(join(source, 'guide.txt'), 'Original guide');
    symlinkSync(process.cwd(), join(process.cwd(), 'alias'), 'dir');
    const result = await runCommand(() => add('./alias/.codex/skills/demo', { yes: true, force: true, agent: ['codex'] }));
    expect(result.stdout).toContain('Skipped 1');
    expect(existsSync(join(source, '.skillscat-companion-files.json'))).toBe(false);
    expect(getInstalledSkills()).toEqual([]);
  });

  it.skipIf(!supportsCaseAliases)('does not rewrite a source when its metadata uses another casing of the target directory', async () => {
    const source = makeSkill('.codex/skills/demo', 'Demo');
    writeFileSync(join(source, 'guide.txt'), 'Original guide');
    const result = await runCommand(() => add(source, { yes: true, force: true, agent: ['codex'] }));
    expect(result.stdout).toContain('Skipped 1');
    expect(existsSync(join(source, '.skillscat-companion-files.json'))).toBe(false);
    expect(getInstalledSkills()).toEqual([]);
  });

  it('rejects publishing a file path that the upload API would trim and rename', async () => {
    await configureAuth('local-test-token');
    const source = makeSkill('source');
    writeFileSync(join(source, ' guide.txt '), 'References depend on the exact filename');
    const result = await runCommand(() => publish(source, { yes: true, bundle: loadLocalSkill(source) }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid or duplicate companion file path');
    expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(join(source, ' guide.txt '), 'utf-8')).toContain('exact filename');
  });
});
