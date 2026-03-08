/**
 * Shared ranking helpers used by workers and server-side list queries.
 *
 * Large multi-skill repositories can cause every sub-skill to inherit the full
 * repo star count, which overwhelms list rankings. We keep stars linear for
 * normal repos, then compress the marginal gain above a threshold so stars
 * still matter, but do not dominate every slot.
 */

export const STAR_NONLINEAR_THRESHOLD = 1000;
export const STAR_NONLINEAR_LOG_TAIL_WIDTH = 1000;
export const TOP_RATED_INSTALL_BASE_REQUIREMENT = 2;
export const TOP_RATED_INSTALL_REQUIREMENT_LOG_MULTIPLIER = 6;
export const TOP_RATED_STAR_FACTOR_FLOOR = 0.08;
export const TOP_RATED_INSTALL_BONUS_SCALE = 18;
export const TOP_RATED_INSTALL_BONUS_CAP = 220;
const LN10 = 2.302585092994046;

function clampStars(stars: number): number {
  if (!Number.isFinite(stars)) return 0;
  return Math.max(0, stars);
}

/**
 * Piecewise non-linear star curve (log-like):
 * - <= threshold: linear
 * - > threshold: logarithmic tail compression
 */
export function getNonlinearStarScore(stars: number): number {
  const safeStars = clampStars(stars);
  if (safeStars <= STAR_NONLINEAR_THRESHOLD) return safeStars;

  const delta = safeStars - STAR_NONLINEAR_THRESHOLD;
  return STAR_NONLINEAR_THRESHOLD
    + STAR_NONLINEAR_LOG_TAIL_WIDTH * Math.log1p(delta / STAR_NONLINEAR_LOG_TAIL_WIDTH);
}

/**
 * Soft install requirement for top-rated ranking.
 *
 * Requirement increases with the raw star base on a log curve, so large repos need more
 * install/download proof to unlock their star weight in top-rated lists.
 */
export function getTopRatedInstallRequirement(stars: number): number {
  return TOP_RATED_INSTALL_BASE_REQUIREMENT
    + Math.log2(clampStars(stars) + 1) * TOP_RATED_INSTALL_REQUIREMENT_LOG_MULTIPLIER;
}

/**
 * Top-rated score:
 * - stars are compressed non-linearly
 * - star contribution is gated by a star-dependent install requirement
 * - installs also provide a capped direct bonus
 *
 * `engagement90d` is the 90-day rolling count of `download + install` events,
 * used to stabilize top-rated ranking and keep semantics aligned with existing
 * 7d/30d counters.
 */
export function getTopRatedSortScore(stars: number, engagement90d: number): number {
  const weightedStars = getNonlinearStarScore(stars);
  const safeInstalls = Number.isFinite(engagement90d) ? Math.max(0, engagement90d) : 0;

  const requiredInstalls = getTopRatedInstallRequirement(stars);
  const readinessDenom = Math.log2(requiredInstalls + 1);
  const readiness = readinessDenom > 0
    ? Math.min(1, Math.log2(safeInstalls + 1) / readinessDenom)
    : 1;

  const starFactor = TOP_RATED_STAR_FACTOR_FLOOR
    + (1 - TOP_RATED_STAR_FACTOR_FLOOR) * readiness;
  const installBonus = Math.min(
    TOP_RATED_INSTALL_BONUS_CAP,
    Math.log2(safeInstalls + 1) * TOP_RATED_INSTALL_BONUS_SCALE
  );

  return weightedStars * starFactor + installBonus;
}

/**
 * SQL expression version of getNonlinearStarScore().
 * `starsExpr` must be a trusted SQL fragment (not user input).
 */
export function buildNonlinearStarScoreSql(starsExpr: string): string {
  const t = STAR_NONLINEAR_THRESHOLD;
  const k = STAR_NONLINEAR_LOG_TAIL_WIDTH;
  const nullableStars = `(CASE WHEN ${starsExpr} IS NULL THEN 0 ELSE ${starsExpr} END)`;
  const s = `(CASE WHEN ${nullableStars} < 0 THEN 0 ELSE ${nullableStars} END)`;
  const tSql = `${t}.0`;
  const kSql = `${k}.0`;

  return `(CASE
    WHEN ${s} <= ${t} THEN CAST(${s} AS REAL)
    ELSE
      ${tSql}
      + (${kSql} * (LOG(1.0 + ((${s} - ${tSql}) / ${kSql})) * ${LN10}))
    END)`;
}

export function buildRecentActivitySortSql(lastCommitAtExpr: string, updatedAtExpr: string): string {
  return `CASE WHEN ${lastCommitAtExpr} IS NULL THEN ${updatedAtExpr} ELSE ${lastCommitAtExpr} END`;
}

/**
 * SQL expression version of getTopRatedSortScore().
 * Inputs must be trusted SQL fragments.
 */
export function buildTopRatedSortScoreSql(starsExpr: string, engagement90dExpr: string): string {
  const weightedStars = buildNonlinearStarScoreSql(starsExpr);
  const nullableStars = `(CASE WHEN ${starsExpr} IS NULL THEN 0 ELSE ${starsExpr} END)`;
  const rawStars = `(CASE WHEN ${nullableStars} < 0 THEN 0 ELSE ${nullableStars} END)`;
  const nullableInstalls = `(CASE WHEN ${engagement90dExpr} IS NULL THEN 0 ELSE ${engagement90dExpr} END)`;
  const installs = `(CASE WHEN ${nullableInstalls} < 0 THEN 0 ELSE ${nullableInstalls} END)`;
  const requiredInstalls = `(${TOP_RATED_INSTALL_BASE_REQUIREMENT}
    + (LOG((${rawStars}) + 1) / LOG(2.0)) * ${TOP_RATED_INSTALL_REQUIREMENT_LOG_MULTIPLIER})`;
  const readinessRatio = `((LOG((${installs}) + 1) / LOG(2.0)) / (LOG((${requiredInstalls}) + 1) / LOG(2.0)))`;
  const readiness = `(CASE
    WHEN LOG((${installs}) + 1) <= 0 OR LOG((${requiredInstalls}) + 1) <= 0 THEN 0
    WHEN ${readinessRatio} < 1.0 THEN ${readinessRatio}
    ELSE 1.0
  END)`;
  const starFactor = `(${TOP_RATED_STAR_FACTOR_FLOOR}
    + (1.0 - ${TOP_RATED_STAR_FACTOR_FLOOR}) * ${readiness})`;
  const installBonusRaw = `((LOG((${installs}) + 1) / LOG(2.0)) * ${TOP_RATED_INSTALL_BONUS_SCALE})`;
  const installBonus = `(CASE
    WHEN ${installBonusRaw} < ${TOP_RATED_INSTALL_BONUS_CAP} THEN ${installBonusRaw}
    ELSE ${TOP_RATED_INSTALL_BONUS_CAP}
  END)`;

  return `((${weightedStars}) * (${starFactor}) + (${installBonus}))`;
}
