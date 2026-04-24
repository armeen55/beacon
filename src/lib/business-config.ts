import "server-only";

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { syncBusinessConfig } from "@/lib/persistence/dual-write";
import { EVENT_PRIORS_V1 as EVENT_PRIORS_V1_SOURCE } from "@/lib/event-priors";

/** Re-export for backwards compatibility with code that imports from business-config. */
export const EVENT_PRIORS_V1 = EVENT_PRIORS_V1_SOURCE;

export interface BusinessConfig {
  name: string;
  domain: string;
  industry: string;
  phone: string;
  address: string;
  /** Yelp Fusion business id or alias (used by Settings → Connectors → Yelp sync). */
  yelpBusinessId: string;
  locations: string[];
  services: string[];
  primaryCompetitors: string[];
  keyPages: string[];
  locationTerms: string[];
  serviceTerms: string[];
  directoryDomains: string[];
  /** Duplicate of `.data/scan-settings.json` — not read by the scan CLI; prefer `getScanSettings()` for runtime truth. */
  scanSettings: {
    preferredHour: number;
    timezone: string;
    scope: "priority" | "full";
    enabled: boolean;
  };

  // ---------------------------------------------------------------------------
  // Domain knowledge — drives section analysis, page type inference, and FAQ
  // generation. These fields make Beacon portable across industries.
  // ---------------------------------------------------------------------------

  /** URL path prefixes that identify page types. Keys are page type names. */
  urlPatterns?: {
    city?: string;       // e.g., "/locations/"
    service?: string;    // e.g., "/services/"
    project?: string;    // e.g., "/explore-projects/"
  };

  /**
   * Words to strip when normalizing H2s for section comparison.
   * Should include brand-specific words, city names, and local geography.
   * Merged with a universal set (articles, prepositions).
   */
  stripWords?: string[];

  /**
   * Additional section themes beyond the universal set.
   * Each entry: { pattern: regex source string, label: internal key, display: human label }
   * These are appended to (not replacing) the universal themes.
   */
  industryThemes?: { pattern: string; label: string; display: string }[];

  /**
   * FAQ question templates keyed by topic-matching pattern.
   * Each entry: { topicPattern: regex source string, questions: template strings with {topic} and {city} placeholders }
   * Checked in order; first match wins. Falls back to generic if none match.
   */
  faqTemplates?: { topicPattern: string; questions: string[] }[];

  /**
   * Phase 0 — static edit-type priors used by the event-attributor when
   * scoring sitewide rollouts. Values are the prior probability that an event
   * of the given type moves owned-citation volume. Every use of this table
   * MUST be accompanied by `confidence_source: "seed_prior"` on the
   * attribution record so seed priors never masquerade as learned truth.
   */
  event_priors_v1?: {
    metadata_publication: number;
    schema_rollout: number;
    crawlability_fix: number;
    page_created: number;
    performance_batch: number;
    content_rollout: number;
    content_edit: number;
  };
}


const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "business-config.json");

const DEFAULT_CONFIG: BusinessConfig = {
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  industry: "home-builder",
  phone: "",
  address: "",
  yelpBusinessId: "",
  locations: [
    "Palo Alto",
    "Menlo Park",
    "Atherton",
    "Los Altos",
    "Cupertino",
    "Saratoga",
    "Woodside",
    "Portola Valley",
    "Mountain View",
    "Sunnyvale",
    "San Jose",
    "Bay Area",
    "Silicon Valley",
    "Emerald Hills",
  ],
  services: [
    "custom home",
    "remodel",
    "renovation",
    "new construction",
    "teardown",
    "rebuild",
    "home builder",
    "general contractor",
    "addition",
    "ADU",
    "design-build",
  ],
  primaryCompetitors: [],
  keyPages: ["/", "/luxury-home-builder-bay-area", "/locations"],
  locationTerms: [],
  serviceTerms: [],
  directoryDomains: [
    "houzz.com",
    "yelp.com",
    "angi.com",
    "reddit.com",
    "diamondcertified.org",
    "bbb.org",
    "thumbtack.com",
    "homeadvisor.com",
    "buildzoom.com",
  ],
  scanSettings: {
    preferredHour: 9,
    timezone: "America/Los_Angeles",
    scope: "full",
    enabled: true,
  },

  // Domain knowledge — Ritz Builders defaults
  urlPatterns: {
    city: "/locations/",
    service: "/services/",
    project: "/explore-projects/",
  },

  stripWords: [
    // Ritz city names
    "atherton", "menlo", "park", "palo", "alto", "cupertino", "saratoga",
    "los", "altos", "hills", "emerald", "sunnyvale", "mountain", "view",
    "san", "jose", "francisco", "bay", "area", "silicon", "valley",
    "california", "ca",
    // Ritz brand words
    "ritz", "builders", "construction", "homes", "home", "builder",
  ],

  industryThemes: [
    { pattern: "\\bdesign\\b.*\\bbuild|\\barchitect", label: "design_build", display: "Design-build overview" },
    { pattern: "\\badu\\b|\\baccessory\\s+dwelling", label: "adu", display: "ADU section" },
    { pattern: "\\bremodel|\\brenovation", label: "remodel", display: "Remodel section" },
    { pattern: "\\bzoning|\\bpermit|\\bregulation", label: "zoning", display: "Zoning & permits" },
  ],

  faqTemplates: [
    {
      topicPattern: "^(\\w[\\w\\s]*?)\\s+Construction$",
      questions: [
        "What should I look for in a custom home builder in {city}?",
        "How much does it cost to build a custom home in {city}?",
        "How long does a custom home build take in {city}?",
      ],
    },
    {
      topicPattern: "Builder|Home",
      questions: [
        "How do I choose the right {topic}?",
        "What questions should I ask a {topic}?",
        "What does a {topic} typically cost?",
      ],
    },
    {
      topicPattern: "Renovation|Remodel",
      questions: [
        "What is the typical timeline for a {topic}?",
        "How do I choose the right contractor for a {topic}?",
        "What permits are needed for a {topic}?",
      ],
    },
  ],

  event_priors_v1: { ...EVENT_PRIORS_V1 },
};

let _cached: BusinessConfig | null = null;

export function getBusinessConfig(): BusinessConfig {
  if (_cached) return _cached;

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BusinessConfig>;
      _cached = { ...DEFAULT_CONFIG, ...parsed };
      return _cached;
    } catch {
      // Fall through to default
    }
  }

  _cached = DEFAULT_CONFIG;
  return _cached;
}

export function saveBusinessConfig(patch: Partial<BusinessConfig>): BusinessConfig {
  const current = getBusinessConfig();
  const updated = { ...current, ...patch };

  if (process.env.VERCEL !== "1") {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  }
  _cached = updated;
  // Fire-and-forget: saveBusinessConfig is synchronous, dual-write is async best-effort
  syncBusinessConfig(updated).catch(() => {});
  return updated;
}

export function getLocationRegex(config?: BusinessConfig): RegExp {
  const cfg = config ?? getBusinessConfig();
  const terms =
    cfg.locationTerms.length > 0
      ? cfg.locationTerms
      : cfg.locations;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

export function getServiceRegex(config?: BusinessConfig): RegExp {
  const cfg = config ?? getBusinessConfig();
  const terms =
    cfg.serviceTerms.length > 0
      ? cfg.serviceTerms
      : cfg.services;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]?"),
  );
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

export function isDirectoryDomain(domain: string, config?: BusinessConfig): boolean {
  const cfg = config ?? getBusinessConfig();
  const norm = domain.toLowerCase().replace(/^www\./, "");
  return cfg.directoryDomains.some((d) => norm === d || norm.endsWith(`.${d}`));
}

// ---------------------------------------------------------------------------
// Derived config objects for subsystems
// ---------------------------------------------------------------------------

import type { SectionAnalyzerConfig } from "@/domains/product/section-analyzer";
import type { FaqTemplate } from "@/domains/product/morning-brief";

/** Build the section analyzer config from business config. */
export function getSectionAnalyzerConfig(config?: BusinessConfig): SectionAnalyzerConfig {
  const cfg = config ?? getBusinessConfig();
  return {
    urlPatterns: cfg.urlPatterns,
    stripWords: cfg.stripWords,
    industryThemes: cfg.industryThemes,
  };
}

/** Get FAQ templates from business config. */
export function getFaqTemplates(config?: BusinessConfig): FaqTemplate[] {
  const cfg = config ?? getBusinessConfig();
  return cfg.faqTemplates ?? [];
}
