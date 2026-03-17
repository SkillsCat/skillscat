import type { SkillFile } from '$lib/server/skill/files';
import { buildSkillSlug, normalizeSkillSlug, parseSkillSlug } from '$lib/skill-path';

const CLAWHUB_SLUG_SEPARATOR = '~';

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeCompatSegment(value: string): string {
  return encodeURIComponent(value).replace(/~/g, '%7E');
}

export function encodeClawHubCompatSlug(slug: string): string {
  const parsed = parseSkillSlug(slug);
  if (!parsed) return '';
  return [parsed.owner, ...parsed.name.split('/')]
    .map(encodeCompatSegment)
    .join(CLAWHUB_SLUG_SEPARATOR);
}

export function decodeClawHubCompatSlug(raw: string): string {
  const normalizedRaw = String(raw ?? '').trim();
  if (!normalizedRaw) return '';

  const direct = normalizeSkillSlug(safeDecodeURIComponent(normalizedRaw));
  if (direct) return direct;

  const segments = normalizedRaw
    .split(CLAWHUB_SLUG_SEPARATOR)
    .map((segment) => safeDecodeURIComponent(segment).trim())
    .filter(Boolean);

  if (segments.length < 2) return '';

  return buildSkillSlug(segments[0], segments.slice(1).join('/'));
}

export function buildClawHubCompatVersion(updatedAt: number | null | undefined): string {
  const timestamp = Number(updatedAt ?? 0);
  const safeTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp / 1000) : 0;
  return `0.0.${safeTimestamp}`;
}

export function buildClawHubCompatScore(index: number, total: number): number {
  const size = Math.max(total, 1);
  return Number(Math.max(0.001, 1 - index / (size + 1)).toFixed(3));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes.slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildClawHubCompatFingerprint(files: SkillFile[]): Promise<string> {
  const hashed = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      sha256: await sha256Hex(new TextEncoder().encode(file.content)),
    }))
  );

  const payload = hashed
    .filter((file) => Boolean(file.path) && Boolean(file.sha256))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}:${file.sha256}`)
    .join('\n');

  return sha256Hex(new TextEncoder().encode(payload));
}

function getZipTimestamp(modifiedAt: Date | number | undefined): Date {
  const timestamp =
    modifiedAt instanceof Date
      ? modifiedAt.getTime()
      : typeof modifiedAt === 'number'
        ? modifiedAt
        : Date.now();
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1980) {
    return new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
  }

  return date;
}

export function createStoredZip(
  files: Array<{ path: string; content: string }>,
  options?: { modifiedAt?: Date | number }
): Uint8Array {
  const normalizedEntries = files
    .map((file) => ({
      path: file.path.replace(/^\/+/, ''),
      content: new TextEncoder().encode(file.content),
    }))
    .filter((file) => Boolean(file.path) && !file.path.includes('..') && !file.path.includes('\\'));

  const zipTimestamp = getZipTimestamp(options?.modifiedAt);
  const dosTime =
    ((zipTimestamp.getUTCHours() << 11) |
      (zipTimestamp.getUTCMinutes() << 5) |
      (zipTimestamp.getUTCSeconds() >> 1)) &
    0xffff;
  const dosDate =
    (((zipTimestamp.getUTCFullYear() - 1980) << 9) |
      ((zipTimestamp.getUTCMonth() + 1) << 5) |
      zipTimestamp.getUTCDate()) &
    0xffff;

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of normalizedEntries) {
    const fileNameBytes = new TextEncoder().encode(entry.path);
    const crc = crc32(entry.content);

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.content.length, true);
    localView.setUint32(22, entry.content.length, true);
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
    centralView.setUint32(20, entry.content.length, true);
    centralView.setUint32(24, entry.content.length, true);
    centralView.setUint16(28, fileNameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(fileNameBytes, 46);

    localParts.push(localHeader, entry.content);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.content.length;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, normalizedEntries.length, true);
  endView.setUint16(10, normalizedEntries.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const totalLength =
    localParts.reduce((sum, part) => sum + part.length, 0) + centralDirectorySize + endRecord.length;
  const zip = new Uint8Array(totalLength);
  let writeOffset = 0;

  for (const part of [...localParts, ...centralParts, endRecord]) {
    zip.set(part, writeOffset);
    writeOffset += part.length;
  }

  return zip;
}

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;

  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc32Table[i] = c;
  }

  return crc32Table;
}

function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}
