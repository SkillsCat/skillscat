import { describe, expect, it } from 'vitest';
import { normalizeClientShikiLanguage } from '../src/lib/shiki-client';

describe('normalizeClientShikiLanguage', () => {
  it('maps common aliases to the shared client shiki loaders', () => {
    expect(normalizeClientShikiLanguage('js')).toBe('javascript');
    expect(normalizeClientShikiLanguage('ts')).toBe('typescript');
    expect(normalizeClientShikiLanguage('shell')).toBe('shellscript');
    expect(normalizeClientShikiLanguage('zsh')).toBe('shellscript');
    expect(normalizeClientShikiLanguage('yml')).toBe('yaml');
    expect(normalizeClientShikiLanguage('ps1')).toBe('powershell');
    expect(normalizeClientShikiLanguage('cmd')).toBe('bat');
  });

  it('falls back to plaintext for empty or unsupported languages', () => {
    expect(normalizeClientShikiLanguage('')).toBe('plaintext');
    expect(normalizeClientShikiLanguage('   ')).toBe('plaintext');
    expect(normalizeClientShikiLanguage('made-up-language')).toBe('plaintext');
    expect(normalizeClientShikiLanguage(null)).toBe('plaintext');
    expect(normalizeClientShikiLanguage(undefined)).toBe('plaintext');
  });
});
