import { assessSkillQuality, QUALITY_MAX_CONTENT_CHARS, qualityFilePaths } from '../../src/lib/server/skill/quality';
import { buildGithubSkillR2Keys, buildUploadSkillR2Key } from '../../src/lib/skill-path';

export const QUALITY_BACKFILL_BATCH_SIZE = 20;
interface QualityCandidate {
  id: string; slug: string; source_type: string; repo_owner: string; repo_name: string;
  skill_path: string | null; content_hash: string | null; commit_sha: string | null;
  file_structure: string | null; readme: string | null;
}

/** Hourly budget: <=20 rows, <=40 R2 reads, <=20 guarded writes. No GitHub or AI. */
export async function backfillSkillQuality(env: { DB: D1Database; R2: R2Bucket }, now = Date.now()): Promise<number> {
  const candidates = await env.DB.prepare(`
    SELECT id, slug, source_type, repo_owner, repo_name, skill_path, content_hash,
      commit_sha, file_structure, SUBSTR(readme, 1, ${QUALITY_MAX_CONTENT_CHARS + 1}) AS readme
    FROM skills INDEXED BY skills_quality_review_idx
    WHERE visibility = 'public' AND quality_status = 'pending' AND quality_next_review_at <= ?
    ORDER BY quality_next_review_at, id LIMIT ?
  `).bind(now, QUALITY_BACKFILL_BATCH_SIZE).all<QualityCandidate>();
  let changed = 0;
  for (const row of candidates.results) {
    try {
      let content = row.readme;
      if (content === null) {
        const keys = row.source_type === 'upload'
          ? [buildUploadSkillR2Key(row.slug, 'SKILL.md')]
          : buildGithubSkillR2Keys(row.repo_owner, row.repo_name, row.skill_path, 'SKILL.md');
        for (const key of keys.filter(Boolean).slice(0, 2)) {
          const object = await env.R2.get(key);
          if (!object) continue;
          // Bound bytes before decoding, including bundles with huge markdown.
          if (object.size > QUALITY_MAX_CONTENT_CHARS) {
            await object.body.cancel();
            break;
          }
          content = await object.text();
          break;
        }
      }
      let assessment = assessSkillQuality(content, qualityFilePaths(row.file_structure));
      if (content !== null && row.content_hash && content.length <= QUALITY_MAX_CONTENT_CHARS) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
        const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
        if (hex !== row.content_hash) assessment = { ...assessment, status: 'pending', reason: 'content_hash_mismatch' };
      }
      const result = await env.DB.prepare(`
        UPDATE skills SET quality_status = ?, quality_reason = ?, quality_version = ?, quality_next_review_at = ?
        WHERE id = ? AND quality_status = 'pending' AND content_hash IS ? AND commit_sha IS ?
      `).bind(assessment.status, assessment.reason, assessment.version,
        assessment.status === 'pending' ? now + 86_400_000 : 0,
        row.id, row.content_hash, row.commit_sha).run();
      changed += result.meta.changes || 0;
    } catch (error) {
      // Move unavailable objects out of the head so one failure cannot starve the queue.
      await env.DB.prepare(`UPDATE skills SET quality_next_review_at = ? WHERE id = ? AND quality_status = 'pending'`)
        .bind(now + 86_400_000, row.id).run();
      console.warn(`Quality backfill deferred ${row.id}`, error);
    }
  }
  return changed;
}
