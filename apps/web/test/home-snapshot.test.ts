import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHomeSnapshot, writeHomeSnapshot } from '../src/lib/server/cache/home-snapshot';
import { hydrateCachedSkills, addCategoriesToSkills } from '../src/lib/server/db/shared/skills';
vi.mock('../src/lib/server/db/shared/skills', () => ({
  hydrateCachedSkills: vi.fn(async (_db: unknown, rows: unknown[]) => rows),
  addCategoriesToSkills: vi.fn(async (_db: unknown, rows: unknown[]) => rows),
}));
const card = { id: 'one', slug: 'demo/one', name: 'One', description: null, repoOwner: 'demo', repoName: 'one', stars: 1, forks: 0, trendingScore: 1, updatedAt: 1, authorAvatar: null };
const snapshot = () => ({ generatedAt: Date.now(), stats: { totalSkills: 1 }, trending: [card], recent: [card], top: [card] });
beforeEach(() => { vi.clearAllMocks(); });
describe('home snapshot', () => {
  it('hydrates a deduplicated bounded set once and retains all SSR sections', async () => {
    const get = vi.fn(async () => ({ json: async () => snapshot() }));
    const result = await readHomeSnapshot({ R2: { get } as never, DB: {} as never });
    expect(get).toHaveBeenCalledOnce();
    expect(hydrateCachedSkills).toHaveBeenCalledWith({}, [card], true);
    expect(result?.trending).toEqual([card]);
    expect(result?.recent).toEqual([card]);
    expect(result?.top).toEqual([card]);
  });
  it.each(['expired', 'private', 'oversized', 'broken'])('falls back for %s snapshots', async (kind) => {
    const data = snapshot();
    if (kind === 'expired') data.generatedAt -= 301_000;
    if (kind === 'oversized') data.top = Array.from({ length: 13 }, () => card);
    if (kind === 'private') vi.mocked(hydrateCachedSkills).mockResolvedValueOnce([]);
    const get = vi.fn(async () => { if (kind === 'broken') throw new Error('R2'); return { json: async () => data }; });
    expect(await readHomeSnapshot({ R2: { get } as never, DB: {} as never })).toBeNull();
  });
  it('reuses worker selections and hydrates categories only for unique first-screen IDs', async () => {
    const put = vi.fn(async () => {});
    await writeHomeSnapshot({ R2: { put } as never, DB: {} as never }, snapshot());
    expect(addCategoriesToSkills).toHaveBeenCalledWith({}, [card]);
    expect(put).toHaveBeenCalledOnce();
  });
});
