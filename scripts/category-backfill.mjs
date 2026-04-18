#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT_DIR, 'apps/web');

const DEFAULTS = {
  dbName: 'skillscat-db',
  configPath: resolve(WEB_DIR, 'wrangler.preview.toml'),
  envName: null,
  local: true,
  dryRun: false,
  scanBatchSize: 200,
  applyBatchSize: 100,
  limit: 0,
  verbose: false,
  categories: [],
};

const CATEGORY_ALIAS_MAP = {
  'a11y': 'accessibility',
  'accounting': 'finance',
  'api-dev': 'api',
  'agent-dev': 'agents',
  'agent-development': 'agents',
  'agent-skill-development': 'agents',
  'blockchain': 'web3-crypto',
  'brand-design': 'design',
  'brand-guidelines': 'design',
  'browser-automation': 'automation',
  'cli-tools': 'cli',
  'code-gen': 'code-generation',
  'commenting': 'comments',
  'creative-design': 'design',
  'crypto': 'web3-crypto',
  'data-visualization': 'analytics',
  'data-viz': 'analytics',
  'design-system': 'design',
  'design-systems': 'design',
  'design-to-code': 'design',
  'docs': 'documentation',
  'docs-gen': 'documentation',
  'financial-analysis': 'finance',
  'financial-modeling': 'finance',
  'financial-reporting': 'finance',
  'frontend-design': 'design',
  'game-design': 'game-dev',
  'gamedev': 'game-dev',
  'git-vcs': 'git',
  'l10n': 'i18n',
  'localization': 'i18n',
  'mobile-first': 'responsive',
  'processing': 'data-processing',
  'product-design': 'design',
  'responsive-design': 'responsive',
  'translation': 'i18n',
  'ui-design': 'design',
  'ui-design-system': 'design',
  'ui-ux': 'design',
  'ux-design': 'design',
  'visual-design': 'design',
  'web-design': 'design',
  'web3': 'web3-crypto',
};

const TARGET_RULES = {
  design: {
    threshold: 2,
    minSignalScore: 1,
    currentCategoryBoost: { 'ui-components': 1, 'code-generation': 1 },
    signals: [
      'ui/ux',
      'ui ux',
      'ux design',
      'ui design',
      'user experience',
      'visual design',
      'frontend design',
      'web design',
      'figma',
      'wireframe',
      'prototype',
      'mockup',
      'typography',
      'brand identity',
      'branding',
      'brand guidelines',
      'style guide',
      'visual hierarchy',
      'visual polish',
      'design system',
      'design token',
      'art direction',
      'interface critique',
      'design critique',
      'design review',
      'frontend ui ux',
    ],
  },
  responsive: {
    threshold: 1,
    signals: [
      'responsive design',
      'responsive',
      'mobile first',
      'breakpoint',
      'breakpoints',
      'media query',
      'viewport',
      'screen size',
      'tablet',
      'fluid layout',
      'cross device',
    ],
  },
  accessibility: {
    threshold: 1,
    signals: [
      'a11y',
      'accessibility',
      'wcag',
      'screen reader',
      'keyboard navigation',
      'focus order',
      'focus trap',
      'color contrast',
      'aria',
      'alt text',
    ],
  },
  comments: {
    threshold: 1,
    signals: [
      'docstring',
      'docstrings',
      'inline comment',
      'inline comments',
      'code comment',
      'code comments',
      'annotation',
      'annotations',
      'annotate',
      'annotated',
    ],
  },
  i18n: {
    threshold: 1,
    signals: [
      'i18n',
      'l10n',
      'localization',
      'localisation',
      'translation',
      'multilingual',
      'locale',
    ],
  },
  templates: {
    threshold: 1,
    signals: [
      'template',
      'templates',
      'starter kit',
      'boilerplate',
      'blueprint',
      'skeleton',
      'scaffold template',
      'project template',
    ],
  },
  finance: {
    threshold: 1,
    signals: [
      'financial analysis',
      'financial model',
      'financial modeling',
      'financial reporting',
      'budget',
      'budgeting',
      'finance',
      'financial',
      'accounting',
      'bookkeeping',
      'valuation',
      'forecast',
      'expense',
    ],
  },
  'web3-crypto': {
    threshold: 1,
    signals: [
      'web3',
      'crypto',
      'cryptocurrency',
      'blockchain',
      'solidity',
      'smart contract',
      'wallet',
      'defi',
      'onchain',
      'ethereum',
      'evm',
      'foundry',
      'hardhat',
      'solana',
    ],
  },
  'game-dev': {
    threshold: 1,
    signals: [
      'game development',
      'gamedev',
      'gameplay',
      'unity',
      'unreal',
      'godot',
      'level design',
      'shader',
      'sprite',
    ],
  },
};

const TARGET_CATEGORY_SET = new Set(Object.keys(TARGET_RULES));
const CANONICAL_CATEGORY_SET = new Set([
  'accessibility',
  'agents',
  'analytics',
  'api',
  'automation',
  'cli',
  'code-generation',
  'comments',
  'data-processing',
  'design',
  'documentation',
  'finance',
  'game-dev',
  'git',
  'i18n',
  'responsive',
  'ui-components',
  'web3-crypto',
]);
const CATEGORY_STATS_TOP_IDS_LIMIT = 96;

function printHelp() {
  console.log(`
Backfill missing or fragmented core categories using non-AI rules.

This script is intentionally conservative:
- folds known dynamic/alias categories back into canonical core categories
- adds core categories only when metadata/tags/current categories show strong signals
- updates category_public_stats and categories.skill_count after changes

Usage:
  node scripts/category-backfill.mjs [options]

Options:
  --db <name>             D1 database name (default: skillscat-db)
  --config <path>         Wrangler config path (default: apps/web/wrangler.preview.toml)
  --env <name>            Wrangler environment name (example: production)
  --local                 Run against local D1 (default)
  --remote                Run against remote D1
  --dry-run               Show summary without writing changes
  --scan-batch <n>        Skills fetched per scan query (default: 200)
  --apply-batch <n>       Skills written per SQL batch (default: 100)
  --limit <n>             Stop after scanning n skills
  --category <slug>       Restrict to one or more target categories (repeatable)
  --verbose               Print per-batch details and sample reasons
  -h, --help              Show this help

Examples:
  node scripts/category-backfill.mjs --dry-run --category design
  node scripts/category-backfill.mjs --remote --category design --category responsive
  node scripts/category-backfill.mjs --remote --apply-batch 50
`.trim());
}

function takeArgValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parsePositiveInt(raw, flagName) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--db':
        options.dbName = takeArgValue(argv, index, arg);
        index += 1;
        break;
      case '--config':
        options.configPath = resolve(process.cwd(), takeArgValue(argv, index, arg));
        index += 1;
        break;
      case '--env':
        options.envName = takeArgValue(argv, index, arg);
        index += 1;
        break;
      case '--local':
        options.local = true;
        break;
      case '--remote':
        options.local = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--scan-batch':
        options.scanBatchSize = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--apply-batch':
        options.applyBatchSize = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--limit':
        options.limit = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--category': {
        const category = takeArgValue(argv, index, arg);
        options.categories.push(category);
        index += 1;
        break;
      }
      case '--verbose':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.categories = Array.from(
    new Set(
      options.categories
        .map((category) => normalizeCategoryHint(category))
        .map((category) => CATEGORY_ALIAS_MAP[category] || category)
        .filter((category) => TARGET_CATEGORY_SET.has(category))
    )
  );

  return options;
}

function parseWranglerJson(output) {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed[0]?.results || [];
    }
  } catch {
    // Ignore parse failures and fall through to an empty result set.
  }

  return [];
}

function runD1(sql, options, asJson = false) {
  const args = [
    'wrangler',
    'd1',
    'execute',
    options.dbName,
    '-c',
    options.configPath,
    options.local ? '--local' : '--remote',
    '--command',
    sql,
  ];

  if (options.envName) {
    args.push('--env', options.envName);
  }

  if (asJson) {
    args.push('--json');
    const output = execFileSync('npx', args, {
      cwd: ROOT_DIR,
      env: process.env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseWranglerJson(output);
  }

  execFileSync('npx', args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: 'inherit',
  });

  return [];
}

function escSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeCategoryHint(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[-*]\s+/, '')
    .replace(/^[\[\(\{'"`]+/, '')
    .replace(/[\]\)\}'"`]+$/, '')
    .replace(/&/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBatchSkillSql(lastRowId, scanLimit) {
  return `
    SELECT
      rowid AS rowid,
      id,
      slug,
      name,
      description
    FROM skills
    WHERE visibility = 'public'
      AND rowid > ${lastRowId}
    ORDER BY rowid
    LIMIT ${scanLimit};
  `;
}

function buildAssociationSql(tableName, idColumn, valueColumn, skillIds) {
  if (skillIds.length === 0) {
    return null;
  }

  const idsSql = skillIds.map((skillId) => escSql(skillId)).join(',');
  return `
    SELECT
      ${idColumn} AS skillId,
      ${valueColumn} AS value
    FROM ${tableName}
    WHERE ${idColumn} IN (${idsSql})
    ORDER BY ${idColumn};
  `;
}

function buildMapFromRows(rows) {
  const result = new Map();

  for (const row of rows || []) {
    if (!result.has(row.skillId)) {
      result.set(row.skillId, []);
    }
    result.get(row.skillId).push(String(row.value));
  }

  return result;
}

function countSignalMatches(text, signals) {
  let score = 0;
  const padded = ` ${text} `;

  for (const signal of signals) {
    const normalizedSignal = normalizeText(signal);
    if (!normalizedSignal) continue;
    if (padded.includes(` ${normalizedSignal} `)) {
      score += 1;
    }
  }

  return score;
}

function canonicalizeCurrentCategories(categories) {
  const result = new Set();
  for (const category of categories) {
    const normalized = normalizeCategoryHint(category);
    if (!normalized) continue;
    result.add(CATEGORY_ALIAS_MAP[normalized] || normalized);
  }
  return result;
}

function analyzeSkill(skill, options) {
  const currentCategories = splitCsv(skill.categoriesCsv).map((category) => normalizeCategoryHint(category));
  const currentCategorySet = new Set(currentCategories);
  const canonicalCategorySet = canonicalizeCurrentCategories(currentCategories);
  const tags = splitCsv(skill.tagsCsv).map((tag) => normalizeText(tag));
  const tagSet = new Set(tags);
  const text = normalizeText([
    skill.slug,
    skill.name,
    skill.description,
    ...currentCategories,
    ...tags,
  ].filter(Boolean).join(' '));

  const addCategories = new Set();
  const removeCategories = new Set();
  const reasons = [];
  const allowedTargets = options.categories.length > 0
    ? options.categories
    : Array.from(TARGET_CATEGORY_SET);
  const allowedTargetSet = new Set(allowedTargets);

  for (const category of currentCategories) {
    const canonical = CATEGORY_ALIAS_MAP[category];
    if (canonical && canonical !== category && allowedTargetSet.has(canonical)) {
      removeCategories.add(category);
      addCategories.add(canonical);
      reasons.push(`alias:${category}->${canonical}`);
    }
  }

  for (const category of allowedTargets) {
    if (canonicalCategorySet.has(category) || addCategories.has(category)) {
      continue;
    }

    const rule = TARGET_RULES[category];
    if (!rule) continue;

    let signalScore = countSignalMatches(text, rule.signals);
    for (const tag of tagSet) {
      if (!tag) continue;
      if (rule.signals.some((signal) => normalizeText(signal) === tag)) {
        signalScore += 1;
      }
    }

    if ((rule.minSignalScore || 0) > signalScore) {
      continue;
    }

    let score = signalScore;

    for (const [hintCategory, boost] of Object.entries(rule.currentCategoryBoost || {})) {
      if (currentCategorySet.has(hintCategory)) {
        score += boost;
      }
    }

    if (score >= rule.threshold) {
      addCategories.add(category);
      reasons.push(`signal:${category}:${score}`);
    }
  }

  if (addCategories.size === 0 && removeCategories.size === 0) {
    return null;
  }

  return {
    skillId: skill.id,
    slug: skill.slug,
    addCategories: Array.from(addCategories),
    removeCategories: Array.from(removeCategories),
    reasons,
  };
}

function buildApplySql(actions, now) {
  const statements = [];

  for (const action of actions) {
    for (const category of action.removeCategories) {
      statements.push(
        `DELETE FROM skill_categories WHERE skill_id = ${escSql(action.skillId)} AND category_slug = ${escSql(category)};`
      );
    }

    for (const category of action.addCategories) {
      statements.push(
        `INSERT OR IGNORE INTO skill_categories (skill_id, category_slug) VALUES (${escSql(action.skillId)}, ${escSql(category)});`
      );
    }

    statements.push(
      `UPDATE skills SET updated_at = ${now} WHERE id = ${escSql(action.skillId)};`
    );
  }

  return statements.join('\n');
}

function readCategoryPublicStatsColumnSupport(options) {
  const rows = runD1('PRAGMA table_info(category_public_stats);', options, true);
  const columns = new Set((rows || []).map((row) => row.name));
  return {
    topSkillIdsJson: columns.has('top_skill_ids_json'),
    topRankedSkillIdsJson: columns.has('top_ranked_skill_ids_json'),
  };
}

function buildCategoryStatsSyncSql(categorySlug, now, columnSupport) {
  const countSql = `
    SELECT COUNT(*)
    FROM skill_categories sc
    JOIN skills s ON s.id = sc.skill_id
    WHERE sc.category_slug = ${escSql(categorySlug)}
      AND s.visibility = 'public'
  `;

  const maxTsSql = `
    SELECT MAX(CASE WHEN s.last_commit_at IS NULL THEN s.updated_at ELSE s.last_commit_at END)
    FROM skill_categories sc
    JOIN skills s ON s.id = sc.skill_id
    WHERE sc.category_slug = ${escSql(categorySlug)}
      AND s.visibility = 'public'
  `;

  const topSkillIdsSql = `
    SELECT COALESCE(json_group_array(skill_id), '[]')
    FROM (
      SELECT sc.skill_id
      FROM skill_categories sc
      JOIN skills s ON s.id = sc.skill_id
      WHERE sc.category_slug = ${escSql(categorySlug)}
        AND s.visibility = 'public'
      ORDER BY s.trending_score DESC
      LIMIT ${CATEGORY_STATS_TOP_IDS_LIMIT}
    )
  `;

  const topRankedSkillIdsSql = `
    SELECT COALESCE(json_group_array(skill_id), '[]')
    FROM (
      SELECT sc.skill_id
      FROM skill_categories sc
      JOIN skills s ON s.id = sc.skill_id
      WHERE sc.category_slug = ${escSql(categorySlug)}
        AND s.visibility = 'public'
      ORDER BY CASE
        WHEN s.classification_method = 'direct' THEN 0
        WHEN s.classification_method = 'ai' THEN 1
        WHEN s.classification_method = 'keyword' THEN 2
        ELSE 3
      END ASC,
      s.trending_score DESC
      LIMIT ${CATEGORY_STATS_TOP_IDS_LIMIT}
    )
  `;

  if (columnSupport.topSkillIdsJson && columnSupport.topRankedSkillIdsJson) {
    return `
      INSERT INTO category_public_stats (
        category_slug,
        public_skill_count,
        top_skill_ids_json,
        top_ranked_skill_ids_json,
        max_freshness_ts,
        updated_at
      )
      VALUES (
        ${escSql(categorySlug)},
        (${countSql}),
        (${topSkillIdsSql}),
        (${topRankedSkillIdsSql}),
        (${maxTsSql}),
        ${now}
      )
      ON CONFLICT(category_slug) DO UPDATE SET
        public_skill_count = excluded.public_skill_count,
        top_skill_ids_json = excluded.top_skill_ids_json,
        top_ranked_skill_ids_json = excluded.top_ranked_skill_ids_json,
        max_freshness_ts = excluded.max_freshness_ts,
        updated_at = excluded.updated_at;

      UPDATE categories
      SET skill_count = (${countSql}),
          updated_at = ${now}
      WHERE slug = ${escSql(categorySlug)};
    `;
  }

  if (columnSupport.topSkillIdsJson) {
    return `
      INSERT INTO category_public_stats (
        category_slug,
        public_skill_count,
        top_skill_ids_json,
        max_freshness_ts,
        updated_at
      )
      VALUES (
        ${escSql(categorySlug)},
        (${countSql}),
        (${topSkillIdsSql}),
        (${maxTsSql}),
        ${now}
      )
      ON CONFLICT(category_slug) DO UPDATE SET
        public_skill_count = excluded.public_skill_count,
        top_skill_ids_json = excluded.top_skill_ids_json,
        max_freshness_ts = excluded.max_freshness_ts,
        updated_at = excluded.updated_at;

      UPDATE categories
      SET skill_count = (${countSql}),
          updated_at = ${now}
      WHERE slug = ${escSql(categorySlug)};
    `;
  }

  if (columnSupport.topRankedSkillIdsJson) {
    return `
      INSERT INTO category_public_stats (
        category_slug,
        public_skill_count,
        top_ranked_skill_ids_json,
        max_freshness_ts,
        updated_at
      )
      VALUES (
        ${escSql(categorySlug)},
        (${countSql}),
        (${topRankedSkillIdsSql}),
        (${maxTsSql}),
        ${now}
      )
      ON CONFLICT(category_slug) DO UPDATE SET
        public_skill_count = excluded.public_skill_count,
        top_ranked_skill_ids_json = excluded.top_ranked_skill_ids_json,
        max_freshness_ts = excluded.max_freshness_ts,
        updated_at = excluded.updated_at;

      UPDATE categories
      SET skill_count = (${countSql}),
          updated_at = ${now}
      WHERE slug = ${escSql(categorySlug)};
    `;
  }

  return `
    INSERT INTO category_public_stats (
      category_slug,
      public_skill_count,
      max_freshness_ts,
      updated_at
    )
    VALUES (
      ${escSql(categorySlug)},
      (${countSql}),
      (${maxTsSql}),
      ${now}
    )
    ON CONFLICT(category_slug) DO UPDATE SET
      public_skill_count = excluded.public_skill_count,
      max_freshness_ts = excluded.max_freshness_ts,
      updated_at = excluded.updated_at;

    UPDATE categories
    SET skill_count = (${countSql}),
        updated_at = ${now}
    WHERE slug = ${escSql(categorySlug)};
  `;
}

function flushPending(actions, affectedCategorySlugs, options) {
  if (actions.length === 0 || options.dryRun) {
    return;
  }

  const now = Date.now();
  runD1(buildApplySql(actions, now), options, false);

  const columnSupport = readCategoryPublicStatsColumnSupport(options);
  const syncSql = Array.from(affectedCategorySlugs)
    .filter((slug) => CANONICAL_CATEGORY_SET.has(slug) || TARGET_CATEGORY_SET.has(slug) || CATEGORY_ALIAS_MAP[slug])
    .map((slug) => buildCategoryStatsSyncSql(slug, now, columnSupport))
    .join('\n');

  if (syncSql.trim()) {
    runD1(syncSql, options, false);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log(
    `[category-backfill] mode=${options.local ? 'local' : 'remote'} dryRun=${options.dryRun} db=${options.dbName}`
  );
  if (options.categories.length > 0) {
    console.log(`[category-backfill] restricted_categories=${options.categories.join(',')}`);
  }

  let lastRowId = 0;
  let scanned = 0;
  let matched = 0;
  let additions = 0;
  let removals = 0;
  const pending = [];
  const pendingAffectedCategorySlugs = new Set();
  const perCategoryAdds = new Map();
  const perCategoryRemovals = new Map();
  const samples = [];

  while (true) {
    if (options.limit > 0 && scanned >= options.limit) {
      break;
    }

    const scanLimit = options.limit > 0
      ? Math.min(options.scanBatchSize, options.limit - scanned)
      : options.scanBatchSize;

    const skills = runD1(buildBatchSkillSql(lastRowId, scanLimit), options, true);
    if (!skills || skills.length === 0) {
      break;
    }

    const skillIds = skills.map((skill) => skill.id);
    const categoryRows = buildAssociationSql('skill_categories', 'skill_id', 'category_slug', skillIds)
      ? runD1(buildAssociationSql('skill_categories', 'skill_id', 'category_slug', skillIds), options, true)
      : [];
    const tagRows = buildAssociationSql('skill_tags', 'skill_id', 'tag', skillIds)
      ? runD1(buildAssociationSql('skill_tags', 'skill_id', 'tag', skillIds), options, true)
      : [];
    const categoriesBySkillId = buildMapFromRows(categoryRows);
    const tagsBySkillId = buildMapFromRows(tagRows);

    for (const skill of skills) {
      scanned += 1;
      lastRowId = Math.max(lastRowId, Number(skill.rowid) || 0);
      const analyzed = analyzeSkill({
        ...skill,
        categoriesCsv: (categoriesBySkillId.get(skill.id) || []).join(','),
        tagsCsv: (tagsBySkillId.get(skill.id) || []).join(','),
      }, options);

      if (!analyzed) {
        continue;
      }

      matched += 1;
      additions += analyzed.addCategories.length;
      removals += analyzed.removeCategories.length;

      for (const category of analyzed.addCategories) {
        pendingAffectedCategorySlugs.add(category);
        perCategoryAdds.set(category, (perCategoryAdds.get(category) || 0) + 1);
      }

      for (const category of analyzed.removeCategories) {
        pendingAffectedCategorySlugs.add(category);
        const canonical = CATEGORY_ALIAS_MAP[category];
        if (canonical) pendingAffectedCategorySlugs.add(canonical);
        perCategoryRemovals.set(category, (perCategoryRemovals.get(category) || 0) + 1);
      }

      pending.push(analyzed);

      if (samples.length < 25) {
        samples.push({
          slug: analyzed.slug,
          add: analyzed.addCategories,
          remove: analyzed.removeCategories,
          reasons: analyzed.reasons,
        });
      }

      if (pending.length >= options.applyBatchSize) {
        flushPending(pending, pendingAffectedCategorySlugs, options);
        if (options.verbose) {
          console.log(`[category-backfill] applied batch: ${pending.length}`);
        }
        pending.length = 0;
        pendingAffectedCategorySlugs.clear();
      }
    }
  }

  flushPending(pending, pendingAffectedCategorySlugs, options);

  console.log(`[category-backfill] scanned=${scanned}`);
  console.log(`[category-backfill] matched=${matched}`);
  console.log(`[category-backfill] additions=${additions}`);
  console.log(`[category-backfill] removals=${removals}`);

  if (perCategoryAdds.size > 0) {
    console.log('[category-backfill] additions by category:');
    for (const [category, count] of Array.from(perCategoryAdds.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  - ${category}: ${count}`);
    }
  }

  if (perCategoryRemovals.size > 0) {
    console.log('[category-backfill] removals by category:');
    for (const [category, count] of Array.from(perCategoryRemovals.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  - ${category}: ${count}`);
    }
  }

  if (samples.length > 0) {
    console.log('[category-backfill] sample actions:');
    for (const sample of samples) {
      const add = sample.add.length > 0 ? ` add=${sample.add.join('|')}` : '';
      const remove = sample.remove.length > 0 ? ` remove=${sample.remove.join('|')}` : '';
      const reasons = sample.reasons.length > 0 ? ` reasons=${sample.reasons.join('|')}` : '';
      console.log(`  - ${sample.slug}${add}${remove}${reasons}`);
    }
  }

  console.log(options.dryRun ? 'Dry run complete.' : 'Category backfill complete.');
}

main().catch((error) => {
  console.error('[category-backfill] failed:', error);
  process.exitCode = 1;
});
