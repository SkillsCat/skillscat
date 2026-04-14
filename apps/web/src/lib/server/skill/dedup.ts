export interface SkillMdHashes {
  fullHash: string;
  normalizedHash: string;
}

export interface BundleManifestFile {
  path: string;
  sha?: string | null;
  size?: number | null;
  type?: string | null;
}

export interface StoredSkillHashes extends SkillMdHashes {
  bundleExactHash?: string | null;
  bundleManifestHash?: string | null;
}

export interface CanonicalSkillCandidate {
  id: string;
  slug: string;
  repoOwner: string | null;
  repoName: string | null;
  skillPath: string | null;
  sourceType: string;
  visibility: string;
  stars: number;
  lastCommitAt: number | null;
  skillMdFirstCommitAt: number | null;
  repoCreatedAt: number | null;
  createdAt: number;
  indexedAt: number | null;
}

export interface PrivateSkillGithubConversionInput {
  skillId: string;
  name: string;
  description: string | null;
  repoOwner: string;
  repoName: string;
  skillPath: string | null;
  githubUrl: string;
  stars: number;
  forks: number;
  contentHash: string;
  commitSha: string | null;
  fileStructure: string | null;
  lastCommitAt: number | null;
  skillMdFirstCommitAt: number | null;
  repoCreatedAt: number | null;
  indexedAt: number;
  updatedAt?: number;
}

export interface HashGroupSkillMatch extends CanonicalSkillCandidate {
  ownerId: string | null;
  orgId: string | null;
}

interface LegacyHashGroupSkillMatch extends HashGroupSkillMatch {
  fileStructure: string | null;
  readme: string | null;
}

interface FindSkillsByHashGroupOptions {
  visibility?: string;
  sourceType?: string;
  excludeSkillId?: string;
  limit?: number;
}

export function normalizeSkillContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

export async function computeSha256Hex(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeSkillMdHashes(content: string): Promise<SkillMdHashes> {
  return {
    fullHash: await computeSha256Hex(content),
    normalizedHash: await computeSha256Hex(normalizeSkillContent(content)),
  };
}

export async function computeStandaloneSkillBundleHashes(content: string): Promise<StoredSkillHashes> {
  const { fullHash, normalizedHash } = await computeSkillMdHashes(content);
  const size = new TextEncoder().encode(content).byteLength;
  const bundleFiles = [
    {
      path: 'SKILL.md',
      sha: fullHash,
      size,
      type: 'text',
    },
  ];

  return {
    fullHash,
    normalizedHash,
    bundleExactHash: await computeExactBundleFingerprint(bundleFiles),
    bundleManifestHash: await computeBundleManifestHash(bundleFiles, normalizedHash),
  };
}

function normalizeBundlePath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();

  return normalized.toLowerCase() === 'skill.md' ? 'SKILL.md' : normalized;
}

async function computeBundleFingerprint(
  files: BundleManifestFile[],
  getContentId: (file: BundleManifestFile, normalizedPath: string) => string,
  options?: {
    zeroSkillMdSize?: boolean;
  }
): Promise<string> {
  const normalizedEntries = files
    .map((file) => {
      const normalizedPath = normalizeBundlePath(file.path);
      const isSkillMd = normalizedPath === 'SKILL.md';

      return {
        path: normalizedPath,
        type: file.type || 'unknown',
        size: options?.zeroSkillMdSize && isSkillMd ? 0 : Number(file.size || 0),
        contentId: getContentId(file, normalizedPath),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  return computeSha256Hex(JSON.stringify(normalizedEntries));
}

export async function computeBundleManifestHash(
  files: BundleManifestFile[],
  skillMdNormalizedHash: string
): Promise<string> {
  return computeBundleFingerprint(
    files,
    (file, normalizedPath) => normalizedPath === 'SKILL.md'
      ? `normalized:${skillMdNormalizedHash}`
      : `sha:${file.sha || ''}`,
    { zeroSkillMdSize: true }
  );
}

export async function computeExactBundleFingerprint(files: BundleManifestFile[]): Promise<string> {
  return computeBundleFingerprint(
    files,
    (file) => `sha:${file.sha || ''}`
  );
}

export async function storeSkillHashes(
  db: D1Database,
  skillId: string,
  hashes: StoredSkillHashes
): Promise<void> {
  const now = Date.now();
  const records: Array<{ hashType: string; hashValue: string | null | undefined }> = [
    { hashType: 'full', hashValue: hashes.fullHash },
    { hashType: 'normalized', hashValue: hashes.normalizedHash },
    { hashType: 'bundle_exact', hashValue: hashes.bundleExactHash },
    { hashType: 'bundle_manifest', hashValue: hashes.bundleManifestHash },
  ];

  for (const record of records) {
    if (!record.hashValue) continue;
    await upsertSkillHash(db, skillId, record.hashType, record.hashValue, now);
  }
}

export async function convertPrivateSkillToPublicGithub(
  db: D1Database,
  input: PrivateSkillGithubConversionInput
): Promise<void> {
  const normalizedSkillPath = input.skillPath || '';
  const updatedAt = input.updatedAt ?? input.indexedAt;
  const normalizedDescription = input.description ?? null;
  const normalizedCommitSha = input.commitSha ?? null;
  const normalizedFileStructure = input.fileStructure ?? null;

  await db.prepare(`
    UPDATE skills
    SET
      name = ?,
      description = ?,
      visibility = 'public',
      source_type = 'github',
      repo_owner = ?,
      repo_name = ?,
      skill_path = ?,
      github_url = ?,
      stars = ?,
      forks = ?,
      content_hash = ?,
      commit_sha = ?,
      file_structure = ?,
      readme = NULL,
      last_commit_at = ?,
      skill_md_first_commit_at = ?,
      repo_created_at = ?,
      indexed_at = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      input.name,
      normalizedDescription,
      input.repoOwner,
      input.repoName,
      normalizedSkillPath,
      input.githubUrl,
      input.stars,
      input.forks,
      input.contentHash,
      normalizedCommitSha,
      normalizedFileStructure,
      input.lastCommitAt,
      input.skillMdFirstCommitAt,
      input.repoCreatedAt,
      input.indexedAt,
      updatedAt,
      input.skillId
    )
    .run();
}

async function upsertSkillHash(
  db: D1Database,
  skillId: string,
  hashType: string,
  hashValue: string,
  createdAt: number = Date.now()
): Promise<void> {
  await db.prepare(`
      INSERT INTO content_hashes (id, skill_id, hash_type, hash_value, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(skill_id, hash_type) DO UPDATE SET
        hash_value = excluded.hash_value
    `)
    .bind(crypto.randomUUID(), skillId, hashType, hashValue, createdAt)
    .run();
}

function applySkillMatchFilters(
  conditions: string[],
  bindValues: Array<string | number>,
  options: FindSkillsByHashGroupOptions
): void {
  if (options.visibility) {
    conditions.push('s.visibility = ?');
    bindValues.push(options.visibility);
  }

  if (options.sourceType) {
    conditions.push('s.source_type = ?');
    bindValues.push(options.sourceType);
  }

  if (options.excludeSkillId) {
    conditions.push('s.id != ?');
    bindValues.push(options.excludeSkillId);
  }
}

async function computeLegacyBundleManifestHash(
  candidate: Pick<LegacyHashGroupSkillMatch, 'fileStructure' | 'readme'>,
  normalizedHash: string
): Promise<string | null> {
  if (candidate.fileStructure) {
    try {
      const parsed = JSON.parse(candidate.fileStructure) as {
        files?: BundleManifestFile[];
      };
      if (Array.isArray(parsed.files) && parsed.files.length > 0) {
        return computeBundleManifestHash(parsed.files, normalizedHash);
      }
    } catch {
      // fall through to the readme-based fallback
    }
  }

  if (candidate.readme) {
    const standaloneHashes = await computeStandaloneSkillBundleHashes(candidate.readme);
    if (standaloneHashes.normalizedHash === normalizedHash && standaloneHashes.bundleManifestHash) {
      return standaloneHashes.bundleManifestHash;
    }
  }

  return null;
}

async function computeLegacyExactBundleHash(
  candidate: Pick<LegacyHashGroupSkillMatch, 'fileStructure' | 'readme'>,
  fullHash: string
): Promise<string | null> {
  if (candidate.fileStructure) {
    try {
      const parsed = JSON.parse(candidate.fileStructure) as {
        files?: BundleManifestFile[];
      };
      if (Array.isArray(parsed.files) && parsed.files.length > 0) {
        return computeExactBundleFingerprint(parsed.files);
      }
    } catch {
      // fall through to the readme-based fallback
    }
  }

  if (candidate.readme) {
    const standaloneHashes = await computeStandaloneSkillBundleHashes(candidate.readme);
    if (standaloneHashes.fullHash === fullHash && standaloneHashes.bundleExactHash) {
      return standaloneHashes.bundleExactHash;
    }
  }

  return null;
}

async function findLegacyBundleMatches(
  db: D1Database,
  normalizedHash: string,
  bundleManifestHash: string,
  options: FindSkillsByHashGroupOptions,
  existingSkillIds: Set<string>
): Promise<HashGroupSkillMatch[]> {
  const conditions: string[] = [];
  const bindValues: Array<string | number> = [normalizedHash];
  applySkillMatchFilters(conditions, bindValues, options);

  const whereSql = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  const legacyScanLimit = Math.max(
    typeof options.limit === 'number' ? options.limit : 100,
    existingSkillIds.size + 20
  );

  const result = await db.prepare(`
    SELECT
      s.id,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.skill_path as skillPath,
      s.source_type as sourceType,
      s.visibility as visibility,
      s.owner_id as ownerId,
      s.org_id as orgId,
      s.stars as stars,
      s.last_commit_at as lastCommitAt,
      s.skill_md_first_commit_at as skillMdFirstCommitAt,
      s.repo_created_at as repoCreatedAt,
      s.created_at as createdAt,
      s.indexed_at as indexedAt,
      s.file_structure as fileStructure,
      s.readme as readme
    FROM content_hashes nh INDEXED BY content_hashes_lookup_idx
    INNER JOIN skills s ON s.id = nh.skill_id
    LEFT JOIN content_hashes bh
      ON bh.skill_id = s.id
     AND bh.hash_type = 'bundle_manifest'
    WHERE nh.hash_type = 'normalized'
      AND nh.hash_value = ?
      AND bh.skill_id IS NULL
      ${whereSql}
    ORDER BY s.created_at ASC
    LIMIT ?
  `)
    .bind(...bindValues, legacyScanLimit)
    .all<LegacyHashGroupSkillMatch>();

  const matches: HashGroupSkillMatch[] = [];

  for (const candidate of result.results || []) {
    if (existingSkillIds.has(candidate.id)) {
      continue;
    }

    const legacyBundleManifestHash = await computeLegacyBundleManifestHash(candidate, normalizedHash);
    if (!legacyBundleManifestHash || legacyBundleManifestHash !== bundleManifestHash) {
      continue;
    }

    await upsertSkillHash(db, candidate.id, 'bundle_manifest', legacyBundleManifestHash);
    existingSkillIds.add(candidate.id);
    matches.push({
      id: candidate.id,
      slug: candidate.slug,
      repoOwner: candidate.repoOwner,
      repoName: candidate.repoName,
      skillPath: candidate.skillPath,
      sourceType: candidate.sourceType,
      visibility: candidate.visibility,
      ownerId: candidate.ownerId,
      orgId: candidate.orgId,
      stars: candidate.stars,
      lastCommitAt: candidate.lastCommitAt,
      skillMdFirstCommitAt: candidate.skillMdFirstCommitAt,
      repoCreatedAt: candidate.repoCreatedAt,
      createdAt: candidate.createdAt,
      indexedAt: candidate.indexedAt,
    });
  }

  return matches;
}

async function findLegacyExactBundleMatches(
  db: D1Database,
  fullHash: string,
  bundleExactHash: string,
  options: FindSkillsByHashGroupOptions,
  existingSkillIds: Set<string>
): Promise<HashGroupSkillMatch[]> {
  const conditions: string[] = [];
  const bindValues: Array<string | number> = [fullHash];
  applySkillMatchFilters(conditions, bindValues, options);

  const whereSql = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  const legacyScanLimit = Math.max(
    typeof options.limit === 'number' ? options.limit : 100,
    existingSkillIds.size + 20
  );

  const result = await db.prepare(`
    SELECT
      s.id,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.skill_path as skillPath,
      s.source_type as sourceType,
      s.visibility as visibility,
      s.owner_id as ownerId,
      s.org_id as orgId,
      s.stars as stars,
      s.last_commit_at as lastCommitAt,
      s.skill_md_first_commit_at as skillMdFirstCommitAt,
      s.repo_created_at as repoCreatedAt,
      s.created_at as createdAt,
      s.indexed_at as indexedAt,
      s.file_structure as fileStructure,
      s.readme as readme
    FROM content_hashes fh INDEXED BY content_hashes_lookup_idx
    INNER JOIN skills s ON s.id = fh.skill_id
    LEFT JOIN content_hashes beh
      ON beh.skill_id = s.id
     AND beh.hash_type = 'bundle_exact'
    WHERE fh.hash_type = 'full'
      AND fh.hash_value = ?
      AND beh.skill_id IS NULL
      ${whereSql}
    ORDER BY s.created_at ASC
    LIMIT ?
  `)
    .bind(...bindValues, legacyScanLimit)
    .all<LegacyHashGroupSkillMatch>();

  const matches: HashGroupSkillMatch[] = [];

  for (const candidate of result.results || []) {
    if (existingSkillIds.has(candidate.id)) {
      continue;
    }

    const legacyBundleExactHash = await computeLegacyExactBundleHash(candidate, fullHash);
    if (!legacyBundleExactHash || legacyBundleExactHash !== bundleExactHash) {
      continue;
    }

    await upsertSkillHash(db, candidate.id, 'bundle_exact', legacyBundleExactHash);
    existingSkillIds.add(candidate.id);
    matches.push({
      id: candidate.id,
      slug: candidate.slug,
      repoOwner: candidate.repoOwner,
      repoName: candidate.repoName,
      skillPath: candidate.skillPath,
      sourceType: candidate.sourceType,
      visibility: candidate.visibility,
      ownerId: candidate.ownerId,
      orgId: candidate.orgId,
      stars: candidate.stars,
      lastCommitAt: candidate.lastCommitAt,
      skillMdFirstCommitAt: candidate.skillMdFirstCommitAt,
      repoCreatedAt: candidate.repoCreatedAt,
      createdAt: candidate.createdAt,
      indexedAt: candidate.indexedAt,
    });
  }

  return matches;
}

export async function findSkillsByHashGroup(
  db: D1Database,
  normalizedHash: string,
  bundleManifestHash: string,
  options: FindSkillsByHashGroupOptions = {}
): Promise<HashGroupSkillMatch[]> {
  const conditions: string[] = [];
  const bindValues: Array<string | number> = [normalizedHash, bundleManifestHash];
  applySkillMatchFilters(conditions, bindValues, options);

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitSql = typeof options.limit === 'number' ? 'LIMIT ?' : '';
  if (typeof options.limit === 'number') {
    bindValues.push(options.limit);
  }

  const result = await db.prepare(`
    WITH normalized_matches AS (
      SELECT skill_id
      FROM content_hashes INDEXED BY content_hashes_lookup_idx
      WHERE hash_type = 'normalized'
        AND hash_value = ?
    ),
    bundle_matches AS (
      SELECT skill_id
      FROM content_hashes INDEXED BY content_hashes_lookup_idx
      WHERE hash_type = 'bundle_manifest'
        AND hash_value = ?
    ),
    matched AS (
      SELECT nm.skill_id
      FROM normalized_matches nm
      INNER JOIN bundle_matches bm ON bm.skill_id = nm.skill_id
    )
    SELECT
      s.id,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.skill_path as skillPath,
      s.source_type as sourceType,
      s.visibility as visibility,
      s.owner_id as ownerId,
      s.org_id as orgId,
      s.stars as stars,
      s.last_commit_at as lastCommitAt,
      s.skill_md_first_commit_at as skillMdFirstCommitAt,
      s.repo_created_at as repoCreatedAt,
      s.created_at as createdAt,
      s.indexed_at as indexedAt
    FROM matched m
    INNER JOIN skills s ON s.id = m.skill_id
    ${whereSql}
    ORDER BY s.created_at ASC
    ${limitSql}
  `)
    .bind(...bindValues)
    .all<HashGroupSkillMatch>();

  const exactMatches = result.results || [];
  if (typeof options.limit === 'number' && exactMatches.length >= options.limit) {
    return exactMatches;
  }

  const matchesById = new Set(exactMatches.map((match) => match.id));
  const legacyMatches = await findLegacyBundleMatches(
    db,
    normalizedHash,
    bundleManifestHash,
    options,
    matchesById
  );

  const combined = [...exactMatches, ...legacyMatches]
    .sort((left, right) => left.createdAt - right.createdAt);

  if (typeof options.limit === 'number') {
    return combined.slice(0, options.limit);
  }

  return combined;
}

export async function findSkillsByExactHashGroup(
  db: D1Database,
  fullHash: string,
  bundleExactHash: string,
  options: FindSkillsByHashGroupOptions = {}
): Promise<HashGroupSkillMatch[]> {
  const conditions: string[] = [];
  const bindValues: Array<string | number> = [bundleExactHash];
  applySkillMatchFilters(conditions, bindValues, options);

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitSql = typeof options.limit === 'number' ? 'LIMIT ?' : '';
  if (typeof options.limit === 'number') {
    bindValues.push(options.limit);
  }

  const result = await db.prepare(`
    WITH exact_matches AS (
      SELECT skill_id
      FROM content_hashes INDEXED BY content_hashes_lookup_idx
      WHERE hash_type = 'bundle_exact'
        AND hash_value = ?
    )
    SELECT
      s.id,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.skill_path as skillPath,
      s.source_type as sourceType,
      s.visibility as visibility,
      s.owner_id as ownerId,
      s.org_id as orgId,
      s.stars as stars,
      s.last_commit_at as lastCommitAt,
      s.skill_md_first_commit_at as skillMdFirstCommitAt,
      s.repo_created_at as repoCreatedAt,
      s.created_at as createdAt,
      s.indexed_at as indexedAt
    FROM exact_matches m
    INNER JOIN skills s ON s.id = m.skill_id
    ${whereSql}
    ORDER BY s.created_at ASC
    ${limitSql}
  `)
    .bind(...bindValues)
    .all<HashGroupSkillMatch>();

  const exactMatches = result.results || [];
  if (typeof options.limit === 'number' && exactMatches.length >= options.limit) {
    return exactMatches;
  }

  const matchesById = new Set(exactMatches.map((match) => match.id));
  const legacyMatches = await findLegacyExactBundleMatches(
    db,
    fullHash,
    bundleExactHash,
    options,
    matchesById
  );

  const combined = [...exactMatches, ...legacyMatches]
    .sort((left, right) => left.createdAt - right.createdAt);

  if (typeof options.limit === 'number') {
    return combined.slice(0, options.limit);
  }

  return combined;
}

export async function findPublicGithubCanonicalCandidates(
  db: D1Database,
  normalizedHash: string,
  bundleManifestHash: string,
  excludeSkillId?: string
): Promise<CanonicalSkillCandidate[]> {
  const result = await findSkillsByHashGroup(db, normalizedHash, bundleManifestHash, {
    visibility: 'public',
    sourceType: 'github',
    excludeSkillId,
  });

  return result.map((candidate) => ({
    id: candidate.id,
    slug: candidate.slug,
    repoOwner: candidate.repoOwner,
    repoName: candidate.repoName,
    skillPath: candidate.skillPath,
    sourceType: candidate.sourceType,
    visibility: candidate.visibility,
    stars: candidate.stars,
    lastCommitAt: candidate.lastCommitAt,
    skillMdFirstCommitAt: candidate.skillMdFirstCommitAt,
    repoCreatedAt: candidate.repoCreatedAt,
    createdAt: candidate.createdAt,
    indexedAt: candidate.indexedAt,
  }));
}

function compareNullableAsc(left: number | null, right: number | null): number {
  const leftValue = typeof left === 'number' ? left : Number.POSITIVE_INFINITY;
  const rightValue = typeof right === 'number' ? right : Number.POSITIVE_INFINITY;
  return leftValue - rightValue;
}

function buildCandidateTieBreakKey(candidate: CanonicalSkillCandidate): string {
  return [
    candidate.repoOwner || '',
    candidate.repoName || '',
    candidate.skillPath || '',
    candidate.slug,
  ].join('/');
}

export function compareCanonicalSkillCandidates(
  left: CanonicalSkillCandidate,
  right: CanonicalSkillCandidate
): number {
  const firstCommitComparison = compareNullableAsc(left.skillMdFirstCommitAt, right.skillMdFirstCommitAt);
  if (firstCommitComparison !== 0) return firstCommitComparison;

  const repoCreatedComparison = compareNullableAsc(left.repoCreatedAt, right.repoCreatedAt);
  if (repoCreatedComparison !== 0) return repoCreatedComparison;

  const lastCommitComparison = compareNullableAsc(left.lastCommitAt, right.lastCommitAt);
  if (lastCommitComparison !== 0) return lastCommitComparison;

  if (left.stars !== right.stars) {
    return right.stars - left.stars;
  }

  const createdAtComparison = compareNullableAsc(left.createdAt, right.createdAt);
  if (createdAtComparison !== 0) return createdAtComparison;

  return buildCandidateTieBreakKey(left).localeCompare(buildCandidateTieBreakKey(right));
}

export function chooseCanonicalSkillCandidate(
  candidates: CanonicalSkillCandidate[]
): CanonicalSkillCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareCanonicalSkillCandidates)[0] || null;
}
