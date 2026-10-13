import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/lib/zip/crc32';
import { buildStoredZip } from '../workers/shared/security/bundle';

describe('ZIP CRC32', () => {
  it('matches standard vectors, empty content and sliced buffers', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode('x123456789x').subarray(1, 10))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(256).map((_, index) => index))).toBe(0x29058c73);
  });

  it('keeps VirusTotal ZIP entries and checksums readable and deterministic', () => {
    const bytes = new TextEncoder().encode('123456789');
    const files = [{ path: 'b.bin', bytes: new Uint8Array([0, 255, 1]) }, { path: 'SKILL.md', bytes }];
    const zip = buildStoredZip(files);
    expect(zip).toEqual(buildStoredZip([...files].reverse()));
    const single = buildStoredZip([{ path: 'SKILL.md', bytes }]);
    expect(new DataView(single.buffer).getUint32(14, true)).toBe(0xcbf43926);
    const unpacked = unzipSync(zip);
    expect(unpacked['SKILL.md']).toEqual(bytes);
    expect(unpacked['b.bin']).toEqual(files[0].bytes);
  });
});
