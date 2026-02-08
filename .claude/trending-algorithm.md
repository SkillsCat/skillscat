# Trending Algorithm

## Score Formula

```
trending_score = baseScore × velocityMultiplier × recencyBoost × activityPenalty × downloadBoost
```

Implementation: `apps/web/workers/trending.ts` → `calculateTrendingScore()`

## Signal Breakdown

### 1. Base Score
```
baseScore = log10(stars + 1) × 10
```
Logarithmic scaling prevents large repos from permanently dominating.

### 2. Velocity Multiplier (1.0x – 5.0x)
Measures short-term star growth momentum.
- Computes `dailyGrowth7d` and `dailyGrowth30d` from `starSnapshots`
- Acceleration = 7d growth / 30d growth (capped at 3x)
- Formula: `1.0 + log2(dailyGrowth7d + 1) × min(acceleration, 3) × 0.4`

### 3. Recency Boost (1.0x – 1.5x)
Favors newly indexed skills, decays linearly over 14 days.
```
recencyBoost = max(1.0, 1.5 - daysSinceIndexed / 14)
```

### 4. Activity Penalty (0.3x – 1.0x)
Penalizes stale repos based on days since last commit:
| Days since commit | Penalty |
|---|---|
| ≤ 30 | 1.0 |
| 31–90 | 0.9 |
| 91–180 | 0.7 |
| 181–365 | 0.5 |
| > 365 | 0.3 |

### 5. Download Boost (1.0x – 2.0x)
Based on 7-day download count.
```
downloadBoost = min(2.0, 1.0 + log2(downloads7d + 1) × 0.15)
```

## Tiered Update Strategy

Skills are assigned tiers that control how frequently they get re-scored.

| Tier | Update Interval | Min Stars | Access Window |
|---|---|---|---|
| hot | 6 hours | 1000 | 7 days |
| warm | 24 hours | 100 | 30 days |
| cool | 7 days | 10 | 90 days |
| cold | on access only | 0 | 1 year |
| archived | never | 0 | — |

A skill qualifies for a tier if it meets the star threshold OR was accessed within the window.

Config: `apps/web/workers/shared/types.ts` → `TIER_CONFIG`

## Worker Cron Execution

The trending worker runs on a cron schedule and processes in priority order:

1. User-marked skills (highest priority)
2. Hot tier (up to 500 skills per run)
3. Warm tier (up to 500 skills per run)
4. Cool tier (up to 125 skills per run)
5. AI reclassification detection (skills crossing 100-star threshold)
6. Download count flush from KV → D1 (daily)
7. R2 list cache regeneration (`trending.json`, `top.json`, `recent.json`)
8. KV metrics recording

## Data Fields

Schema: `apps/web/src/lib/server/db/schema.ts` → `skills` table

- `trending_score` (real) — computed score
- `star_snapshots` (text/JSON) — `[{d, s}]` history for velocity calc
- `last_commit_at` (integer) — activity penalty input
- `tier` (text) — current tier assignment
- `last_accessed_at` (timestamp_ms) — tier promotion trigger
- `access_count_7d`, `access_count_30d` (integer) — access counters
- `download_count_7d`, `download_count_30d` (integer) — download counters
- `next_update_at` (timestamp_ms) — scheduled re-score time
