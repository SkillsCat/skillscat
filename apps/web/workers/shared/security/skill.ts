import type { D1Database } from '@cloudflare/workers-types';
import { buildUploadSkillR2Key, buildUploadSkillR2Prefix } from '../../../src/lib/skill-path';
import { githubRequest } from '../../../src/lib/server/github-client/request';
import type { BaseEnv, DirectoryFile } from '../types';

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
