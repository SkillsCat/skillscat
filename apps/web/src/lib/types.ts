// ========== API Response Types ==========
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    cursor?: string;
    hasMore?: boolean;
  };
}

// ========== Skill Types ==========
export interface SkillCardData {
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
  categories: string[]; // category slugs
}

export interface SkillDetail extends SkillCardData {
  githubUrl: string | null;
  skillPath: string;
  readme: string | null;
  fileStructure: FileNode[] | null;
  lastCommitAt: number | null;
  createdAt: number;
  indexedAt: number;
  // Author info
  authorUsername?: string;
  authorDisplayName?: string;
  authorBio?: string;
  authorSkillsCount?: number;
  authorTotalStars?: number;
  // Private skill fields
  visibility: 'public' | 'private' | 'unlisted';
  sourceType: 'github' | 'upload';
  ownerId?: string;
  ownerName?: string;
  ownerAvatar?: string;
  orgId?: string;
  orgName?: string;
  orgSlug?: string;
  orgAvatar?: string;
}

// ========== File Node ==========
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

// ========== Author ==========
export interface AuthorInfo {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  skillsCount: number;
  totalStars: number;
}

// ========== Pagination ==========
export interface CursorPagination {
  cursor?: string;
  limit?: number;
}

// ========== Sort Options ==========
export type SortOption = 'trending' | 'stars' | 'recent' | 'name';

// ========== Search ==========
export interface SearchParams {
  query: string;
  category?: string;
  sortBy?: SortOption;
  cursor?: string;
  limit?: number;
}

// ========== Star Snapshot ==========
export interface StarSnapshot {
  d: string; // date YYYY-MM-DD
  s: number; // star count
}
