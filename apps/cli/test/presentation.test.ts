import { afterEach, describe, expect, it, vi } from 'vitest';
import inquirer from 'inquirer';
import stringWidth from 'fast-string-width';
import * as ui from '../src/utils/core/ui';
import { confirm, confirmText, selectMany, selectOne } from '../src/utils/core/prompts';
import { mockInteractiveTerminal, runCommand, stripAnsi } from './helpers/output';

describe('shared CLI presentation', () => {
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  afterEach(() => {
    vi.restoreAllMocks();
    if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
  });

  it('keeps opt-in confirmations off by default and rejects unknown input', async () => {
    const prompt = vi.spyOn(ui, 'prompt').mockResolvedValueOnce('').mockResolvedValueOnce('maybe').mockResolvedValueOnce(' YES ');
    expect(await confirm('Publish skill?')).toBe(false);
    expect(await confirm('Publish skill?')).toBe(false);
    expect(await confirm('Publish skill?')).toBe(true);
    expect(prompt).toHaveBeenCalledWith('Publish skill? [y/N] ');
  });

  it('accepts an empty answer only when a confirmation explicitly defaults to yes', async () => {
    const prompt = vi.spyOn(ui, 'prompt').mockResolvedValueOnce('').mockResolvedValueOnce('no');
    expect(await confirm('Install selected skills?', true)).toBe(true);
    expect(await confirm('Install selected skills?', true)).toBe(false);
    expect(prompt).toHaveBeenCalledWith('Install selected skills? [Y/n] ');
  });

  it('requires the exact slug for a destructive confirmation', async () => {
    vi.spyOn(ui, 'prompt').mockResolvedValueOnce('y').mockResolvedValueOnce('owner/skill ').mockResolvedValueOnce('owner/skill');
    expect(await confirmText('Unpublish skill?', 'owner/skill')).toBe(false);
    expect(await confirmText('Unpublish skill?', 'owner/skill')).toBe(false);
    expect(await confirmText('Unpublish skill?', 'owner/skill')).toBe(true);
  });

  it('uses the same selection controls while retaining checked defaults and opaque values', async () => {
    mockInteractiveTerminal();
    const prompt = vi.spyOn(inquirer, 'prompt').mockResolvedValueOnce({ agents: ['codex'] }).mockResolvedValueOnce({ skillKey: '1' });
    expect(await selectMany({ name: 'agents', message: 'Choose agents', choices: [{ name: 'Codex', value: 'codex', checked: true }] })).toEqual(['codex']);
    expect(await selectOne({ name: 'skillKey', message: 'Choose a skill', choices: [{ name: 'Skill', value: '1' }] })).toBe('1');
    expect(prompt).toHaveBeenNthCalledWith(1, [expect.objectContaining({ type: 'checkbox', choices: [{ name: 'Codex', value: 'codex', checked: true }] })]);
    expect(prompt).toHaveBeenNthCalledWith(2, [expect.objectContaining({ type: 'select' })]);
  });

  it('fits metadata panels into narrow windows without splitting graphemes', async () => {
    const result = await runCommand(() => ui.box('中文👩🏽‍💻e\u0301中文👩🏽‍💻e\u0301', '标题', { width: 12 }));
    for (const line of result.stdout.split('\n')) expect(stringWidth(line)).toBe(12);
    expect(result.stdout.split('\n').filter((line) => line === '│ 中文👩🏽‍💻e\u0301  │')).toHaveLength(2);
  });

  it('normalizes selection cancellation while retaining other errors', async () => {
    mockInteractiveTerminal();
    const failure = new Error('Terminal unavailable');
    vi.spyOn(inquirer, 'prompt')
      .mockRejectedValueOnce(Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }))
      .mockRejectedValueOnce(failure);
    const options = { name: 'skill', message: 'Choose a skill', choices: [{ name: 'Skill', value: '1' }] };
    await expect(selectOne(options)).rejects.toBeInstanceOf(ui.PromptCancelledError);
    await expect(selectOne(options)).rejects.toBe(failure);
  });

  it('rejects non-interactive selections before displaying terminal controls', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const prompt = vi.spyOn(inquirer, 'prompt');
    await expect(selectMany({ name: 'skills', message: 'Choose skills', choices: [] })).rejects.toThrow('requires a terminal');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('fits tabular rows within the specified width', async () => {
    const result = await runCommand(() => ui.table(['Skill', 'Description'], [['demo', 'Very long description '.repeat(30)]], { width: 32 }));
    for (const line of result.stdout.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(32);
    expect(result.stdout).toContain('…');
  });

  it('preserves full identifiers with stacked rows when columns cannot fit', async () => {
    const slug = 'owner/very-long-nested-skill-path-that-must-be-copyable';
    const result = await runCommand(() => ui.table(['Slug', 'Description'], [[slug, 'A skill']], { width: 32, preserveColumns: [0] }));
    expect(result.stdout).toContain(`Slug: ${slug}`);
    expect(result.stdout).toContain('Description: A skill');
    expect(result.stdout).not.toContain('…');
  });

  it('sanitizes terminal controls in user-visible data', async () => {
    const result = await runCommand(() => ui.details('Preview', [['Name', 'demo\nVisibility: public\x1b]52;c;payload\x07']]));
    expect(result.stdout).toContain('Name: demo Visibility: public');
    expect(result.stdout).not.toContain('payload');
  });

  it('uses consistent status symbols and output channels', async () => {
    const result = await runCommand(() => { ui.success('Done.'); ui.info('Next step.'); ui.warn('Check this.'); ui.error('Failed.'); ui.cancelled(); });
    expect(result.stdout).toBe('✔ Done.\nℹ Next step.\nℹ Cancelled.');
    expect(result.stderr).toContain('⚠ Check this.');
    expect(result.stderr).toContain('✖ Failed.');
  });

  it('uses static, idempotent progress in non-interactive output', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line) => lines.push(stripAnsi(String(line))));
    const progress = ui.spinner('Loading');
    progress.stop(true);
    progress.stop(false);
    expect(write).not.toHaveBeenCalled();
    expect(lines).toEqual(['ℹ Loading', '✔ Loading']);
  });

  it('does not report a cancelled progress stage as a failure', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const result = await runCommand(() => { const progress = ui.spinner('Waiting'); progress.stop('cancelled'); ui.cancelled('Authorization cancelled.'); });
    expect(result.stdout).toBe('ℹ Waiting\nℹ Authorization cancelled.');
    expect(result.stderr).toBe('');
  });
});
