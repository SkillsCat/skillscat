import type { BaseEnv } from '../types';
import {
  fetchGitHubBlobBytes,
  getSkillDirectoryFiles,
  getSkillR2Keys,
  type SecurityFileRecord,
  type SecuritySkillRow,
} from './skill';

export async function buildSkillBundleFiles(
  skill: SecuritySkillRow,
  env: Pick<BaseEnv, 'R2' | 'GITHUB_TOKEN'>
): Promise<SecurityFileRecord[]> {
  const directoryFiles = getSkillDirectoryFiles(skill);
  if (directoryFiles.length === 0) {
    return [];
  }

  const bundleFiles: SecurityFileRecord[] = [];

  for (const file of directoryFiles) {
    if (file.type === 'text') {
      let object: R2ObjectBody | null = null;
      for (const key of getSkillR2Keys(skill, file.path)) {
        object = await env.R2.get(key);
        if (object) break;
      }
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
      crc: crc32(file.bytes),
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
