import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { decodeBase64Utf8, looksLikeGarbledUnicode, looksLikeUtf8Mojibake, repairUtf8Mojibake } from '../src/lib/server/text-codec';
import { normalizeExtractedSkillTitle, stripYamlInlineComment } from '../src/lib/server/skill-title';
import { parseSkillFrontmatter, resolveSkillMetadata } from '../workers/indexing';

describe('text-codec', () => {
  it('decodes base64 UTF-8 payloads without corrupting CJK or emoji', () => {
    const value = '中文标题 😀';
    const encoded = Buffer.from(value, 'utf8').toString('base64');

    expect(decodeBase64Utf8(encoded)).toBe(value);
  });

  it('detects and repairs UTF-8 mojibake produced by latin1 decoding', () => {
    const mojibake = 'ä¸­æð';

    expect(looksLikeUtf8Mojibake(mojibake)).toBe(true);
    expect(repairUtf8Mojibake(mojibake)).toBe('中文😀');
  });

  it('does not flag normal ASCII strings as mojibake', () => {
    expect(looksLikeUtf8Mojibake('plain-title')).toBe(false);
    expect(repairUtf8Mojibake('plain-title')).toBeNull();
  });

  it('treats replacement characters as garbled unicode candidates', () => {
    expect(looksLikeGarbledUnicode('bad-title-�')).toBe(true);
  });
});

describe('resolveSkillMetadata', () => {
  it('falls back to the decoded markdown heading when frontmatter name is absent', () => {
    const parsed = parseSkillFrontmatter(`# 中文标题 😀\n\n第一段描述`);

    expect(resolveSkillMetadata({
      name: 'repo-name',
      description: 'repo description',
    }, parsed)).toEqual({
      name: '中文标题 😀',
      description: '第一段描述',
    });
  });

  it('prefers frontmatter metadata when present', () => {
    const parsed = parseSkillFrontmatter(`---\nname: 中文技能 🚀\ndescription: 这是描述\n---\n# Ignored title\n\nIgnored description`);

    expect(resolveSkillMetadata({
      name: 'repo-name',
      description: 'repo description',
    }, parsed)).toEqual({
      name: '中文技能 🚀',
      description: '这是描述',
    });
  });

  it('normalizes extracted names by removing cosmetic quotes and braces', () => {
    expect(normalizeExtractedSkillTitle('openai的"playwright"')).toBe('openai的playwright');
    expect(normalizeExtractedSkillTitle('{playwright}')).toBe('playwright');
    expect(normalizeExtractedSkillTitle('「Playwright」 Skill')).toBe('Playwright Skill');
  });

  it('keeps meaningful parentheses intact', () => {
    expect(normalizeExtractedSkillTitle('デスクトップアプリ（Electron）企画スキル')).toBe(
      'デスクトップアプリ（Electron）企画スキル'
    );
  });

  it('keeps inline placeholder brackets intact', () => {
    expect(normalizeExtractedSkillTitle('実行例: [対象サイト]のドキュメントを構造化する')).toBe(
      '実行例: [対象サイト]のドキュメントを構造化する'
    );
  });

  it('strips unquoted yaml inline comments from frontmatter names', () => {
    expect(stripYamlInlineComment('your-skill-name       # MUST exactly match the folder name')).toBe(
      'your-skill-name'
    );
    expect(stripYamlInlineComment('"The \\"Anti-ZIRP\\" Decision Framework"')).toBe(
      '"The \\"Anti-ZIRP\\" Decision Framework"'
    );
  });

  it('applies normalization to frontmatter-derived names', () => {
    const parsed = parseSkillFrontmatter(`---\nname: openai的"playwright"\ndescription: desc\n---\n# Ignored title`);

    expect(resolveSkillMetadata({
      name: 'repo-name',
      description: 'repo description',
    }, parsed)).toEqual({
      name: 'openai的playwright',
      description: 'desc',
    });
  });
});
