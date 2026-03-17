export interface StarSnapshot {
  d: string;
  s: number;
}

export const TIER_CONFIG = {
  hot: {
    updateInterval: 6 * 60 * 60 * 1000,
    minStars: 1000,
    accessWindow: 7 * 24 * 60 * 60 * 1000,
  },
  warm: {
    updateInterval: 24 * 60 * 60 * 1000,
    minStars: 100,
    accessWindow: 30 * 24 * 60 * 60 * 1000,
  },
  cool: {
    updateInterval: 7 * 24 * 60 * 60 * 1000,
    minStars: 10,
    accessWindow: 90 * 24 * 60 * 60 * 1000,
  },
  cold: {
    updateInterval: 0,
    minStars: 0,
    accessWindow: 365 * 24 * 60 * 60 * 1000,
  },
  archived: {
    updateInterval: 0,
    minStars: 0,
    accessWindow: 0,
  },
} as const;
