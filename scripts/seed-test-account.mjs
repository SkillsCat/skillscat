#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const WRANGLER_CONFIG = resolve(ROOT_DIR, 'apps/web/wrangler.preview.toml');

const token = process.env.SKILLSCAT_TEST_TOKEN || 'sk_test_cli_token_00000000000000000000000000000000';
const userId = process.env.SKILLSCAT_TEST_USER_ID || 'user_cli_test';
const userName = process.env.SKILLSCAT_TEST_USER_NAME || 'testuser';
const userEmail = process.env.SKILLSCAT_TEST_USER_EMAIL || 'test@skillscat.local';
const tokenId = process.env.SKILLSCAT_TEST_TOKEN_ID || 'token_cli_test';

const now = Date.now();
const tokenHash = createHash('sha256').update(token).digest('hex');
const tokenPrefix = token.slice(0, 11);
const scopes = JSON.stringify(['read', 'write', 'publish']);
const publicSkillId = 'skill_public_test';
const publicSkillName = 'Public Test Skill';
const publicSkillSlug = 'testowner/testrepo';
const publicSkillRepoOwner = 'testowner';
const publicSkillRepoName = 'testrepo';
const publicSkillUrl = 'https://github.com/testowner/testrepo';

const publicSkillContent = `---
name: Public Test Skill
description: Seeded public skill for CLI tests
---
# Public Test Skill

This is a seeded public skill used for CLI integration tests.
`;

const sql = `
DELETE FROM api_tokens WHERE id = '${tokenId}' OR token_hash = '${tokenHash}';
DELETE FROM user WHERE id = '${userId}';
DELETE FROM skills WHERE id = '${publicSkillId}' OR (repo_owner = '${publicSkillRepoOwner}' AND repo_name = '${publicSkillRepoName}' AND skill_path IS NULL);
INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
VALUES ('${userId}', '${userName}', '${userEmail}', 1, NULL, ${now}, ${now});
INSERT INTO api_tokens (id, user_id, org_id, name, token_hash, token_prefix, scopes, last_used_at, expires_at, created_at, revoked_at)
VALUES ('${tokenId}', '${userId}', NULL, 'cli-test', '${tokenHash}', '${tokenPrefix}', '${scopes}', NULL, NULL, ${now}, NULL);
INSERT INTO skills (id, name, slug, description, repo_owner, repo_name, github_url, visibility, source_type)
VALUES ('${publicSkillId}', '${publicSkillName}', '${publicSkillSlug}', 'Seeded public skill for CLI tests', '${publicSkillRepoOwner}', '${publicSkillRepoName}', '${publicSkillUrl}', 'public', 'github');
`;

try {
  // Seed D1 database
  execFileSync('npx', [
    'wrangler',
    'd1',
    'execute',
    'skillscat-db',
    '--local',
    '-c',
    WRANGLER_CONFIG,
    '--command',
    sql,
  ], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  // Seed R2 with SKILL.md content
  const tmpFile = join(tmpdir(), `skillscat-seed-${Date.now()}.md`);
  writeFileSync(tmpFile, publicSkillContent, 'utf-8');

  const r2Key = `skills/${publicSkillRepoOwner}/${publicSkillRepoName}/SKILL.md`;
  execFileSync('npx', [
    'wrangler',
    'r2',
    'object',
    'put',
    `skillscat-storage/${r2Key}`,
    '--local',
    '--file',
    tmpFile,
    '--content-type',
    'text/markdown',
    '-c',
    WRANGLER_CONFIG,
  ], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

   
  console.log(`Seeded local test account: ${userName} (${userEmail})`);
   
  console.log(`Test token: ${token}`);
} catch (error) {
   
  console.error('Failed to seed test account:', error);
  process.exit(1);
}
