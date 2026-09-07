/** Cheap, deterministic discovery checks. No model, network, or database calls. */
export const SKILL_QUALITY_VERSION = 1;
export const QUALITY_MAX_CONTENT_CHARS = 65_536;
export type SkillQualityStatus = 'pending' | 'eligible' | 'low_quality';
export interface SkillQualityAssessment {
  status: SkillQualityStatus;
  reason: string | null;
  version: number;
}

export function assessSkillQuality(content: string | null, paths: string[]): SkillQualityAssessment {
  const result = (status: SkillQualityStatus, reason: string | null = null): SkillQualityAssessment =>
    ({ status, reason, version: SKILL_QUALITY_VERSION });
  if (content === null) return result('pending', 'content_unavailable');
  if (content.length > QUALITY_MAX_CONTENT_CHARS) return result('pending', 'content_over_budget');
  const body = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---(?:\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, '').trim();
  const instructions = body.replace(/^#{1,6}\s+.*$/gm, '').trim();
  if (!instructions) return result('low_quality', 'empty_instructions');
  if (/^(?:[\s\p{P}]|todo|tbd|coming soon|your instructions here|待补充|待完善)+$/iu.test(instructions)) {
    return result('low_quality', 'placeholder_instructions');
  }

  // Generated code-unit wrappers claim tests/implementation that are not in
  // the installed bundle. Require the whole signature; a filename, short body,
  // random suffix, language, author, or star count alone is never a rejection.
  const execution = body.match(/^## How to execute\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim();
  const reference = body.match(/单元库[：:]\s*([\w./-]+\.py)/)?.[1];
  const normalizedPaths = paths.map((path) => path.replace(/^\.\//, '').toLowerCase());
  const hasImplementation = reference && normalizedPaths.some((path) =>
    path === reference.toLowerCase() || path.endsWith(`/${reference.toLowerCase()}`));
  if (reference && !hasImplementation && execution && execution.length < 160
    && /单元样例\s*\d+\s*条.*cases\s*断言/.test(body)
    && /物理基底.*calibration/.test(body)
    && !/```|~~~|https?:\/\//i.test(body)
    && normalizedPaths.every((path) => /(?:^|\/)(?:skill\.md|readme(?:\.md)?|license(?:\.md)?)$/.test(path))) {
    return normalizedPaths.length
      ? result('low_quality', 'unbundled_generated_unit')
      : result('pending', 'file_manifest_unavailable');
  }
  return result('eligible');
}

/** Both GitHub manifests and uploaded file trees are supported. */
export function qualityFilePaths(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const paths: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if (typeof row.path === 'string' && row.type !== 'directory') paths.push(row.path);
      if (row.files) visit(row.files);
      if (row.children) visit(row.children);
    };
    visit(parsed);
    return paths;
  } catch { return []; }
}
