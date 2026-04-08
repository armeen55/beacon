/**
 * Central attribution configuration.
 * All tunable thresholds in one place for calibration.
 */

import type { SignalType, AssetType, Platform } from "@/lib/constants";

// ── Signal-type → expected platform mapping ─────────────────────────
// Used by matchSignalPlatform when opportunity_id is null (common).
// "all" means the change likely affects every platform.

export const SIGNAL_PLATFORM_MAP: Record<
  SignalType,
  Platform[]
> = {
  faq: ["google_aio", "perplexity", "chatgpt"],
  content: ["chatgpt", "google_aio", "perplexity"],
  technical: ["google_aio", "perplexity"],
  page: ["chatgpt", "google_aio", "perplexity"],
  citation: ["chatgpt", "google_aio", "perplexity"],
  review: ["chatgpt", "google_aio"],
  lead_form: [],
  off_page_seo: ["chatgpt", "google_aio"],
  measurement: [],
  service_page: ["chatgpt", "google_aio", "perplexity"],
};

// ── Asset-type → platform affinity boost ────────────────────────────
// Some asset types have stronger relevance to certain platforms.

export const ASSET_PLATFORM_BOOST: Partial<
  Record<AssetType, Partial<Record<Platform, number>>>
> = {
  directory_profile: { chatgpt: 0.3, perplexity: 0.1 },
  city_page: { google_aio: 0.1, perplexity: 0.1 },
  service_page: { perplexity: 0.1, google_aio: 0.1 },
  homepage: { google_aio: 0.1 },
};

// ── Source-category-to-platform relevance ────────────────────────────
// How relevant a change's source-category is to the platform where
// the event was observed. 1.0 = primary channel, 0.0 = irrelevant.

export const SOURCE_CATEGORY_PLATFORM_WEIGHTS: Record<
  string,
  Record<string, number>
> = {
  directory_profile: { chatgpt: 1.0, google_aio: 0.5, perplexity: 0.6 },
  city_page: { chatgpt: 0.5, google_aio: 0.8, perplexity: 0.9 },
  service_page: { chatgpt: 0.5, google_aio: 0.8, perplexity: 0.9 },
  homepage: { chatgpt: 0.5, google_aio: 0.8, perplexity: 0.7 },
  infrastructure: { chatgpt: 0.3, google_aio: 0.7, perplexity: 0.5 },
  sitemap: { chatgpt: 0.2, google_aio: 0.8, perplexity: 0.4 },
  lead_form: { chatgpt: 0.0, google_aio: 0.0, perplexity: 0.0 },
  project_page: { chatgpt: 0.4, google_aio: 0.6, perplexity: 0.7 },
};

// ── Geo containment ─────────────────────────────────────────────────
// Metro areas and which cities they contain.

export const GEO_CONTAINMENT: Record<string, string[]> = {
  "bay area": [
    "menlo park", "palo alto", "los altos", "los altos hills",
    "atherton", "woodside", "portola valley", "mountain view",
    "saratoga", "campbell", "cupertino", "san jose", "sunnyvale",
    "san mateo", "redwood city", "san carlos", "burlingame",
    "foster city", "fremont", "milpitas", "santa clara",
    "san francisco", "oakland", "berkeley",
  ],
};

// ── Known prompt topics ─────────────────────────────────────────────
// When the result topic exactly matches one of these, and the change's
// topic_targeted is a substring or contains the same city, upgrade
// the topic match.

export const KNOWN_TOPICS = [
  "Atherton Construction",
  "Cupertino Construction",
  "Los Altos Construction",
  "Menlo Park Construction",
  "Palo Alto Construction",
  "Shield: Custom Home Builder Bay Area",
  "Shield: Luxury Home Builder Bay Area",
  "Already Have Architectural Plans (Bay Area)",
  "Best Design-Build Firm for Custom Homes(Bay Area)",
  "Best Modern Home Builder (Bay Area)",
  "Build on My Lot / Empty Lot Builders (Bay Area)",
  "Whole Home Renovation Builders (Bay Area)",
] as const;

// ── Platform-specific attribution windows ───────────────────────────

export const PLATFORM_MAX_DAYS: Partial<Record<Platform, number>> = {
  chatgpt: 42,
  google_aio: 28,
  perplexity: 28,
};

// ── Main config ─────────────────────────────────────────────────────

export const ATTRIBUTION_CONFIG = {
  discovery: {
    maxDays: 28,
    minScore: 30,
    topK: 5,
  },

  weights: {
    platform: 20,
    topic: 25,
    url: 5,
    geo: 15,
    temporal: 20,
    sourceCategory: 15,
  },

  strengthValue: {
    strong: 1.0,
    partial: 0.5,
    unknown: 0.0,
    none: 0.0,
  },

  confidence: {
    high: 70,
    medium: 45,
    low: 20,
  },

  matching: {
    topicJaccardPartial: 0.4,
    topicMinWordLength: 2,
    impactWindowFallbackDays: 14,
    temporalDoubleWindowMultiplier: 2,
  },

  events: {
    surgeMinRate: 0.25,
    surgePrevMaxRate: 0.15,
    minTotalPossible: 3,
    regainedGapMinDays: 2,
  },
} as const;

export type AttributionConfig = typeof ATTRIBUTION_CONFIG;
