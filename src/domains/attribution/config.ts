/**
 * Central attribution configuration.
 * All tunable thresholds in one place for calibration.
 */

export const ATTRIBUTION_CONFIG = {
  discovery: {
    maxDays: 28,
    minScore: 35,
    topK: 5,
  },

  weights: {
    platform: 25,
    topic: 25,
    url: 20,
    temporal: 20,
    geo: 10,
  },

  confidence: {
    high: 75,
    medium: 50,
    low: 25,
  },

  matching: {
    topicJaccardPartial: 0.4,
    topicMinWordLength: 2,
    impactWindowFallbackDays: 14,
    temporalDoubleWindowMultiplier: 2,
  },
} as const;

export type AttributionConfig = typeof ATTRIBUTION_CONFIG;
