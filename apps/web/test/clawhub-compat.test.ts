import { describe, expect, it } from 'vitest';
import {
  buildClawHubCompatFingerprint,
  buildClawHubCompatVersion,
  createStoredZip,
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '../src/lib/server/clawhub-compat';

describe('clawhub compatibility helpers', () => {
  it('encodes and decodes flat skill slugs', () => {
    const compatSlug = encodeClawHubCompatSlug('backrunner/skillscat');
    expect(compatSlug).toBe('backrunner~skillscat');
    expect(decodeClawHubCompatSlug(compatSlug)).toBe('backrunner/skillscat');
  });

  it('encodes and decodes nested skill paths', () => {
    const compatSlug = encodeClawHubCompatSlug('backrunner/tools/openclaw/setup');
    expect(compatSlug).toBe('backrunner~tools~openclaw~setup');
    expect(decodeClawHubCompatSlug(compatSlug)).toBe('backrunner/tools/openclaw/setup');
  });

  it('builds stable fingerprints independent of file order', async () => {
    const filesA = [
      { path: 'SKILL.md', content: '# Skill' },
      { path: 'templates/prompt.txt', content: 'hello' },
    ];
    const filesB = [...filesA].reverse();

    const [fingerprintA, fingerprintB] = await Promise.all([
      buildClawHubCompatFingerprint(filesA),
      buildClawHubCompatFingerprint(filesB),
    ]);

    expect(fingerprintA).toBe(fingerprintB);
  });

  it('derives a deterministic compatibility version from updatedAt', () => {
    expect(buildClawHubCompatVersion(1710000000000)).toBe('0.0.1710000000');
  });

  it('builds deterministic zip bytes when a version timestamp is provided', () => {
    const files = [
      { path: 'SKILL.md', content: '# Skill' },
      { path: 'prompts/system.txt', content: 'hello' },
    ];

    const zipA = createStoredZip(files, { modifiedAt: 1710000000000 });
    const zipB = createStoredZip(files, { modifiedAt: 1710000000000 });

    expect(Array.from(zipA)).toEqual(Array.from(zipB));
  });
});
