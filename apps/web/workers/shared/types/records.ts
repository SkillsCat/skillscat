export type SkillTier = 'hot' | 'warm' | 'cool' | 'cold' | 'archived';
export type ClassificationMethod = 'ai' | 'keyword' | 'direct';

export interface SkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  skill_path: string | null;
  github_url: string | null;
  stars: number;
  forks: number;
  star_snapshots: string | null;
  trending_score: number;
  file_structure: string | null;
  readme: string | null;
  last_commit_at: number | null;
  visibility: string;
  owner_id: string | null;
  org_id: string | null;
  source_type: string;
  content_hash: string | null;
  verified_repo_url: string | null;
  tier: SkillTier;
  last_accessed_at: number | null;
  access_count_7d: number;
  access_count_30d: number;
  download_count_7d: number;
  download_count_30d: number;
  download_count_90d: number;
  next_update_at: number | null;
  classification_method: ClassificationMethod | null;
  created_at: number;
  updated_at: number;
  indexed_at: number;
}

export interface AuthorRecord {
  id: string;
  github_id: number;
  username: string;
  avatar_url: string;
  type: string;
  created_at: number;
  updated_at: number;
}

export interface CachedList {
  data: SkillListItem[];
  generatedAt: number;
}

export interface SkillListItem {
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
  authorAvatar?: string;
  categories?: string[];
}
