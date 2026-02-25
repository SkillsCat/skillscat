import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = [
  'apps/web/src',
  'apps/web/workers',
];

const ALLOWED_PREFIXES = [
  path.join('apps', 'web', 'src', 'lib', 'server', 'github-client') + path.sep,
  path.join('apps', 'web', 'src', 'lib', 'server', 'github-request.ts'),
];

const FILE_EXTENSIONS = new Set(['.ts', '.js', '.mts', '.cts']);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
      continue;
    }
    if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function isAllowed(relPath) {
  return ALLOWED_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(prefix));
}

function checkFile(relPath, content) {
  const failures = [];

  // Guard 1: raw fetch to GitHub endpoints bypasses unified transport.
  if (/fetch\s*\([\s\S]*https:\/\/api\.github\.com/i.test(content)) {
    failures.push('Raw fetch() to GitHub API is not allowed; use github-client/gateway helpers.');
  }

  // Guard 2: direct GraphQL URL through githubRequest/githubFetch should go through github-client/graphql.ts.
  if (/github(Request|Fetch)\s*\([\s\S]*https:\/\/api\.github\.com\/graphql/i.test(content)) {
    failures.push('Direct GitHub GraphQL calls are not allowed; use github-client/graphql.ts or github-client/queries.ts.');
  }

  return failures;
}

const allFiles = [];
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  try {
    allFiles.push(...await walk(abs));
  } catch {
    // Ignore missing directories
  }
}

const violations = [];
for (const absPath of allFiles) {
  const relPath = path.relative(ROOT, absPath);
  if (isAllowed(relPath)) continue;
  const content = await fs.readFile(absPath, 'utf8');
  const failures = checkFile(relPath, content);
  for (const failure of failures) {
    violations.push(`${relPath}: ${failure}`);
  }
}

if (violations.length > 0) {
  console.error('GitHub transport policy violations found:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('GitHub transport policy check passed.');
