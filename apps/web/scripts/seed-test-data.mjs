#!/usr/bin/env node

/**
 * Seed test data (skills, messages, org) for local development
 *
 * Interactive — queries local D1 for existing users/orgs and lets you pick.
 *
 * Usage:
 *   node scripts/seed-test-data.mjs                # interactive mode
 *   node scripts/seed-test-data.mjs --clean        # remove all seeded data
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, '..');
const ROOT_DIR = resolve(WEB_DIR, '../..');
const WRANGLER_CONFIG = resolve(WEB_DIR, 'wrangler.preview.toml');
const PREFIX = 'seed_';
const now = Date.now();

// ── Helpers ─────────────────────────────────────────────
function id(suffix) { return `${PREFIX}${suffix}`; }

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function runSQL(sql) {
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'skillscat-db',
    '--local', '-c', WRANGLER_CONFIG, '--command', sql,
  ], { cwd: ROOT_DIR, stdio: 'inherit', env: process.env });
}

function queryJSON(sql) {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'skillscat-db',
    '--local', '-c', WRANGLER_CONFIG, '--command', sql, '--json',
  ], { cwd: ROOT_DIR, env: process.env, encoding: 'utf-8' });
  try {
    const parsed = JSON.parse(out);
    return parsed[0]?.results || [];
  } catch {
    return [];
  }
}

function putR2(key, content) {
  const tmp = join(tmpdir(), `seed-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(tmp, content, 'utf-8');
  execFileSync('npx', [
    'wrangler', 'r2', 'object', 'put', `skillscat-storage/${key}`,
    '--local', '--file', tmp, '--content-type', 'text/markdown',
    '-c', WRANGLER_CONFIG,
  ], { cwd: ROOT_DIR, stdio: 'inherit', env: process.env });
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function printMenu(items, labelFn) {
  items.forEach((item, i) => console.log(`  ${i + 1}) ${labelFn(item)}`));
}

async function pickOne(prompt, items, labelFn) {
  if (items.length === 0) return null;
  console.log();
  printMenu(items, labelFn);
  console.log(`  0) Skip`);
  const answer = await ask(`${prompt} [0-${items.length}]: `);
  const idx = parseInt(answer, 10);
  if (isNaN(idx) || idx < 1 || idx > items.length) return null;
  return items[idx - 1];
}

// ── Skill templates ─────────────────────────────────────
const SKILL_TEMPLATES = [
  {
    suffix: 'skill_1', name: 'React Component Generator',
    repoSuffix: 'react-component-gen',
    desc: 'Generate React components with TypeScript and tests',
    stars: 128, forks: 23, trending: 45.2,
    categories: ['code-generation', 'ui-components', 'testing'],
    tags: ['react', 'typescript', 'components'],
  },
  {
    suffix: 'skill_2', name: 'Git Commit Wizard',
    repoSuffix: 'git-commit-wizard',
    desc: 'AI-powered conventional commit message generator',
    stars: 256, forks: 41, trending: 72.8,
    categories: ['git', 'automation', 'prompts'],
    tags: ['git', 'commits', 'conventional-commits'],
  },
  {
    suffix: 'skill_3', name: 'API Doc Builder',
    repoSuffix: 'api-doc-builder',
    desc: 'Auto-generate OpenAPI docs from code comments',
    stars: 89, forks: 12, trending: 31.5,
    categories: ['api', 'documentation'],
    tags: ['openapi', 'swagger', 'docs'],
  },
];

const ORG_SKILL_TEMPLATE = {
  suffix: 'skill_org_1', name: 'Org Security Scanner',
  repoSuffix: 'security-scanner',
  desc: 'Automated security vulnerability scanner for CI/CD pipelines',
  stars: 512, forks: 87, trending: 88.3,
  categories: ['security', 'ci-cd'],
  tags: ['security', 'scanner', 'cicd', 'vulnerabilities'],
};

// ── SQL builders ────────────────────────────────────────
function buildSkillSQL(tpl, ownerName, ownerUserId, orgId) {
  const skillId = id(tpl.suffix);
  const slug = `${ownerName}/${tpl.repoSuffix}`;
  const commitAt = now - Math.floor(Math.random() * 30) * 86400000;
  const lines = [
    `INSERT OR REPLACE INTO skills (id, name, slug, description, repo_owner, repo_name, github_url, stars, forks, trending_score, last_commit_at, visibility, source_type, owner_id, org_id, created_at, updated_at, indexed_at)`
    + ` VALUES (${esc(skillId)}, ${esc(tpl.name)}, ${esc(slug)}, ${esc(tpl.desc)}, ${esc(ownerName)}, ${esc(tpl.repoSuffix)}, ${esc(`https://github.com/${ownerName}/${tpl.repoSuffix}`)}, ${tpl.stars}, ${tpl.forks}, ${tpl.trending}, ${commitAt}, 'public', 'github', ${esc(ownerUserId)}, ${esc(orgId)}, ${now}, ${now}, ${now});`,
  ];
  for (const cat of tpl.categories) {
    lines.push(`INSERT OR REPLACE INTO skill_categories (skill_id, category_slug) VALUES (${esc(skillId)}, ${esc(cat)});`);
  }
  for (const tag of tpl.tags) {
    lines.push(`INSERT OR REPLACE INTO skill_tags (skill_id, tag, created_at) VALUES (${esc(skillId)}, ${esc(tag)}, ${now});`);
  }
  return { sql: lines.join('\n'), ownerName, repoSuffix: tpl.repoSuffix, tpl };
}

function buildSkillMD(tpl) {
  return `---\nname: ${tpl.name}\ndescription: ${tpl.desc}\ntags: [${tpl.tags.join(', ')}]\n---\n# ${tpl.name}\n\n${tpl.desc}\n\nThis is seeded test data for local development.\n`;
}

function buildMessagesSQL(userId) {
  const msgs = [
    { suffix: 'msg_1', type: 'org_invite', title: 'Organization Invite', message: 'You have been invited to join "test-org" as a member.', meta: { orgSlug: 'test-org', orgName: 'Test Org', role: 'member' }, read: 0 },
    { suffix: 'msg_2', type: 'skill_shared', title: 'Skill Shared With You', message: 'Someone shared "React Component Generator" with you.', meta: { skillName: 'React Component Generator' }, read: 0 },
    { suffix: 'msg_3', type: 'skill_shared', title: 'New Skill Available', message: 'A new skill "Org Security Scanner" has been added to your organization.', meta: { skillName: 'Org Security Scanner' }, read: 1 },
    { suffix: 'msg_4', type: 'org_invite', title: 'Admin Promotion', message: 'You have been promoted to admin in "test-org".', meta: { orgSlug: 'test-org', orgName: 'Test Org', role: 'admin' }, read: 0 },
    { suffix: 'msg_5', type: 'skill_shared', title: 'Skill Update', message: '"Git Commit Wizard" has been updated with new features.', meta: { skillName: 'Git Commit Wizard' }, read: 0 },
  ];
  return msgs.map((m, i) => {
    const createdAt = now - (msgs.length - i) * 3600000;
    return `INSERT OR REPLACE INTO notifications (id, user_id, type, title, message, metadata, read, processed, created_at)`
      + ` VALUES (${esc(id(m.suffix))}, ${esc(userId)}, ${esc(m.type)}, ${esc(m.title)}, ${esc(m.message)}, ${esc(JSON.stringify(m.meta))}, ${m.read}, 0, ${createdAt});`;
  }).join('\n');
}

// ── Clean ───────────────────────────────────────────────
function clean() {
  console.log('\nCleaning all seeded test data...');
  runSQL([
    `DELETE FROM skill_tags WHERE skill_id LIKE '${PREFIX}%';`,
    `DELETE FROM skill_categories WHERE skill_id LIKE '${PREFIX}%';`,
    `DELETE FROM skills WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM notifications WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM org_members WHERE org_id LIKE '${PREFIX}%';`,
    `DELETE FROM organizations WHERE id LIKE '${PREFIX}%';`,
  ].join('\n'));
  console.log('Done — all seed_ prefixed data removed.\n');
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--clean')) {
    clean();
    rl.close();
    return;
  }

  console.log('\n=== SkillsCat Test Data Seeder ===\n');

  // 1) List users from local D1
  const users = queryJSON("SELECT id, name, email FROM user ORDER BY created_at DESC LIMIT 20;");
  if (users.length === 0) {
    console.log('No users found in local D1. Start the dev server and sign in first.');
    rl.close();
    return;
  }

  // 2) Pick a user
  console.log('Available users:');
  const user = await pickOne('Select a user', users, u => `${u.name} (${u.email}) [${u.id}]`);
  if (!user) {
    console.log('No user selected, exiting.');
    rl.close();
    return;
  }
  console.log(`\nSelected user: ${user.name} (${user.id})`);

  // 3) Choose what to seed
  console.log('\nWhat to seed?');
  console.log('  1) Skills for this user');
  console.log('  2) Messages (notifications) for this user');
  console.log('  3) Create an org for this user + add an org skill');
  console.log('  4) All of the above');
  const choice = await ask('Choose [1-4]: ');

  const doSkills   = choice === '1' || choice === '4';
  const doMessages = choice === '2' || choice === '4';
  const doOrg      = choice === '3' || choice === '4';

  if (!doSkills && !doMessages && !doOrg) {
    console.log('Nothing selected, exiting.');
    rl.close();
    return;
  }

  // 4) Seed skills
  if (doSkills) {
    console.log(`\nSeeding ${SKILL_TEMPLATES.length} skills for "${user.name}"...`);
    const ownerName = user.name;
    const parts = SKILL_TEMPLATES.map(tpl => buildSkillSQL(tpl, ownerName, user.id, null));
    runSQL(parts.map(p => p.sql).join('\n'));
    for (const p of parts) {
      putR2(`skills/${p.ownerName}/${p.repoSuffix}/SKILL.md`, buildSkillMD(p.tpl));
    }
    console.log(`  ✓ ${SKILL_TEMPLATES.length} skills inserted`);
  }

  // 5) Seed messages
  if (doMessages) {
    console.log(`\nSeeding 5 messages for "${user.name}"...`);
    runSQL(buildMessagesSQL(user.id));
    console.log('  ✓ 5 notifications inserted (4 unread, 1 read)');
  }

  // 6) Seed org
  if (doOrg) {
    // Check existing orgs or create new
    const orgs = queryJSON("SELECT id, name, slug FROM organizations ORDER BY created_at DESC LIMIT 20;");
    let targetOrg = null;

    if (orgs.length > 0) {
      console.log('\nExisting organizations found. Use existing or create new?');
      console.log('  0) Create new org');
      printMenu(orgs, o => `${o.name} (${o.slug}) [${o.id}]`);
      const orgChoice = await ask(`Choose [0-${orgs.length}]: `);
      const orgIdx = parseInt(orgChoice, 10);
      if (orgIdx >= 1 && orgIdx <= orgs.length) {
        targetOrg = orgs[orgIdx - 1];
      }
    }

    if (!targetOrg) {
      // Create new org
      const orgName = await ask('Org name (default: test-org): ') || 'test-org';
      const orgSlug = orgName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const newOrgId = id(`org_${Date.now()}`);
      console.log(`\nCreating org "${orgName}"...`);
      runSQL([
        `INSERT OR REPLACE INTO organizations (id, name, slug, display_name, description, owner_id, created_at, updated_at)`
        + ` VALUES (${esc(newOrgId)}, ${esc(orgName)}, ${esc(orgSlug)}, ${esc(orgName)}, 'Seeded test organization', ${esc(user.id)}, ${now}, ${now});`,
        `INSERT OR REPLACE INTO org_members (org_id, user_id, role, joined_at)`
        + ` VALUES (${esc(newOrgId)}, ${esc(user.id)}, 'owner', ${now});`,
      ].join('\n'));
      targetOrg = { id: newOrgId, name: orgName, slug: orgSlug };
      console.log(`  ✓ Org "${orgName}" created`);
    }

    // Add skill to org
    console.log(`\nSeeding org skill for "${targetOrg.name}"...`);
    const { sql, ownerName, repoSuffix, tpl } = buildSkillSQL(ORG_SKILL_TEMPLATE, targetOrg.slug, null, targetOrg.id);
    runSQL(sql);
    putR2(`skills/${ownerName}/${repoSuffix}/SKILL.md`, buildSkillMD(tpl));
    console.log(`  ✓ Org skill "Org Security Scanner" inserted`);
  }

  console.log('\n=== Seed complete ===\n');
  rl.close();
}

main().catch(err => {
  console.error('Seed failed:', err);
  rl.close();
  process.exit(1);
});