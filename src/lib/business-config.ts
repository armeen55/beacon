import "server-only";

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { syncBusinessConfig } from "@/lib/persistence/dual-write";
import { EVENT_PRIORS_V1 as EVENT_PRIORS_V1_SOURCE } from "@/lib/event-priors";
import { log } from "@/lib/logger";

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

  /**
   * D1 (operator audit, 2026-05-05) — when the resolved config is the
   * neutral placeholder (i.e., NO operator-curated tenant data was found
   * via env var, top-level file, or global file), this flag is `true`.
   * Consumer surfaces (settings, /today, etc.) can branch on this to show
   * a "configuration needed" affordance instead of pretending to be a
   * real business.
   *
   * Real loaded configs MUST omit this field (it's strictly the
   * placeholder marker — never persist `__placeholder: true` to disk).
   */
  __placeholder?: true;
}


const DATA_DIR = path.join(process.cwd(), ".data");
/**
 * Pre-2026-05-05 read path. Kept as the FIRST file location to preserve
 * /settings/config save-path behavior (saves write here). Operator-edited
 * config still lands here.
 */
const TOP_LEVEL_CONFIG_PATH = path.join(DATA_DIR, "business-config.json");
/**
 * Canonical store-classification path. `business-config` is registered in
 * `GLOBAL_STORES` (see `src/lib/persistence/store-classification.ts:136`),
 * so the json-store routing layer expects this location. We read here as
 * a secondary fallback so a Ritz-style tenant whose config was migrated
 * to the global path keeps working.
 */
const GLOBAL_CONFIG_PATH = path.join(DATA_DIR, "global", "business-config.json");

/**
 * D1 (operator audit, 2026-05-05) — neutral placeholder config.
 *
 * This replaces the previous Ritz-Builders-flavored DEFAULT_CONFIG. When
 * the resolved config falls through to this placeholder, the consumer
 * sees clearly-empty brand fields (no name, no domain, no services) and
 * can detect the state via `isPlaceholderConfig()`. Customer-2 onboarding
 * the platform without a tenant config file will land here — and will NOT
 * silently render Ritz-flavored copy.
 *
 * Operator-locked rules:
 *   • All brand-shaped fields (`name`, `domain`, `industry`, `locations`,
 *     `services`, `primaryCompetitors`, etc.) are EMPTY or generic.
 *   • Domain knowledge fields (`urlPatterns`, `stripWords`, `industryThemes`,
 *     `faqTemplates`) are minimal/universal — they must not bias the
 *     section analyzer or FAQ generator toward any specific industry.
 *   • `__placeholder: true` flag pins detection.
 *   • NO Ritz literals (no "Ritz", "ritzbuilders", "Bay Area", "Atherton",
 *     "Palo Alto", "design-build", etc.). Pinned by tests.
 */
const PLACEHOLDER_CONFIG: BusinessConfig = {
  name: "",
  domain: "",
  industry: "",
  phone: "",
  address: "",
  yelpBusinessId: "",
  locations: [],
  services: [],
  primaryCompetitors: [],
  keyPages: [],
  locationTerms: [],
  serviceTerms: [],
  // Universal directory blocklist — these are AI-answer directory sources
  // that pollute leaderboards regardless of industry. Safe in placeholder.
  directoryDomains: [
    "houzz.com",
    "yelp.com",
    "angi.com",
    "reddit.com",
    "thumbtack.com",
    "homeadvisor.com",
    "buildzoom.com",
    "bbb.org",
  ],
  scanSettings: {
    preferredHour: 9,
    timezone: "UTC",
    scope: "priority",
    // Default OFF for placeholder — a customer-2 with no curated config
    // should NOT auto-trigger paid scans on their domain until they've
    // explicitly opted in via /settings/config.
    enabled: false,
  },
  urlPatterns: undefined,
  stripWords: undefined,
  industryThemes: undefined,
  faqTemplates: undefined,
  event_priors_v1: { ...EVENT_PRIORS_V1 },
  __placeholder: true,
};

/**
 * Public predicate: is the resolved config the neutral placeholder?
 *
 * Use this in consumer code that needs to branch on "configuration
 * needed" state — e.g., to show a setup banner on /today instead of
 * rendering empty leaderboards.
 *
 * Pure. Idempotent.
 */
export function isPlaceholderConfig(config: BusinessConfig): boolean {
  return config.__placeholder === true;
}

/**
 * D1 — env-var-driven config override for hosted (Vercel) environments
 * where `.data/` is not bundled into the build. The operator can set
 * `BEACON_BUSINESS_CONFIG_JSON` to the full JSON payload of their tenant
 * config; if set and parseable, it takes precedence over both file paths.
 *
 * Returns null when the env var is unset, empty, or unparseable. The
 * caller falls through to file/placeholder.
 */
function readConfigFromEnv(): Partial<BusinessConfig> | null {
  const raw = process.env.BEACON_BUSINESS_CONFIG_JSON;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BusinessConfig>;
    // Defensive: strip any persisted `__placeholder` flag — env vars
    // describe REAL configs, never the placeholder marker.
    if ("__placeholder" in parsed) delete parsed.__placeholder;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Try a list of file paths in order; return the parsed contents of the
 * first one that exists and parses cleanly. Returns null if none match.
 */
function readConfigFromFiles(): Partial<BusinessConfig> | null {
  for (const candidate of [TOP_LEVEL_CONFIG_PATH, GLOBAL_CONFIG_PATH]) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BusinessConfig>;
      if ("__placeholder" in parsed) delete parsed.__placeholder;
      return parsed;
    } catch {
      // Continue to next candidate on parse failure.
    }
  }
  return null;
}

let _cached: BusinessConfig | null = null;
/**
 * Process-level "already warned" flag for the placeholder log.
 * Without this, every server-component render that calls
 * `getBusinessConfig()` would re-emit the warning, flooding the
 * production log with noise. Reset by `__resetBusinessConfigCacheForTests`.
 */
let _placeholderWarnedThisProcess = false;

/**
 * Resolve the active business config. Priority order:
 *   1. `BEACON_BUSINESS_CONFIG_JSON` env var (Vercel-friendly).
 *   2. `.data/business-config.json` (top-level — legacy save target).
 *   3. `.data/global/business-config.json` (canonical store-classification path).
 *   4. `PLACEHOLDER_CONFIG` (neutral, `__placeholder: true`).
 *
 * For sources 1–3, missing fields are filled in from the placeholder
 * (so the type stays complete). For source 4, the placeholder is
 * returned verbatim with `__placeholder: true`.
 *
 * Operator audit (2026-05-05) — when the resolution falls through to
 * the neutral placeholder, the function emits a one-time `log.warn`
 * so production dashboards surface the "configuration needed" state.
 * The warning fires AT MOST ONCE per process; consumer code can
 * branch on `isPlaceholderConfig(cfg)` for UI affordances. Customer-
 * facing surfaces should NOT show a scary warning — only admin /
 * diagnostic surfaces (e.g., `/diagnostics`) should expose this state
 * to the operator.
 */
export function getBusinessConfig(): BusinessConfig {
  if (_cached) return _cached;

  const fromEnv = readConfigFromEnv();
  if (fromEnv !== null) {
    _cached = mergeWithPlaceholder(fromEnv);
    return _cached;
  }

  const fromFile = readConfigFromFiles();
  if (fromFile !== null) {
    _cached = mergeWithPlaceholder(fromFile);
    return _cached;
  }

  _cached = PLACEHOLDER_CONFIG;
  if (!_placeholderWarnedThisProcess) {
    _placeholderWarnedThisProcess = true;
    log.warn(
      "[business-config] no tenant config found — running on neutral placeholder. Set BEACON_BUSINESS_CONFIG_JSON env var or place a .data/global/business-config.json to load real tenant config.",
      {
        envVarSet: typeof process.env.BEACON_BUSINESS_CONFIG_JSON === "string",
        topLevelFileExists: existsSync(TOP_LEVEL_CONFIG_PATH),
        globalFileExists: existsSync(GLOBAL_CONFIG_PATH),
        runningOn: process.env.VERCEL === "1" ? "vercel" : "local",
      },
    );
  }
  return _cached;
}

/**
 * Build a complete BusinessConfig by overlaying real values on top of the
 * placeholder — so missing fields don't crash consumers. Strips the
 * `__placeholder` marker (a real loaded config is NOT the placeholder).
 */
function mergeWithPlaceholder(
  loaded: Partial<BusinessConfig>,
): BusinessConfig {
  const merged: BusinessConfig = { ...PLACEHOLDER_CONFIG, ...loaded };
  delete merged.__placeholder;
  return merged;
}

export function saveBusinessConfig(patch: Partial<BusinessConfig>): BusinessConfig {
  const current = getBusinessConfig();
  const updated = { ...current, ...patch };
  // Saving makes this a real config; clear the placeholder marker.
  delete updated.__placeholder;

  if (process.env.VERCEL !== "1") {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TOP_LEVEL_CONFIG_PATH, JSON.stringify(updated, null, 2));
  }
  _cached = updated;
  // Fire-and-forget: saveBusinessConfig is synchronous, dual-write is async best-effort
  syncBusinessConfig(updated).catch(() => {});
  return updated;
}

/**
 * Test-only — reset the in-memory cache so a fresh getBusinessConfig()
 * call re-runs the full resolution chain. Also resets the
 * "already warned" flag so the placeholder log can fire again per test.
 * Production code does NOT use this; the cache is intentional (config
 * is read once per process).
 */
export function __resetBusinessConfigCacheForTests(): void {
  _cached = null;
  _placeholderWarnedThisProcess = false;
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
