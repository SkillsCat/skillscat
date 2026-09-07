#!/usr/bin/env node
/** Bounded, read-only by default bootstrap of discovery candidates. Node >=22. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessSkillQuality, QUALITY_MAX_CONTENT_CHARS, qualityFilePaths, type SkillQualityAssessment } from '../apps/web/src/lib/server/skill/quality.ts';
import { buildGithubSkillR2Keys, buildUploadSkillR2Key } from '../apps/web/src/lib/skill-path.ts';
import { firstPublishedSql } from '../apps/web/src/lib/server/seo/freshness.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help') || !args.includes('--remote')) {
  console.log('Usage: node scripts/quality-review.ts --remote [--apply] [--limit=100] [--env=production] [--output=tmp/quality-review]\nRequires the quality migration. Audits at most 200 recent/trending candidates using stored content only; no AI or GitHub. Default: export review.json/apply.sql/restore.sql, no writes.');
  process.exit(args.includes('--help') ? 0 : 1);
}
for (const arg of args) {
  if (!/^(?:--remote|--apply|--limit=\d+|--env=[\w-]+|--output=.+)$/.test(arg)) throw new Error(`Unknown argument: ${arg}`);
}
const option = (name: string, fallback: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const limit = Number(option('limit', '100'));
if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be 1..200');
const envName = option('env', 'production');
const output = resolve(root, option('output', 'tmp/quality-review'));
if (existsSync(resolve(output, 'review.json'))) throw new Error('Choose a new output directory to preserve the previous audit');
const wranglerArgs = ['d1', 'execute', 'skillscat-db', '-c', 'wrangler.preview.toml', '--env', envName, '--remote'];
function query(sql: string): Record<string, unknown>[] {
  const raw = execFileSync(resolve(root, 'apps/web/node_modules/.bin/wrangler'), [...wranglerArgs, '--command', sql, '--json'], {
    cwd: resolve(root, 'apps/web'), encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as Array<{ success: boolean; results: Record<string, unknown>[]; meta: unknown }>;
  if (!parsed.every((entry) => entry.success)) throw new Error('D1 query failed');
  console.log('D1 metadata:', JSON.stringify(parsed.map((entry) => entry.meta)));
  return parsed.flatMap((entry) => entry.results);
}
// Bound the index scans before reading any large columns; never search the
// whole corpus for "pending" after the heads have been assessed.
const rows = query(`WITH recent AS MATERIALIZED (
  SELECT id FROM skills INDEXED BY skills_public_first_published_idx
  WHERE visibility = 'public' ORDER BY (${firstPublishedSql()}) DESC, id LIMIT ${limit}
), ranked AS MATERIALIZED (
  SELECT id FROM skills INDEXED BY skills_public_trending_id_idx
  WHERE visibility = 'public' ORDER BY trending_score DESC, id LIMIT ${limit}
), candidates AS (SELECT id FROM recent UNION SELECT id FROM ranked)
SELECT s.id, s.slug, s.repo_owner, s.repo_name, s.skill_path, s.source_type,
  s.content_hash, s.commit_sha, s.quality_status, s.quality_reason, s.quality_version, s.quality_next_review_at,
  SUBSTR(s.readme, 1, ${QUALITY_MAX_CONTENT_CHARS + 1}) AS readme, s.file_structure
FROM candidates c JOIN skills s ON s.id = c.id WHERE s.quality_status = 'pending'
  AND s.quality_next_review_at <= ${Date.now()}
ORDER BY s.trending_score DESC, s.id LIMIT ${limit}`);
const config = readFileSync(resolve(root, 'apps/web/wrangler.preview.toml'), 'utf8');
const account = config.match(/^account_id\s*=\s*"([a-f0-9]+)"/m)?.[1];
const bucket = config.match(/^bucket_name\s*=\s*"([\w-]+)"/m)?.[1];
if (!account || !bucket) throw new Error('Missing Cloudflare account or R2 bucket');
let token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  const paths = [resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), resolve(homedir(), '.config/.wrangler/config/default.toml'), resolve(homedir(), '.wrangler/config/default.toml')];
  const path = paths.find(existsSync);
  token = path ? readFileSync(path, 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1] : undefined;
}
if (!token && rows.some((row) => row.readme === null)) throw new Error('Wrangler login or CLOUDFLARE_API_TOKEN is required for R2 reads');
const quote = (value: unknown): string => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const review: Array<Record<string, unknown> & { assessment: SkillQualityAssessment }> = [];
let r2Reads = 0;
for (const row of rows) {
  let content = row.readme as string | null;
  if (content === null) {
    const keys = row.source_type === 'upload' ? [buildUploadSkillR2Key(String(row.slug), 'SKILL.md')]
      : buildGithubSkillR2Keys(String(row.repo_owner), String(row.repo_name), row.skill_path as string | null, 'SKILL.md');
    for (const key of keys.filter(Boolean).slice(0, 2)) {
      r2Reads++;
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) { await response.body?.cancel(); continue; }
      if (!response.ok) throw new Error(`R2 read failed: HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > QUALITY_MAX_CONTENT_CHARS) { await response.body?.cancel(); break; }
      // R2 metadata normally supplies size, but still cap streamed bytes.
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > QUALITY_MAX_CONTENT_CHARS) { await reader.cancel(); break; }
        chunks.push(value);
      }
      if (size <= QUALITY_MAX_CONTENT_CHARS) content = Buffer.concat(chunks).toString('utf8');
      break;
    }
  }
  let assessment = assessSkillQuality(content, qualityFilePaths(row.file_structure as string | null));
  if (content !== null && row.content_hash && content.length <= QUALITY_MAX_CONTENT_CHARS) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    if (Buffer.from(digest).toString('hex') !== row.content_hash) assessment = { ...assessment, status: 'pending', reason: 'content_hash_mismatch' };
  }
  review.push({ ...row, readme: undefined, file_structure: undefined, assessment });
}
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'review.json'), JSON.stringify({ at: new Date().toISOString(), r2Reads, rows: review }, null, 2));
const reviewedAt = Date.now();
const changes = review.map((row) => {
  const nextReview = row.assessment.status === 'pending' ? reviewedAt + 86_400_000 : 0;
  const guard = `id = ${quote(row.id)} AND content_hash IS ${quote(row.content_hash)} AND commit_sha IS ${quote(row.commit_sha)}`;
  return {
    apply: `UPDATE skills SET quality_status = ${quote(row.assessment.status)}, quality_reason = ${quote(row.assessment.reason)}, quality_version = ${row.assessment.version}, quality_next_review_at = ${nextReview} WHERE ${guard} AND quality_status = 'pending';`,
    restore: `UPDATE skills SET quality_status = ${quote(row.quality_status)}, quality_reason = ${quote(row.quality_reason)}, quality_version = ${quote(row.quality_version)}, quality_next_review_at = ${quote(row.quality_next_review_at)} WHERE ${guard} AND quality_status = ${quote(row.assessment.status)} AND quality_version = ${row.assessment.version};`,
  };
});
writeFileSync(resolve(output, 'apply.sql'), changes.map((row) => row.apply).join('\n'));
writeFileSync(resolve(output, 'restore.sql'), changes.map((row) => row.restore).join('\n'));
console.log(JSON.stringify({ candidates: review.length, r2Reads, statuses: review.reduce<Record<string, number>>((counts, row) => { counts[row.assessment.status] = (counts[row.assessment.status] ?? 0) + 1; return counts; }, {}), output }));
if (args.includes('--apply') && changes.length) {
  execFileSync(resolve(root, 'apps/web/node_modules/.bin/wrangler'), [...wranglerArgs, '--file', resolve(output, 'apply.sql'), '--yes'], { cwd: resolve(root, 'apps/web'), stdio: 'inherit' });
}
