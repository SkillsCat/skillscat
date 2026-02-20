import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';
import { buildUploadSkillR2Key, normalizeSkillSlug, parseSkillSlug } from '$lib/skill-path';

interface SkillInfo {
  id: string;
  name: string;
  slug: string;
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
  readme: string | null;
  visibility: string;
}

/**
 * Build possible R2 paths for a skill's SKILL.md file.
 */
function buildR2Paths(skill: SkillInfo): string[] {
  if (skill.source_type === 'upload') {
    const canonical = buildUploadSkillR2Key(skill.slug, 'SKILL.md');
    const parts = parseSkillSlug(skill.slug);
    const paths = new Set<string>();

    if (canonical) {
      paths.add(canonical);
    }

    if (parts) {
      // Legacy fallback for previously stored upload paths.
      paths.add(`skills/${parts.owner}/${parts.name.split('/')[0]}/SKILL.md`);
    }

    return [...paths];
  }
  const pathPart = skill.skill_path ? `/${skill.skill_path}` : '';
  return [`skills/${skill.repo_owner}/${skill.repo_name}${pathPart}/SKILL.md`];
}

/**
 * GET /api/skills/[slug]/download - Download skill as a zip file
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  if (!db || !r2) {
    throw error(503, 'Storage not available');
  }

  const slug = normalizeSkillSlug(params.slug || '');
  if (!slug) {
    throw error(400, 'Invalid skill slug');
  }

  // Fetch skill info
  const skill = await db.prepare(`
    SELECT id, name, slug, source_type, repo_owner, repo_name, skill_path, readme, visibility
    FROM skills WHERE slug = ?
  `)
    .bind(slug)
    .first<SkillInfo>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  if (skill.visibility === 'private') {
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId) {
      throw error(401, 'Authentication required');
    }
    requireScope(auth, 'read');
    const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
    if (!hasAccess) {
      throw error(403, 'You do not have permission to access this skill');
    }
  }

  // Try to get SKILL.md content from R2
  let skillContent: string | null = null;
  try {
    for (const r2Path of buildR2Paths(skill)) {
      const r2Object = await r2.get(r2Path);
      if (r2Object) {
        skillContent = await r2Object.text();
        break;
      }
    }
  } catch {
    // Fall back to readme if R2 fetch fails
  }

  // Use readme as fallback
  if (!skillContent && skill.readme) {
    skillContent = skill.readme;
  }

  if (!skillContent) {
    throw error(404, 'Skill content not available');
  }

  // Create a simple zip file structure
  // Using a minimal zip implementation for single file
  const fileName = 'SKILL.md';
  const fileContent = new TextEncoder().encode(skillContent);
  const zipBuffer = createZip(fileName, fileContent);

  // Generate download filename
  const downloadName = skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();

  // Track download in D1 to avoid high-cost KV write amplification.
  try {
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, NULL, ?, 'download', ?)
    `)
      .bind(crypto.randomUUID(), skill.id, Date.now())
      .run();
  } catch { /* non-critical */ }

  return new Response(zipBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${downloadName}.zip"`,
      'Cache-Control': skill.visibility === 'private' ? 'private, no-cache' : 'public, max-age=3600',
    },
  });
};

/**
 * Create a minimal ZIP file containing a single file
 */
function createZip(fileName: string, content: Uint8Array): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(fileName);
  const crc = crc32(content);
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  // Local file header
  const localHeader = new Uint8Array(30 + fileNameBytes.length);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true); // Local file header signature
  localView.setUint16(4, 20, true); // Version needed to extract
  localView.setUint16(6, 0, true); // General purpose bit flag
  localView.setUint16(8, 0, true); // Compression method (stored)
  localView.setUint16(10, dosTime, true); // Last mod file time
  localView.setUint16(12, dosDate, true); // Last mod file date
  localView.setUint32(14, crc, true); // CRC-32
  localView.setUint32(18, content.length, true); // Compressed size
  localView.setUint32(22, content.length, true); // Uncompressed size
  localView.setUint16(26, fileNameBytes.length, true); // File name length
  localView.setUint16(28, 0, true); // Extra field length
  localHeader.set(fileNameBytes, 30);

  // Central directory header
  const centralHeader = new Uint8Array(46 + fileNameBytes.length);
  const centralView = new DataView(centralHeader.buffer);
  centralView.setUint32(0, 0x02014b50, true); // Central directory signature
  centralView.setUint16(4, 20, true); // Version made by
  centralView.setUint16(6, 20, true); // Version needed to extract
  centralView.setUint16(8, 0, true); // General purpose bit flag
  centralView.setUint16(10, 0, true); // Compression method
  centralView.setUint16(12, dosTime, true); // Last mod file time
  centralView.setUint16(14, dosDate, true); // Last mod file date
  centralView.setUint32(16, crc, true); // CRC-32
  centralView.setUint32(20, content.length, true); // Compressed size
  centralView.setUint32(24, content.length, true); // Uncompressed size
  centralView.setUint16(28, fileNameBytes.length, true); // File name length
  centralView.setUint16(30, 0, true); // Extra field length
  centralView.setUint16(32, 0, true); // File comment length
  centralView.setUint16(34, 0, true); // Disk number start
  centralView.setUint16(36, 0, true); // Internal file attributes
  centralView.setUint32(38, 0, true); // External file attributes
  centralView.setUint32(42, 0, true); // Relative offset of local header
  centralHeader.set(fileNameBytes, 46);

  // End of central directory record
  const centralDirOffset = localHeader.length + content.length;
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true); // End of central directory signature
  endView.setUint16(4, 0, true); // Number of this disk
  endView.setUint16(6, 0, true); // Disk where central directory starts
  endView.setUint16(8, 1, true); // Number of central directory records on this disk
  endView.setUint16(10, 1, true); // Total number of central directory records
  endView.setUint32(12, centralHeader.length, true); // Size of central directory
  endView.setUint32(16, centralDirOffset, true); // Offset of start of central directory
  endView.setUint16(20, 0, true); // Comment length

  // Combine all parts
  const totalLength = localHeader.length + content.length + centralHeader.length + endRecord.length;
  const zip = new Uint8Array(totalLength);
  let offset = 0;
  zip.set(localHeader, offset); offset += localHeader.length;
  zip.set(content, offset); offset += content.length;
  zip.set(centralHeader, offset); offset += centralHeader.length;
  zip.set(endRecord, offset);

  return zip;
}

/**
 * Calculate CRC-32 checksum
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = getCrc32Table();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let crc32Table: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc32Table[i] = c;
  }
  return crc32Table;
}
