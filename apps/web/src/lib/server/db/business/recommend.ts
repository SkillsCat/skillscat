import type { SkillCardData } from '$lib/types';
import { addAuthorAvatarsToSkills, addCategoriesToSkills } from '$lib/server/db/shared/skills';
import { timedTask } from '$lib/server/db/shared/timing';
import type { DbEnv, SkillListRow, TimingCollector } from '$lib/server/db/shared/types';

interface TagRow {
  tag: string;
}

interface OverlapCountRow {
  skill_id: string;
  cnt: number;
}

interface RecommendSkillCandidateRow extends SkillListRow {
  lastCommitAt: number | null;
  sharedCategoryCount?: number;
  sharedTagCount?: number;
}

/**
 * 获取相关 skills (tiered candidate discovery + adaptive scoring)
 *
 * Tiered discovery ensures results even when a skill has no categories/tags:
 *   Tier 1: Category overlap | Tier 2: Tag overlap | Tier 3: Same author | Tier 4: Trending fallback
 *
 * Adaptive weights adjust based on available signals (categories, tags, both, neither).
 */
export async function getRecommendedSkills(
  env: DbEnv,
  skillId: string,
  categories: string[],
  repoOwner: string = '',
  limit: number = 10,
  timingCollector?: TimingCollector,
  includeCategories: boolean = true,
  preloadedTags?: string[] | null
): Promise<SkillCardData[]> {
  const db = env.DB;
  if (!db) return [];

  const MIN_CANDIDATES = limit * 2;
  const MAX_SCORING_CANDIDATES = MIN_CANDIDATES + 4;
  const hasCategories = categories.length > 0;

  // Step 1: Get current skill's tags
  let skillTags: string[];
  if (Array.isArray(preloadedTags)) {
    const deduped = Array.from(new Set(preloadedTags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)));
    skillTags = deduped;
    timingCollector?.('rel_tags', 0, 'preloaded');
  } else {
    const tagsResult = await timedTask(
      timingCollector,
      'rel_tags',
      () => db.prepare(
        'SELECT tag FROM skill_tags WHERE skill_id = ?'
      ).bind(skillId).all<TagRow>(),
      'current skill tags'
    );
    skillTags = tagsResult.results.map((row) => row.tag);
  }
  const hasTags = skillTags.length > 0;

  // Step 2: Tiered candidate discovery
  // Each candidate tracks which tier discovered it
  const candidateMap = new Map<string, { data: RecommendSkillCandidateRow; tier: number }>();
  const excludeIds: string[] = [skillId];

  const SKILL_COLUMNS_BASE = `
    s.id, s.name, s.slug, s.description,
    s.repo_owner as repoOwner, s.repo_name as repoName,
    s.stars, s.forks, s.trending_score as trendingScore,
    COALESCE(s.last_commit_at, s.updated_at) as updatedAt, s.last_commit_at as lastCommitAt`;

  const addCandidates = (rows: RecommendSkillCandidateRow[], tier: number) => {
    for (const row of rows) {
      if (!candidateMap.has(row.id)) {
        candidateMap.set(row.id, { data: row, tier });
        excludeIds.push(row.id);
      }
    }
  };

  const excludePlaceholders = () => excludeIds.map(() => '?').join(',');
  const getTierFetchLimit = (baseFloor: number, headroom: number, maxCap: number) => {
    const remaining = Math.max(MIN_CANDIDATES - candidateMap.size, 0);
    return Math.max(baseFloor, Math.min(maxCap, remaining + headroom));
  };

  // Tier 1: Category overlap
  if (hasCategories) {
    const catPh = categories.map(() => '?').join(',');
    const exPh = excludePlaceholders();
    const tier1Limit = getTierFetchLimit(limit, 4, 24);
    const result = await timedTask(
      timingCollector,
      'rel_t1',
      () => db.prepare(`
      WITH matched_ids AS (
        SELECT
          sc.skill_id as skillId,
          COUNT(*) as sharedCategoryCount
        FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
        WHERE sc.category_slug IN (${catPh})
          AND sc.skill_id NOT IN (${exPh})
        GROUP BY sc.skill_id
      )
      SELECT
        ${SKILL_COLUMNS_BASE},
        matched.sharedCategoryCount
      FROM matched_ids matched
      JOIN skills s ON s.id = matched.skillId
      WHERE s.visibility = 'public'
      ORDER BY matched.sharedCategoryCount DESC, s.trending_score DESC
      LIMIT ?
    `).bind(...categories, ...excludeIds, tier1Limit).all<RecommendSkillCandidateRow>(),
      'tier1 category overlap'
    );
    addCandidates(result.results, 1);
  }

  // Tier 2: Tag overlap
  if (hasTags && candidateMap.size < MIN_CANDIDATES) {
    const tagPh = skillTags.map(() => '?').join(',');
    const exPh = excludePlaceholders();
    const tier2Limit = getTierFetchLimit(Math.max(5, Math.ceil(limit / 2)), 2, 12);
    const result = await timedTask(
      timingCollector,
      'rel_t2',
      () => db.prepare(`
      WITH matched_ids AS (
        SELECT
          st.skill_id as skillId,
          COUNT(*) as sharedTagCount
        FROM skill_tags st INDEXED BY skill_tags_tag_skill_idx
        WHERE st.tag IN (${tagPh})
          AND st.skill_id NOT IN (${exPh})
        GROUP BY st.skill_id
      )
      SELECT
        ${SKILL_COLUMNS_BASE},
        matched.sharedTagCount
      FROM matched_ids matched
      JOIN skills s ON s.id = matched.skillId
      WHERE s.visibility = 'public'
      ORDER BY matched.sharedTagCount DESC, s.trending_score DESC
      LIMIT ?
    `).bind(...skillTags, ...excludeIds, tier2Limit).all<RecommendSkillCandidateRow>(),
      'tier2 tag overlap'
    );
    addCandidates(result.results, 2);
  }

  // Tier 3: Same author
  if (repoOwner && candidateMap.size < MIN_CANDIDATES) {
    const exPh = excludePlaceholders();
    const tier3Limit = getTierFetchLimit(3, 1, 6);
    const result = await timedTask(
      timingCollector,
      'rel_t3',
      () => db.prepare(`
      SELECT ${SKILL_COLUMNS_BASE}
      FROM skills s
      WHERE s.repo_owner = ?
        AND s.id NOT IN (${exPh})
        AND s.visibility = 'public'
      ORDER BY s.trending_score DESC
      LIMIT ?
    `).bind(repoOwner, ...excludeIds, tier3Limit).all<RecommendSkillCandidateRow>(),
      'tier3 same author'
    );
    addCandidates(result.results, 3);
  }

  // Tier 4: Trending fallback
  if (candidateMap.size < MIN_CANDIDATES) {
    const exPh = excludePlaceholders();
    const tier4Limit = getTierFetchLimit(4, 2, 8);
    const result = await timedTask(
      timingCollector,
      'rel_t4',
      () => db.prepare(`
      SELECT ${SKILL_COLUMNS_BASE}
      FROM skills s
      WHERE s.id NOT IN (${exPh})
        AND s.visibility = 'public'
      ORDER BY s.trending_score DESC
      LIMIT ?
    `).bind(...excludeIds, tier4Limit).all<RecommendSkillCandidateRow>(),
      'tier4 trending fallback'
    );
    addCandidates(result.results, 4);
  }

  if (candidateMap.size === 0) return [];

  const allCandidates = Array.from(candidateMap.values())
    .sort((a, b) =>
      a.tier - b.tier
      || (b.data.sharedCategoryCount || 0) - (a.data.sharedCategoryCount || 0)
      || (b.data.sharedTagCount || 0) - (a.data.sharedTagCount || 0)
      || (b.data.trendingScore || 0) - (a.data.trendingScore || 0)
      || (b.data.stars || 0) - (a.data.stars || 0)
    )
    .slice(0, MAX_SCORING_CANDIDATES);
  const allIds = allCandidates.map((c) => c.data.id);

  // Step 3: Batch enrichment queries
  const tagOverlapMap: Record<string, number> = {};
  const catOverlapMap: Record<string, number> = {};

  // Category overlap for non-Tier-1 candidates
  const nonTier1Ids = allCandidates
    .filter((c) => c.tier !== 1)
    .map((c) => c.data.id);
  const nonTier2Ids = allCandidates
    .filter((c) => c.tier !== 2)
    .map((c) => c.data.id);

  const tagOverlapPromise = hasTags && nonTier2Ids.length > 0
    ? (async () => {
      const idPh = nonTier2Ids.map(() => '?').join(',');
      const tagPh = skillTags.map(() => '?').join(',');
      const tagResult = await timedTask(
        timingCollector,
        'rel_tag_ov',
        () => db.prepare(`
      SELECT skill_id, COUNT(*) as cnt
      FROM skill_tags
      WHERE skill_id IN (${idPh}) AND tag IN (${tagPh})
      GROUP BY skill_id
    `).bind(...nonTier2Ids, ...skillTags).all<OverlapCountRow>(),
        'tag overlap batch'
      );
      for (const row of tagResult.results) {
        tagOverlapMap[row.skill_id] = row.cnt;
      }
    })()
    : Promise.resolve();

  const categoryOverlapPromise = hasCategories && nonTier1Ids.length > 0
    ? (async () => {
      const idPh = nonTier1Ids.map(() => '?').join(',');
      const catPh = categories.map(() => '?').join(',');
      const catResult = await timedTask(
        timingCollector,
        'rel_cat_ov',
        () => db.prepare(`
      SELECT skill_id, COUNT(*) as cnt
      FROM skill_categories
      WHERE skill_id IN (${idPh}) AND category_slug IN (${catPh})
      GROUP BY skill_id
    `).bind(...nonTier1Ids, ...categories).all<OverlapCountRow>(),
        'category overlap batch'
      );
      for (const row of catResult.results) {
        catOverlapMap[row.skill_id] = row.cnt;
      }
    })()
    : Promise.resolve();

  await Promise.all([tagOverlapPromise, categoryOverlapPromise]);

  // Step 4: Adaptive weight scoring
  const weights = hasCategories && hasTags
    ? { cat: 0.30, tag: 0.20, author: 0.10, pop: 0.15, fresh: 0.10, disc: 0.15 }
    : hasCategories
    ? { cat: 0.40, tag: 0.00, author: 0.10, pop: 0.20, fresh: 0.15, disc: 0.15 }
    : hasTags
    ? { cat: 0.00, tag: 0.40, author: 0.10, pop: 0.20, fresh: 0.15, disc: 0.15 }
    : { cat: 0.00, tag: 0.00, author: 0.20, pop: 0.35, fresh: 0.20, disc: 0.25 };

  const now = Date.now();
  const totalCategories = Math.max(categories.length, 1);
  const totalTags = Math.max(skillTags.length, 1);
  const tierDiscovery: Record<number, number> = { 1: 100, 2: 67, 3: 33, 4: 0 };

  const scoreStart = performance.now();
  const scored = allCandidates.map(({ data: c, tier }) => {
    // Category score: Tier 1 has sharedCategoryCount from query, others from batch
    const sharedCats = tier === 1
      ? (c.sharedCategoryCount || 0)
      : (catOverlapMap[c.id] || 0);
    const categoryScore = (sharedCats / totalCategories) * 100;

    // Tag score: Tier 2 has sharedTagCount from query, others from batch
    const sharedTags = tier === 2
      ? (c.sharedTagCount || 0)
      : (tagOverlapMap[c.id] || 0);
    const tagScore = (sharedTags / totalTags) * 100;

    const authorScore = (repoOwner && c.repoOwner === repoOwner) ? 100 : 0;
    const stars = c.stars || 0;
    const trending = c.trendingScore || 0;
    const popularityScore = Math.min(100, Math.log10(stars + 1) * 20 + trending * 2);
    const commitTs = c.lastCommitAt || (now - 200 * 86400000);
    const daysSinceCommit = (now - commitTs) / 86400000;
    const freshnessScore = Math.max(0, 100 - daysSinceCommit * 0.5);
    const discoveryScore = tierDiscovery[tier] ?? 0;

    const relevanceScore =
      categoryScore * weights.cat +
      tagScore * weights.tag +
      authorScore * weights.author +
      popularityScore * weights.pop +
      freshnessScore * weights.fresh +
      discoveryScore * weights.disc;

    return { ...c, relevanceScore, trendingScore: trending, stars };
  });

  timingCollector?.('rel_score', Math.max(0, performance.now() - scoreStart), 'score candidates');

  // Step 5: Sort, slice, enrich with categories
  const sortSliceStart = performance.now();
  scored.sort((a, b) =>
    b.relevanceScore - a.relevanceScore
    || b.trendingScore - a.trendingScore
    || b.stars - a.stars
  );

  const top = scored.slice(0, limit).map(({
    relevanceScore, sharedCategoryCount, sharedTagCount, lastCommitAt, ...rest
  }) => rest);
  timingCollector?.('rel_sort', Math.max(0, performance.now() - sortSliceStart), 'sort and slice');

  if (!includeCategories) {
    timingCollector?.('rel_add_cats', 0, 'skipped');
    return timedTask(
      timingCollector,
      'rel_add_auth',
      () => addAuthorAvatarsToSkills(db, top.map((skill) => ({ ...skill, categories: [] }))),
      'hydrate author avatars'
    );
  }

  const skillsWithCategories = await timedTask(
    timingCollector,
    'rel_add_cats',
    () => addCategoriesToSkills(db, top),
    'hydrate categories'
  );

  return timedTask(
    timingCollector,
    'rel_add_auth',
    () => addAuthorAvatarsToSkills(db, skillsWithCategories),
    'hydrate author avatars'
  );
}
