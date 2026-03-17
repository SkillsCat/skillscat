import { describe, expect, it } from 'vitest';
import type { SkillDetail } from '../src/lib/types';
import {
  buildOpenClawHomeMarkdown,
  buildOpenClawSkillMarkdown,
  isOpenClawUserAgent,
} from '../src/lib/server/openclaw/agent-markdown';

const sampleSkill: SkillDetail = {
  id: 'skill-1',
  name: 'SEO Audit Skill',
  slug: 'backrunner/tools/openclaw/setup',
  description: 'Audit SEO issues and produce a prioritized remediation list.',
  repoOwner: 'backrunner',
  repoName: 'tools',
  githubUrl: 'https://github.com/backrunner/tools',
  skillPath: 'openclaw/setup',
  stars: 42,
  forks: 7,
  trendingScore: 9,
  updatedAt: 1710000000000,
  lastCommitAt: 1710000000000,
  createdAt: 1700000000000,
  indexedAt: 1705000000000,
  readme: `---
name: SEO Audit Skill
---

# SEO Audit Skill

Use this skill to audit a website.`,
  fileStructure: null,
  categories: ['search', 'seo'],
  visibility: 'public',
  sourceType: 'github',
};

describe('openclaw agent markdown', () => {
  it('detects OpenClaw user agents', () => {
    expect(isOpenClawUserAgent('OpenClaw/1.4.0')).toBe(true);
    expect(isOpenClawUserAgent('Mozilla/5.0')).toBe(false);
  });

  it('includes OpenClaw install guidance on the home markdown response', () => {
    const text = buildOpenClawHomeMarkdown();

    expect(text).toContain('# SkillsCat for OpenClaw');
    expect(text).toContain('npx skillscat add <owner>/<repo> --agent openclaw');
    expect(text).toContain('/api/skills/<slug>/files');
    expect(text).toContain('https://skills.cat/llm.txt');
  });

  it('includes exact install guidance and the original SKILL.md on skill pages', () => {
    const text = buildOpenClawSkillMarkdown(sampleSkill);

    expect(text).toContain('# SEO Audit Skill');
    expect(text).toContain('`backrunner/tools/openclaw/setup`');
    expect(text).toContain('`npx skillscat add backrunner/tools --skill "SEO Audit Skill" --agent openclaw`');
    expect(text).toContain('`https://skills.cat/api/skills/backrunner%2Ftools%2Fopenclaw%2Fsetup/files`');
    expect(text).toContain('~/.openclaw/skills/seo-audit-skill/');
    expect(text).toContain('## Original SKILL.md');
    expect(text).toContain('Use this skill to audit a website.');
  });
});
