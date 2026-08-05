import type { SkillCardData } from '$lib/types';

export interface DbEnv {
  DB?: D1Database;
  R2?: R2Bucket;
  KV?: KVNamespace;
  WORKER_SECRET?: string;
  RESURRECTION_WORKER_URL?: string;
  CACHE_VERSION?: string;
}

export interface CachedSkillCardRaw {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoOwner?: string;
  repo_owner?: string;
  repoName?: string;
  repo_name?: string;
  stars?: number;
  forks?: number;
  trendingScore?: number;
  trending_score?: number;
  updatedAt?: number;
  updated_at?: number;
  authorAvatar?: string | null;
  author_avatar?: string | null;
  categories?: string[];
}

export interface SkillListRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoOwner: string;
  repoName: string;
  stars: number;
  forks: number;
  trendingScore: number;
  updatedAt: number;
  authorAvatar: string | null;
}

export interface CategoryRow {
  skill_id: string;
  category_slug: string;
}

export type TimingCollector = (name: string, dur: number, desc?: string) => void;

export type HydrateSkillMap = Map<string, {
  repoOwner: string;
  repoName: string;
  updatedAt: number;
  authorAvatar?: string;
}>;

export type SkillCardList = SkillCardData[];
