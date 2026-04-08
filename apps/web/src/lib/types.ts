// ========== API Response Types ==========
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    cursor?: string;
    hasMore?: boolean;
    page?: number;
    totalPages?: number;
  };
}

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
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
  authorAvatar?: string | null;
  categories: string[]; // category slugs
  classificationMethod?: 'ai' | 'keyword' | 'direct' | null;
}

export interface SkillDetail extends SkillCardData {
  githubUrl: string | null;
  skillPath: string;
  readme: string | null;
  fileStructure: FileNode[] | null;
  lastCommitAt: number | null;
  createdAt: number;
  indexedAt: number;
  license?: string | null;
  security?: SkillSecuritySummary | null;
  // Author info
  authorUsername?: string | null;
  authorDisplayName?: string | null;
  authorBio?: string | null;
  authorSkillsCount?: number | null;
  authorTotalStars?: number | null;
  // Private skill fields
  visibility: 'public' | 'private' | 'unlisted';
  sourceType: 'github' | 'upload';
  tier?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  ownerAvatar?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  orgSlug?: string | null;
  orgAvatar?: string | null;
}

export interface SkillInstallCliMethod {
  id: 'skillscat' | 'skills';
  command: string;
}

export type SecurityRiskLevel = 'low' | 'mid' | 'high' | 'fatal';
export type SecurityDimension =
  | 'prompt_injection'
  | 'privacy_exfiltration'
  | 'dangerous_operations'
  | 'supply_chain_malware'
  | 'obfuscation_evasion';

export interface SkillSecurityDimension {
  dimension: SecurityDimension;
  score: number;
  reason: string;
  findingCount: number;
}

export interface SkillSecurityFinding {
  filePath: string;
  dimension: SecurityDimension;
  score: number;
  reason: string;
}

export interface SkillSecuritySummary {
  aiRiskLevel?: SecurityRiskLevel | null;
  vtRiskLevel?: SecurityRiskLevel | null;
  aiSummary?: string | null;
  aiDimensions?: SkillSecurityDimension[];
  aiFindings?: SkillSecurityFinding[];
}

export interface SkillInstallData {
  cli: SkillInstallCliMethod[];
  agentPrompt: string;
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

// ========== SKILL.md Scanning ==========
export interface SkillMdLocation {
  path: string;       // Full path: "skills/remotion/SKILL.md"
  skillPath: string;  // Parent folder: "skills/remotion"
  depth: number;      // 0 = root, 1 = one level deep
}

export interface ScanResult {
  found: SkillMdLocation[];
  truncated: boolean;
}
