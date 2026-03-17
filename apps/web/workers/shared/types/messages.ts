export interface IndexingMessage {
  type: 'check_skill';
  repoOwner: string;
  repoName: string;
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  skillPath?: string;
  submittedBy?: string;
  submittedAt?: string;
  forceReindex?: boolean;
  discoverySource?: 'github-events' | 'github-code-search';
  discoveryFingerprint?: string;
}

export interface ClassificationMessage {
  type: 'classify';
  skillId: string;
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
}
