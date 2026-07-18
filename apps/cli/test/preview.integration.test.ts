import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureAuth, configureRegistry, createWorkspace, resetTestConfigDir } from './helpers/env';
import { runCommand } from './helpers/output';

const REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || 'http://localhost:3000/registry';
const TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_local_token';
const TEST_USER_ID = process.env.SKILLSCAT_TEST_USER_ID || 'user_cli_test';
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function execLocalD1(sql: string): void {
  const persistArgs = process.env.SKILLSCAT_TEST_PERSIST_TO
    ? ['--persist-to', process.env.SKILLSCAT_TEST_PERSIST_TO]
    : [];
  const result = spawnSync(
    'pnpm',
    [
      '--filter', '@skillscat/web', 'exec', 'wrangler',
      'd1', 'execute', 'skillscat-db', '--local',
      '-c', 'wrangler.preview.toml', ...persistArgs, '--command', sql,
    ],
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

function hashTestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
    mkdirSync(join(skillDir, 'templates'), { recursive: true });
    writeFileSync(join(skillDir, 'templates', 'prompt.txt'), 'Integration companion file', 'utf-8');

    const { publish } = await import('../src/commands/publish');
    const publishResult = await runCommand(() => publish(skillDir, { yes: true }));

    expect(publishResult.exitCode).toBeNull();
    expect(publishResult.stdout).toContain('Skill published successfully');

    const slugMatch = publishResult.stdout.match(/Slug:\s+([^\s]+)/);
    expect(slugMatch).toBeTruthy();
    const slug = slugMatch![1];

    const baseUrl = REGISTRY_URL.replace(/\/registry\/?$/, '');
    const filesResponse = await fetch(`${baseUrl}/api/skills/${encodeURIComponent(slug)}/files`, {
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'User-Agent': 'skillscat-cli/0.1.0',
      },
    });
    expect(filesResponse.status).toBe(200);
    const bundle = await filesResponse.json() as { files: Array<{ path: string; content: string }> };
    expect(bundle.files).toEqual(expect.arrayContaining([
      { path: 'SKILL.md', content: skillMd },
      { path: 'templates/prompt.txt', content: 'Integration companion file' },
    ]));

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
    expect(response.headers.get('cache-control') || '').toContain('private, no-cache');
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

  it('registry skill endpoint applies cache headers for public results and bypasses protected paths', async () => {
    const unique = Date.now();
    const owner = 'skillapitest';
    const name = `private-skill-${unique}`;
    const slug = `${owner}/${name}`;
    const now = Date.now();

    execLocalD1(`
      INSERT INTO skills (id, name, slug, description, repo_owner, repo_name, github_url, visibility, source_type, owner_id, readme, created_at, updated_at, indexed_at)
      VALUES (
        'private-skill-${unique}',
        'Private Endpoint Skill',
        '${slug}',
        'private row',
        '${owner}',
        '${name}',
        NULL,
        'private',
        'upload',
        '${TEST_USER_ID}',
        '---
name: Private Endpoint Skill
description: private row
---
# Private Endpoint Skill
private content
',
        ${now},
        ${now},
        ${now}
      );
    `);

    const publicResponse = await fetch(`${REGISTRY_URL}/skill/testowner/testrepo`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('cache-control') || '').toContain('private, no-cache');
    expect(publicResponse.headers.get('vary') || '').toContain('Authorization');
    expect(publicResponse.headers.get('x-cache')).toMatch(/^(HIT|MISS)$/);
    const publicData = await publicResponse.json() as { name: string; visibility: string };
    expect(publicData.name).toBe('Public Test Skill');
    expect(publicData.visibility).toBe('public');

    const privateAnonResponse = await fetch(`${REGISTRY_URL}/skill/${owner}/${name}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(privateAnonResponse.status).toBe(401);
    expect(privateAnonResponse.headers.get('cache-control') || '').toContain('no-store');
    expect(privateAnonResponse.headers.get('vary') || '').toContain('Authorization');
    expect(privateAnonResponse.headers.get('x-cache')).toBe('BYPASS');

    const privateAuthedResponse = await fetch(`${REGISTRY_URL}/skill/${owner}/${name}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
        Authorization: `Bearer ${TEST_TOKEN}`,
      }
    });

    expect(privateAuthedResponse.status).toBe(200);
    expect(privateAuthedResponse.headers.get('cache-control') || '').toContain('private, no-cache');
    expect(privateAuthedResponse.headers.get('vary') || '').toContain('Authorization');
    expect(privateAuthedResponse.headers.get('x-cache')).toBe('BYPASS');
    const privateData = await privateAuthedResponse.json() as { name: string; visibility: string; content: string };
    expect(privateData.name).toBe('Private Endpoint Skill');
    expect(privateData.visibility).toBe('private');
    expect(privateData.content).toContain('private content');

    const missingResponse = await fetch(`${REGISTRY_URL}/skill/${owner}/missing-${unique}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get('cache-control') || '').toContain('no-store');
    expect(missingResponse.headers.get('vary') || '').toContain('Authorization');
    expect(missingResponse.headers.get('x-cache')).toBe('BYPASS');
  });

  it('api skill detail and files endpoints cache public results and bypass protected paths', async () => {
    const unique = Date.now();
    const owner = 'apiskilltest';
    const name = `private-skill-${unique}`;
    const slug = `${owner}/${name}`;
    const now = Date.now();

    execLocalD1(`
      INSERT INTO skills (id, name, slug, description, repo_owner, repo_name, github_url, visibility, source_type, owner_id, readme, created_at, updated_at, indexed_at)
      VALUES (
        'api-private-skill-${unique}',
        'Private API Skill',
        '${slug}',
        'private api row',
        '${owner}',
        '${name}',
        NULL,
        'private',
        'upload',
        '${TEST_USER_ID}',
        '---
name: Private API Skill
description: private api row
---
# Private API Skill
private api content
',
        ${now},
        ${now},
        ${now}
      );
    `);

    const publicSlug = encodeURIComponent('testowner/testrepo');
    const privateSlug = encodeURIComponent(slug);

    const publicDetailResponse = await fetch(`http://localhost:3000/api/skills/${publicSlug}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(publicDetailResponse.status).toBe(200);
    expect(publicDetailResponse.headers.get('cache-control') || '').toContain('private, no-cache');
    expect(publicDetailResponse.headers.get('vary') || '').toContain('Authorization');
    expect(publicDetailResponse.headers.get('x-cache')).toMatch(/^(HIT|MISS)$/);
    const publicDetail = await publicDetailResponse.json() as { success: boolean; data: { skill: { visibility: string } } };
    expect(publicDetail.success).toBe(true);
    expect(publicDetail.data.skill.visibility).toBe('public');

    const privateDetailAnon = await fetch(`http://localhost:3000/api/skills/${privateSlug}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(privateDetailAnon.status).toBe(401);
    expect(privateDetailAnon.headers.get('cache-control') || '').toContain('no-store');
    expect(privateDetailAnon.headers.get('vary') || '').toContain('Authorization');
    expect(privateDetailAnon.headers.get('x-cache')).toBe('BYPASS');

    const privateDetailAuthed = await fetch(`http://localhost:3000/api/skills/${privateSlug}`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
        Authorization: `Bearer ${TEST_TOKEN}`,
      }
    });

    expect(privateDetailAuthed.status).toBe(200);
    expect(privateDetailAuthed.headers.get('cache-control') || '').toContain('private, no-cache');
    expect(privateDetailAuthed.headers.get('vary') || '').toContain('Authorization');
    expect(privateDetailAuthed.headers.get('x-cache')).toBe('BYPASS');
    const privateDetail = await privateDetailAuthed.json() as { success: boolean; data: { skill: { visibility: string } } };
    expect(privateDetail.success).toBe(true);
    expect(privateDetail.data.skill.visibility).toBe('private');

    const publicFilesResponse = await fetch(`http://localhost:3000/api/skills/${publicSlug}/files`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(publicFilesResponse.status).toBe(200);
    expect(publicFilesResponse.headers.get('cache-control') || '').toContain('private, no-cache');
    expect(publicFilesResponse.headers.get('vary') || '').toContain('Authorization');
    expect(publicFilesResponse.headers.get('x-cache')).toMatch(/^(HIT|MISS)$/);
    const publicFiles = await publicFilesResponse.json() as { files: Array<{ path: string }> };
    expect(publicFiles.files.some((file) => file.path === 'SKILL.md')).toBe(true);

    const privateFilesAnon = await fetch(`http://localhost:3000/api/skills/${privateSlug}/files`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
      }
    });

    expect(privateFilesAnon.status).toBe(401);
    expect(privateFilesAnon.headers.get('cache-control') || '').toContain('no-store');
    expect(privateFilesAnon.headers.get('vary') || '').toContain('Authorization');
    expect(privateFilesAnon.headers.get('x-cache')).toBe('BYPASS');

    const privateFilesAuthed = await fetch(`http://localhost:3000/api/skills/${privateSlug}/files`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
        Authorization: `Bearer ${TEST_TOKEN}`,
      }
    });

    expect(privateFilesAuthed.status).toBe(200);
    expect(privateFilesAuthed.headers.get('cache-control') || '').toContain('private, no-cache');
    expect(privateFilesAuthed.headers.get('vary') || '').toContain('Authorization');
    expect(privateFilesAuthed.headers.get('x-cache')).toBe('BYPASS');
    const privateFiles = await privateFilesAuthed.json() as { files: Array<{ path: string; content: string }> };
    expect(privateFiles.files[0]?.path).toBe('SKILL.md');
    expect(privateFiles.files[0]?.content).toContain('private api content');
  });

  it('keeps warmed public content inaccessible after the authoritative row becomes private', async () => {
    const unique = Date.now();
    const owner = 'cacheboundary';
    const name = `transition-${unique}`;
    const slug = `${owner}/${name}`;
    const now = Date.now();

    execLocalD1(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, visibility,
        source_type, owner_id, readme, created_at, updated_at, indexed_at
      ) VALUES (
        'cache-boundary-${unique}',
        'Cache Boundary Skill',
        '${slug}',
        'public before transition',
        '${owner}',
        '${name}',
        'public',
        'upload',
        '${TEST_USER_ID}',
        '# Cache Boundary Skill
public cached content
',
        ${now},
        ${now},
        ${now}
      );
    `);

    const registryEndpoint = `${REGISTRY_URL}/skill/${owner}/${name}`;
    const repoEndpoint = `${REGISTRY_URL}/repo/${owner}/${name}`;
    const searchEndpoint = `${REGISTRY_URL}/search?q=${encodeURIComponent('Cache Boundary Skill')}`;
    const apiSearchEndpoint = `http://localhost:3000/api/search?q=${encodeURIComponent('Cache Boundary Skill')}`;
    const encodedSlug = encodeURIComponent(slug);
    const publicHeaders = { 'User-Agent': 'skillscat-cli/0.1.0' };
    expect((await fetch(registryEndpoint, { headers: publicHeaders })).status).toBe(200);
    expect((await fetch(`http://localhost:3000/api/skills/${encodedSlug}`, { headers: publicHeaders })).status).toBe(200);
    expect((await fetch(`http://localhost:3000/api/skills/${encodedSlug}/files`, { headers: publicHeaders })).status).toBe(200);
    const warmedRepo = await fetch(repoEndpoint, { headers: publicHeaders });
    expect(warmedRepo.status).toBe(200);
    expect((await warmedRepo.json() as { skills: Array<{ slug: string }> }).skills)
      .toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));
    const warmedSearch = await fetch(searchEndpoint, { headers: publicHeaders });
    expect(warmedSearch.status).toBe(200);
    expect((await warmedSearch.json() as { skills: Array<{ slug: string }> }).skills)
      .toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));
    const warmedApiSearch = await fetch(apiSearchEndpoint, { headers: publicHeaders });
    expect(warmedApiSearch.status).toBe(200);
    expect((await warmedApiSearch.json() as { data: { skills: Array<{ slug: string }> } }).data.skills)
      .toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));

    const visibilityResponse = await fetch(
      `http://localhost:3000/api/skills/cache-boundary-${unique}/visibility`,
      {
        method: 'PUT',
        headers: {
          ...publicHeaders,
          Authorization: `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visibility: 'private' }),
      }
    );
    expect(visibilityResponse.status).toBe(200);

    expect((await fetch(registryEndpoint, { headers: publicHeaders })).status).toBe(401);
    expect((await fetch(`http://localhost:3000/api/skills/${encodedSlug}`, { headers: publicHeaders })).status).toBe(401);
    expect((await fetch(`http://localhost:3000/api/skills/${encodedSlug}/files`, { headers: publicHeaders })).status).toBe(401);
    const privateRepo = await fetch(repoEndpoint, { headers: publicHeaders });
    expect(privateRepo.status).toBe(200);
    expect((await privateRepo.json() as { skills: Array<{ slug: string }> }).skills)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));
    const privateSearch = await fetch(searchEndpoint, { headers: publicHeaders });
    expect(privateSearch.status).toBe(200);
    expect((await privateSearch.json() as { skills: Array<{ slug: string }> }).skills)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));
    const privateApiSearch = await fetch(apiSearchEndpoint, { headers: publicHeaders });
    expect(privateApiSearch.status).toBe(200);
    expect((await privateApiSearch.json() as { data: { skills: Array<{ slug: string }> } }).data.skills)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));

    const authorized = await fetch(registryEndpoint, {
      headers: { ...publicHeaders, Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain('public cached content');
  });

  it('supports organization-token search, install, view, and update after the uploader leaves', async () => {
    const unique = Date.now();
    const orgId = `org-cli-${unique}`;
    const orgSlug = `orgcli${unique}`;
    const skillId = `org-skill-${unique}`;
    const skillName = `Org Private Skill ${unique}`;
    const skillSlug = `${orgSlug}/private-skill`;
    const orgToken = `sk_org_preview_${unique}`;
    const now = Date.now();
    const v1 = `---
name: ${skillName}
description: Organization private integration skill
---
# ${skillName}
organization private v1
`;

    execLocalD1(`
      INSERT INTO organizations (id, name, slug, display_name, owner_id, created_at, updated_at)
      VALUES ('${orgId}', '${orgSlug}', '${orgSlug}', 'Org CLI Test', '${TEST_USER_ID}', ${now}, ${now});

      INSERT INTO org_members (org_id, user_id, role, joined_at)
      VALUES ('${orgId}', '${TEST_USER_ID}', 'owner', ${now});

      INSERT INTO api_tokens (
        id, user_id, org_id, name, token_hash, token_prefix, scopes, expires_at, created_at
      ) VALUES (
        'org-token-${unique}',
        NULL,
        '${orgId}',
        'Org Integration Token',
        '${hashTestToken(orgToken)}',
        '${orgToken.slice(0, 11)}',
        '["read","write","publish"]',
        NULL,
        ${now}
      );

      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, visibility,
        source_type, owner_id, org_id, readme, created_at, updated_at, indexed_at
      ) VALUES (
        '${skillId}',
        '${skillName}',
        '${skillSlug}',
        'Organization private integration skill',
        '${orgSlug}',
        'private-skill',
        'private',
        'upload',
        '${TEST_USER_ID}',
        '${orgId}',
        '${v1.replaceAll("'", "''")}',
        ${now},
        ${now},
        ${now}
      );
    `);

    const { setToken } = await import('../src/utils/auth/auth');
    setToken(orgToken, { type: 'org', id: orgId, slug: orgSlug, name: 'Org CLI Test' });

    const { whoami } = await import('../src/commands/whoami');
    const whoamiResult = await runCommand(() => whoami());
    expect(whoamiResult.stdout).toContain('Organization: Org CLI Test');

    const { search } = await import('../src/commands/search');
    const searchResult = await runCommand(() => search(skillName, { limit: '5' }));
    expect(searchResult.exitCode).toBeNull();
    expect(searchResult.stdout).toContain(skillSlug);
    expect(searchResult.stdout).toContain('[private]');

    // The historical uploader no longer has implicit access after leaving.
    execLocalD1(`DELETE FROM org_members WHERE org_id = '${orgId}' AND user_id = '${TEST_USER_ID}';`);
    const userResponse = await fetch(`${REGISTRY_URL}/skill/${orgSlug}/private-skill`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(userResponse.status).toBe(403);

    const { add } = await import('../src/commands/add');
    const addResult = await runCommand(() => add(skillSlug, { yes: true, agent: ['agents'] }));
    expect(addResult.exitCode).toBeNull();
    const installedFile = join(process.cwd(), '.agents', skillName, 'SKILL.md');
    expect(readFileSync(installedFile, 'utf-8')).toContain('organization private v1');

    const { view } = await import('../src/commands/view');
    const viewResult = await runCommand(() => view(skillSlug));
    expect(viewResult.exitCode).toBeNull();
    expect(viewResult.stdout).toContain('organization private v1');

    const v2 = v1.replace('organization private v1', 'organization private v2');
    execLocalD1(`
      UPDATE skills
      SET readme = '${v2.replaceAll("'", "''")}', content_hash = NULL, updated_at = ${now + 1}
      WHERE id = '${skillId}';
    `);

    const { update } = await import('../src/commands/update');
    const updateResult = await runCommand(() => update(skillName, {}));
    expect(updateResult.exitCode).toBeNull();
    expect(updateResult.stdout).toContain('Updated 1 skill');
    expect(readFileSync(installedFile, 'utf-8')).toContain('organization private v2');

    const writeOnlyOrgToken = `sk_org_write_preview_${unique}`;
    execLocalD1(`
      INSERT INTO api_tokens (
        id, user_id, org_id, name, token_hash, token_prefix, scopes, expires_at, created_at
      ) VALUES (
        'org-write-token-${unique}',
        NULL,
        '${orgId}',
        'Org Write Integration Token',
        '${hashTestToken(writeOnlyOrgToken)}',
        '${writeOnlyOrgToken.slice(0, 11)}',
        '["write"]',
        NULL,
        ${now + 2}
      );
    `);
    setToken(writeOnlyOrgToken, { type: 'org', id: orgId, slug: orgSlug, name: 'Org CLI Test' });

    const { unpublishSkill } = await import('../src/commands/unpublish');
    const unpublishResult = await runCommand(() => unpublishSkill(skillSlug, { yes: true }));
    expect(unpublishResult.exitCode).toBeNull();
    expect(unpublishResult.stdout).toContain('Skill unpublished successfully');
    expect((await fetch(`${REGISTRY_URL}/skill/${orgSlug}/private-skill`, {
      headers: { 'User-Agent': 'skillscat-cli/0.1.0' },
    })).status).toBe(404);
  });

  it('registry repo and search preserve 403 with no-store when token lacks read scope', async () => {
    const unique = Date.now();
    const writeOnlyToken = `sk_write_only_preview_${unique}`;
    const tokenId = `write-only-token-${unique}`;
    const now = Date.now();

    execLocalD1(`
      INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
      VALUES (
        '${tokenId}',
        '${TEST_USER_ID}',
        'Write Only Preview Token',
        '${hashTestToken(writeOnlyToken)}',
        '${writeOnlyToken.slice(0, 11)}',
        '["write"]',
        NULL,
        ${now}
      );
    `);

    const repoResponse = await fetch(`${REGISTRY_URL}/repo/testowner/testrepo`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
        Authorization: `Bearer ${writeOnlyToken}`,
      }
    });

    expect(repoResponse.status).toBe(403);
    expect(repoResponse.headers.get('cache-control') || '').toContain('no-store');
    expect(repoResponse.headers.get('vary') || '').toContain('Authorization');
    expect(repoResponse.headers.get('x-cache')).toBe('BYPASS');
    const repoError = await repoResponse.json() as { error: string };
    expect(repoError.error).toContain("Scope 'read' required");

    const searchResponse = await fetch(`${REGISTRY_URL}/search?include_private=true&q=Public`, {
      headers: {
        'User-Agent': 'skillscat-cli/0.1.0',
        Authorization: `Bearer ${writeOnlyToken}`,
      }
    });

    expect(searchResponse.status).toBe(403);
    expect(searchResponse.headers.get('cache-control') || '').toContain('no-store');
    expect(searchResponse.headers.get('vary') || '').toContain('Authorization');
    expect(searchResponse.headers.get('x-cache')).toBe('BYPASS');
    const searchError = await searchResponse.json() as { error: string };
    expect(searchError.error).toContain("Scope 'read' required");
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
