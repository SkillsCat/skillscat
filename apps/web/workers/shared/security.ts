import { githubRequest } from '../../src/lib/server/github-request';
import { buildUploadSkillR2Key, buildUploadSkillR2Prefix } from '../../src/lib/skill-path';
import type { BaseEnv, DirectoryFile } from './types';
import type { D1Database } from '@cloudflare/workers-types';

export interface SecuritySkillRow {
  id: string;
  slug: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
  readme: string | null;
  visibility: string;
  source_type: string;
  stars: number;
  trending_score: number;
  tier: string;
  file_structure: string | null;
  updated_at: number;
}

export interface SecurityStateRow {
  skill_id: string;
  content_fingerprint: string | null;
  dirty: number;
  next_update_at: number | null;
  status: string | null;
  open_security_report_count: number | null;
  report_risk_level: string | null;
  premium_due_reason: string | null;
  premium_requested_fingerprint: string | null;
  premium_last_analyzed_fingerprint: string | null;
  vt_eligibility: string | null;
  vt_priority: number | null;
  vt_status: string | null;
  vt_next_attempt_at: number | null;
  current_total_score: number | null;
  current_risk_level: string | null;
  current_free_scan_id: string | null;
  current_premium_scan_id: string | null;
}

export interface SecurityFileRecord {
  path: string;
  size: number;
  type: 'text' | 'binary';
  sha?: string;
  content?: string;
  bytes?: Uint8Array;
}

interface FileStructurePayload {
  files?: DirectoryFile[];
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\n/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function parseDirectoryFiles(fileStructure: string | null): DirectoryFile[] {
  if (!fileStructure) return [];
  try {
    const parsed = JSON.parse(fileStructure) as FileStructurePayload;
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    return [];
  }
}

function getGithubSkillR2Prefix(skill: Pick<SecuritySkillRow, 'repo_owner' | 'repo_name' | 'skill_path'>): string {
  const pathPart = skill.skill_path ? `/${skill.skill_path}` : '';
  return `skills/${skill.repo_owner}/${skill.repo_name}${pathPart}/`;
}

export function getSkillR2Prefix(skill: Pick<SecuritySkillRow, 'slug' | 'source_type' | 'repo_owner' | 'repo_name' | 'skill_path'>): string {
  if (skill.source_type === 'upload') {
    return buildUploadSkillR2Prefix(skill.slug);
  }
  return getGithubSkillR2Prefix(skill);
}

export async function loadSecuritySkill(
  db: D1Database,
  skillId: string
): Promise<{ skill: SecuritySkillRow | null; state: SecurityStateRow | null }> {
  const row = await db.prepare(`
    SELECT
      s.id,
      s.slug,
      s.repo_owner,
      s.repo_name,
      s.skill_path,
      s.readme,
      s.visibility,
      s.source_type,
      s.stars,
      s.trending_score,
      s.tier,
      s.file_structure,
      s.updated_at,
      ss.skill_id,
      ss.content_fingerprint,
      ss.dirty,
      ss.next_update_at,
      ss.status,
      ss.open_security_report_count,
      ss.report_risk_level,
      ss.premium_due_reason,
      ss.premium_requested_fingerprint,
      ss.premium_last_analyzed_fingerprint,
      ss.vt_eligibility,
      ss.vt_priority,
      ss.vt_status,
      ss.vt_next_attempt_at,
      ss.current_total_score,
      ss.current_risk_level,
      ss.current_free_scan_id,
      ss.current_premium_scan_id
    FROM skills s
    LEFT JOIN skill_security_state ss ON ss.skill_id = s.id
    WHERE s.id = ?
    LIMIT 1
  `)
    .bind(skillId)
    .first<SecuritySkillRow & SecurityStateRow>();

  if (!row) {
    return { skill: null, state: null };
  }

  const skill: SecuritySkillRow = {
    id: row.id,
    slug: row.slug,
    repo_owner: row.repo_owner,
    repo_name: row.repo_name,
    skill_path: row.skill_path,
    readme: row.readme,
    visibility: row.visibility,
    source_type: row.source_type,
    stars: row.stars,
    trending_score: row.trending_score,
    tier: row.tier,
    file_structure: row.file_structure,
    updated_at: row.updated_at,
  };

  const state = row.skill_id ? {
    skill_id: row.skill_id,
    content_fingerprint: row.content_fingerprint,
    dirty: row.dirty,
    next_update_at: row.next_update_at,
    status: row.status,
    open_security_report_count: row.open_security_report_count,
    report_risk_level: row.report_risk_level,
    premium_due_reason: row.premium_due_reason,
    premium_requested_fingerprint: row.premium_requested_fingerprint,
    premium_last_analyzed_fingerprint: row.premium_last_analyzed_fingerprint,
    vt_eligibility: row.vt_eligibility,
    vt_priority: row.vt_priority,
    vt_status: row.vt_status,
    vt_next_attempt_at: row.vt_next_attempt_at,
    current_total_score: row.current_total_score,
    current_risk_level: row.current_risk_level,
    current_free_scan_id: row.current_free_scan_id,
    current_premium_scan_id: row.current_premium_scan_id,
  } satisfies SecurityStateRow : null;

  return { skill, state };
}

export async function loadSkillTextFilesFromR2(
  skill: SecuritySkillRow,
  env: Pick<BaseEnv, 'R2'>
): Promise<SecurityFileRecord[]> {
  const directoryFiles = parseDirectoryFiles(skill.file_structure);
  const prefix = getSkillR2Prefix(skill);
  const textFiles = directoryFiles.filter((file) => file.type === 'text');
  const loaded: SecurityFileRecord[] = [];

  for (const file of textFiles) {
    const object = await env.R2.get(`${prefix}${file.path}`);
    if (!object) continue;
    loaded.push({
      path: file.path,
      size: file.size,
      type: file.type,
      sha: file.sha,
      content: await object.text(),
    });
  }

  if (loaded.length === 0 && skill.source_type === 'upload') {
    const object = await env.R2.get(buildUploadSkillR2Key(skill.slug, 'SKILL.md'));
    if (object) {
      const content = await object.text();
      loaded.push({
        path: 'SKILL.md',
        size: content.length,
        type: 'text',
        content,
      });
    }
  }

  if (loaded.length === 0 && skill.readme) {
    loaded.push({
      path: 'SKILL.md',
      size: skill.readme.length,
      type: 'text',
      content: skill.readme,
    });
  }

  return loaded;
}

export function getSkillDirectoryFiles(skill: SecuritySkillRow): DirectoryFile[] {
  const parsed = parseDirectoryFiles(skill.file_structure);
  if (parsed.length > 0) return parsed;

  if (skill.readme) {
    return [{
      path: 'SKILL.md',
      size: skill.readme.length,
      sha: '',
      type: 'text',
    }];
  }

  return [];
}

export async function fetchGitHubBlobBytes(
  owner: string,
  repo: string,
  sha: string,
  env: Pick<BaseEnv, 'GITHUB_TOKEN'>
): Promise<Uint8Array | null> {
  const response = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`, {
    token: env.GITHUB_TOKEN,
    userAgent: 'SkillsCat-Security-Worker/1.0',
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { content?: string; encoding?: string };
  if (data.encoding !== 'base64' || !data.content) {
    return null;
  }

  return decodeBase64ToBytes(data.content);
}

export async function buildSkillBundleFiles(
  skill: SecuritySkillRow,
  env: Pick<BaseEnv, 'R2' | 'GITHUB_TOKEN'>
): Promise<SecurityFileRecord[]> {
  const directoryFiles = getSkillDirectoryFiles(skill);
  if (directoryFiles.length === 0) {
    return [];
  }

  const prefix = getSkillR2Prefix(skill);
  const bundleFiles: SecurityFileRecord[] = [];

  for (const file of directoryFiles) {
    if (file.type === 'text') {
      const object = await env.R2.get(`${prefix}${file.path}`);
      if (object) {
        const bytes = new Uint8Array(await object.arrayBuffer());
        bundleFiles.push({
          path: file.path,
          size: file.size,
          type: file.type,
          sha: file.sha,
          bytes,
        });
        continue;
      }

      if (skill.source_type === 'upload' && file.path === 'SKILL.md' && skill.readme) {
        const bytes = new TextEncoder().encode(skill.readme);
        bundleFiles.push({
          path: file.path,
          size: bytes.byteLength,
          type: file.type,
          bytes,
        });
        continue;
      }
    }

    if (skill.source_type === 'github' && skill.repo_owner && skill.repo_name && file.sha) {
      const bytes = await fetchGitHubBlobBytes(skill.repo_owner, skill.repo_name, file.sha, env);
      if (!bytes) continue;
      bundleFiles.push({
        path: file.path,
        size: bytes.byteLength,
        type: file.type,
        sha: file.sha,
        bytes,
      });
    }
  }

  return bundleFiles;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoredZip(files: Array<Pick<SecurityFileRecord, 'path' | 'bytes'>>): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = files
    .filter((file): file is Pick<SecurityFileRecord, 'path' | 'bytes'> & { bytes: Uint8Array } => Boolean(file.bytes))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      ...file,
      nameBytes: encoder.encode(file.path),
      crc: crc32(file.bytes!),
    }));

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of prepared) {
    const localHeader = new Uint8Array(30 + file.nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, file.crc, true);
    localView.setUint32(18, file.bytes.byteLength, true);
    localView.setUint32(22, file.bytes.byteLength, true);
    localView.setUint16(26, file.nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(file.nameBytes, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + file.nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, file.crc, true);
    centralView.setUint32(20, file.bytes.byteLength, true);
    centralView.setUint32(24, file.bytes.byteLength, true);
    centralView.setUint16(28, file.nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(file.nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const localSize = localParts.reduce((sum, part) => sum + part.byteLength, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, prepared.length, true);
  endView.setUint16(10, prepared.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localSize, true);
  endView.setUint16(20, 0, true);

  const totalSize = localSize + centralSize + endRecord.byteLength;
  const zip = new Uint8Array(totalSize);
  let pointer = 0;
  for (const part of localParts) {
    zip.set(part, pointer);
    pointer += part.byteLength;
  }
  for (const part of centralParts) {
    zip.set(part, pointer);
    pointer += part.byteLength;
  }
  zip.set(endRecord, pointer);

  return zip;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}
