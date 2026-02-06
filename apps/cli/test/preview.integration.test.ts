import { beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureAuth, configureRegistry, createWorkspace, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

const REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || 'http://localhost:3000/registry';
const TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_cli_token_00000000000000000000000000000000';

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
});
