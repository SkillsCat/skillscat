import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureAuth, configureRegistry, createWorkspace, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

const REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || 'http://localhost:3000/registry';
const TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_local_token';
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function execLocalD1(sql: string): void {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@skillscat/web', 'exec', 'wrangler', 'd1', 'execute', 'skillscat-db', '--local', '-c', 'wrangler.preview.toml', '--command', sql],
    {
      cwd: ROOT_DIR,
      env: process.env,
      encoding: 'utf-8',
    }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to execute local D1 SQL: ${result.stderr || result.stdout}`);
  }
}

describe('CLI preview integration', () => {
  beforeEach(async () => {
    createWorkspace('preview');
    resetTestConfigDir();
    await configureRegistry(REGISTRY_URL);
    await configureAuth(TEST_TOKEN);
  });

  it('search returns seeded public skill', async () => {
    const { search } = await import('../src/commands/search');
    const result = await runCommand(() => search('Public Test Skill', { limit: '5' }));

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toContain('Found');
    expect(result.stdout).toContain('testowner/testrepo');
  });

  it('publish and unpublish a private skill', async () => {
    const skillDir = join(process.cwd(), 'skill');
    mkdirSync(skillDir, { recursive: true });
    const uniqueName = `Test Skill ${Date.now()}`;
    const skillMd = `---\nname: ${uniqueName}\ndescription: Test skill for CLI integration\n---\n# ${uniqueName}\nThis is a local test skill used for CLI integration tests.\n`;
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

    const { publish } = await import('../src/commands/publish');
    const publishResult = await runCommand(() => publish(skillDir, { yes: true }));

    expect(publishResult.exitCode).toBeNull();
    expect(publishResult.stdout).toContain('Skill published successfully');

    const slugMatch = publishResult.stdout.match(/Slug:\s+([^\s]+)/);
    expect(slugMatch).toBeTruthy();
    const slug = slugMatch![1];

    const { unpublishSkill } = await import('../src/commands/unpublish');
    const unpublishResult = await runCommand(() => unpublishSkill(slug, { yes: true }));

    expect(unpublishResult.exitCode).toBeNull();
    expect(unpublishResult.stdout).toContain('Skill unpublished successfully');
  });

  it('registry repo endpoint returns public repo skills, excludes unlisted, and sets cache headers', async () => {
    const unique = Date.now();
    const owner = 'repoapitest';
    const repo = `repo-${unique}`;
    const now = Date.now();

    execLocalD1(`
      INSERT INTO skills (id, name, slug, description, github_url, repo_owner, repo_name, skill_path, visibility, source_type, tier, created_at, updated_at, indexed_at)
      VALUES
        ('repo-public-${unique}', 'Repo Public Skill', 'repoapitest/repo-public-${unique}', 'public row', 'https://github.com/${owner}/${repo}', '${owner}', '${repo}', '', 'public', 'github', 'cold', ${now}, ${now}, ${now}),
        ('repo-unlisted-${unique}', 'Repo Hidden Skill', 'repoapitest/repo-hidden-${unique}', 'unlisted row', 'https://github.com/${owner}/${repo}', '${owner}', '${repo}', 'hidden-path', 'unlisted', 'github', 'cold', ${now}, ${now}, ${now});
    `);

    const response = await fetch(`${REGISTRY_URL}/repo/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control') || '').toContain('public');
    const xCache = response.headers.get('x-cache');
    if (xCache) {
      expect(['HIT', 'MISS', 'BYPASS']).toContain(xCache);
    }

    const data = await response.json() as { skills: Array<{ name: string; visibility: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.skills.map((s) => s.name)).toContain('Repo Public Skill');
    expect(data.skills.map((s) => s.name)).not.toContain('Repo Hidden Skill');
    expect(data.skills.every((s) => s.visibility !== 'unlisted')).toBe(true);

    const invalidResponse = await fetch(`${REGISTRY_URL}/repo/invalid!owner/${repo}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.headers.get('cache-control') || '').toContain('no-store');
  });

  it('anonymous /api/submit only allows CLI background-submit marker path', async () => {
    const noMarkerResponse = await fetch('http://localhost:3000/api/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'skillscat-cli/0.1.0',
      },
      body: JSON.stringify({ url: 'https://github.com/testowner/testrepo' }),
    });

    expect(noMarkerResponse.status).toBe(401);

    const cliBackgroundResponse = await fetch('http://localhost:3000/api/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'skillscat-cli/0.1.0',
        'X-Skillscat-Background-Submit': '1',
      },
      body: JSON.stringify({ url: 'not-a-github-url' }),
    });

    expect(cliBackgroundResponse.status).toBe(400);
    const body = await cliBackgroundResponse.json() as { message?: string };
    expect(JSON.stringify(body)).toContain('Invalid repository URL');
  });
});
