export interface IndexingMessage {
  type: 'check_skill';
  repoOwner: string;
  repoName: string;
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  headSha?: string;
  gitRef?: string;
  skillPath?: string;
  skillFilePath?: string;
  submittedBy?: string;
  submittedAt?: string;
  submissionUserId?: string;
  forceReindex?: boolean;
  queuedAsPending?: boolean;
  /** Internal counter for bounded self-requeue backoff before native Queue retries take over. */
  rateLimitDeferrals?: number;
  discoverySource?: 'github-events' | 'github-code-search' | 'github-repo-search-html';
  discoveryFingerprint?: string;
}

export interface ClassificationMessage {
  type: 'classify';
  skillId: string;
  skillSlug?: string;
  repoOwner: string;
  repoName: string;
  skillMdPath: string;
  frontmatterCategories?: string[];
}

export interface SecurityAnalysisMessage {
  type: 'analyze_security';
  skillId: string;
  trigger: 'content_update' | 'report' | 'trending_head' | 'manual';
  requestedTier?: 'free' | 'premium' | 'auto';
  forceRefresh?: boolean;
}
