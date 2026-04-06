import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedBinary } from '$lib/server/cache';
import { getPublicSkillDownloadCacheKey } from '$lib/server/cache/keys';
import { resolveSkillSourceInfo, type SkillSourceInfo } from '$lib/server/skill/source';
import {
  buildSkillMetricMessage,
  enqueueSkillMetric,
} from '$lib/server/skill/metrics';
import {
  buildGithubSkillR2Keys,
  buildUploadSkillR2Key,
  normalizeSkillSlug,
  parseSkillSlug,
} from '$lib/skill-path';

const PUBLIC_DOWNLOAD_CACHE_TTL_SECONDS = 3600;

/**
 * Build possible R2 paths for a skill's SKILL.md file.
 */
function buildR2Paths(skill: SkillSourceInfo): string[] {
  if (skill.source_type === 'upload') {
    const canonical = buildUploadSkillR2Key(skill.slug, 'SKILL.md');
    const parts = parseSkillSlug(skill.slug);
    const paths = new Set<string>();

    if (canonical) {
      paths.add(canonical);
    }

    if (parts) {
      paths.add(`skills/${parts.owner}/${parts.name.split('/')[0]}/SKILL.md`);
    }

    return [...paths];
  }

  if (!skill.repo_owner || !skill.repo_name) {
    return [];
  }

  return buildGithubSkillR2Keys(skill.repo_owner, skill.repo_name, skill.skill_path, 'SKILL.md');
}

async function buildDownloadArchive(skill: SkillSourceInfo, r2: R2Bucket): Promise<Uint8Array> {
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
    // Fall back to readme below
  }

  if (!skillContent && skill.readme) {
    skillContent = skill.readme;
  }

  if (!skillContent) {
    throw error(404, 'Skill content not available');
  }

  return createZip('SKILL.md', new TextEncoder().encode(skillContent));
}

async function recordDownloadFallback(
  db: D1Database | undefined,
  skillId: string,
  occurredAt: number
): Promise<void> {
  if (!db) {
    return;
  }

  await db.prepare(`
    INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
    VALUES (?, NULL, ?, 'download', ?)
  `)
    .bind(crypto.randomUUID(), skillId, occurredAt)
    .run()
    .catch(() => {
      // non-critical telemetry
    });
}

/**
 * GET /api/skills/[slug]/download - Download skill as a zip file
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  if (!r2) {
    throw error(503, 'Storage not available');
  }

  const slug = normalizeSkillSlug(params.slug || '');
  if (!slug) {
    throw error(400, 'Invalid skill slug');
  }

  const resolved = await resolveSkillSourceInfo(
    {
      db: platform?.env?.DB,
      request,
      locals,
      waitUntil,
    },
    slug
  );

  if (!resolved.skill) {
    throw error(resolved.status, resolved.error || 'Skill not found');
  }
  const skill = resolved.skill;

  let zipBuffer: Uint8Array;
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';

  if (skill.visibility === 'public') {
    const cached = await getCachedBinary(
      getPublicSkillDownloadCacheKey(slug, skill.updated_at),
      () => buildDownloadArchive(skill as SkillSourceInfo, r2),
      PUBLIC_DOWNLOAD_CACHE_TTL_SECONDS,
      {
        waitUntil,
        contentType: 'application/zip',
      }
    );
    zipBuffer = cached.data;
    cacheStatus = cached.hit ? 'HIT' : 'MISS';
  } else {
    zipBuffer = await buildDownloadArchive(skill, r2);
  }

  const downloadName = skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  const occurredAt = Date.now();
  const queueEnqueued = enqueueSkillMetric(
    platform?.env?.METRICS_QUEUE,
    buildSkillMetricMessage('download', skill.id, { occurredAt }),
    {
      waitUntil,
      onError: () => recordDownloadFallback(platform?.env?.DB, skill.id, occurredAt),
    }
  );

  if (!queueEnqueued) {
    const fallbackPromise = recordDownloadFallback(platform?.env?.DB, skill.id, occurredAt);
    if (waitUntil) {
      waitUntil(fallbackPromise);
    } else {
      void fallbackPromise;
    }
  }

  return new Response(zipBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${downloadName}.zip"`,
      'Cache-Control': skill.visibility === 'public'
        ? `public, max-age=${PUBLIC_DOWNLOAD_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`
        : resolved.cacheControl,
      'X-Cache': skill.visibility === 'public' ? cacheStatus : resolved.cacheStatus,
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

  const localHeader = new Uint8Array(30 + fileNameBytes.length);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0, true);
  localView.setUint16(8, 0, true);
  localView.setUint16(10, dosTime, true);
  localView.setUint16(12, dosDate, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, content.length, true);
  localView.setUint32(22, content.length, true);
  localView.setUint16(26, fileNameBytes.length, true);
  localView.setUint16(28, 0, true);
  localHeader.set(fileNameBytes, 30);

  const centralHeader = new Uint8Array(46 + fileNameBytes.length);
  const centralView = new DataView(centralHeader.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint16(12, dosTime, true);
  centralView.setUint16(14, dosDate, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, content.length, true);
  centralView.setUint32(24, content.length, true);
  centralView.setUint16(28, fileNameBytes.length, true);
  centralView.setUint16(30, 0, true);
  centralView.setUint16(32, 0, true);
  centralView.setUint16(34, 0, true);
  centralView.setUint16(36, 0, true);
  centralView.setUint32(38, 0, true);
  centralView.setUint32(42, 0, true);
  centralHeader.set(fileNameBytes, 46);

  const centralDirOffset = localHeader.length + content.length;
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, centralHeader.length, true);
  endView.setUint32(16, centralDirOffset, true);
  endView.setUint16(20, 0, true);

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
    crc32Table[i] = c >>> 0;
  }

  return crc32Table;
}
