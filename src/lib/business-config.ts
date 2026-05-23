import "server-only";

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { syncBusinessConfig } from "@/lib/persistence/dual-write";
import { EVENT_PRIORS_V1 as EVENT_PRIORS_V1_SOURCE } from "@/lib/event-priors";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";

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
  /**
   * Section 7 C7g v1 (2026-05-16) — operator-entered off-site profile
   * URLs. Each field defaults to "" when the operator has not yet
   * configured a URL for that channel; an empty value keeps the
   * corresponding `OffSiteChannelState` in the C7a snapshot's
   * inferred/unknown state. When non-empty, the value MUST begin
   * with `https://` or `http://` (validated downstream in
   * `compute-snapshot.ts`); arbitrary strings are rejected.
   *
   * v1 carries `confidence: "medium"` for these channels because
   * Beacon does NOT HTTP-verify the URL — the operator vouches for
   * the listing. The diagnostic page renders these as "Configured"
   * (not "Confirmed") so the trust level is honest.
   *
   * Multi-tenant note: BusinessConfig is process-global today (see
   * `off-site-authority-multi-tenant-prerequisite` catalog row).
   * C7g v1 inherits that limitation; customer surfaces (C7d/C7e)
   * remain blocked until the multi-tenant store workstream lands.
   */
  houzzProfileUrl: string;
  angiProfileUrl: string;
  bbbProfileUrl: string;
  /** Operator-curated industry directory profile URL. v1 supports
   *  ONE URL; multi-directory support is C7g v2. */
  industryDirectoryProfileUrl: string;
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
 * MT-1 (2026-05-22) — per-tenant local/dev config dir. Resolution
 * priority (c) reads `.data/tenants/<tenantId>/business-config.json`.
 * Local/dev only; Vercel's `.data` is not bundled into the lambda.
 */
const TENANTS_DIR = path.join(DATA_DIR, "tenants");

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
  // Section 7 C7g v1 (2026-05-16) — operator-entered off-site profile
  // URLs. Default to "" so the placeholder config leaves all 4
  // channels in their inferred/unknown state.
  houzzProfileUrl: "",
  angiProfileUrl: "",
  bbbProfileUrl: "",
  industryDirectoryProfileUrl: "",
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

/**
 * MT-1 (2026-05-22) — multi-tenant env source (resolution priority a).
 * The operator sets `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` to a JSON
 * object keyed by CANONICAL tenantId, e.g.
 * `{"tenant-acme":{...},"tenant-foo":{...}}`. Returns the entry for
 * `tenantId` when present + parseable, else null. Checked BEFORE the
 * single-tenant back-compat chain so a per-tenant entry always wins.
 *
 * Returns null (caller falls through) when the env var is unset/empty/
 * unparseable OR has no entry for this tenant.
 */
function readConfigFromByTenantEnv(
  tenantId: string,
): Partial<BusinessConfig> | null {
  const raw = process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<BusinessConfig>>;
    if (parsed == null || typeof parsed !== "object") return null;
    const entry = parsed[tenantId];
    if (entry == null || typeof entry !== "object") return null;
    // Defensive: env describes REAL configs, never the placeholder marker.
    if ("__placeholder" in entry) delete entry.__placeholder;
    return entry;
  } catch {
    return null;
  }
}

/**
 * MT-1 (2026-05-22) — per-tenant local/dev file source (resolution
 * priority c). Reads `.data/tenants/<tenantId>/business-config.json`.
 * Returns null when the file is absent or unparseable.
 */
function readConfigFromTenantFile(
  tenantId: string,
): Partial<BusinessConfig> | null {
  const candidate = path.join(TENANTS_DIR, tenantId, "business-config.json");
  if (!existsSync(candidate)) return null;
  try {
    const raw = readFileSync(candidate, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BusinessConfig>;
    if ("__placeholder" in parsed) delete parsed.__placeholder;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * MT-1 (2026-05-22) — tenant-keyed config cache. Replaces the prior
 * process-level singleton (`let _cached: BusinessConfig | null`). Keyed
 * by CANONICAL tenantId (e.g. "tenant-ritz-founder"), NEVER by slug. Two
 * distinct tenants sharing one lambda each cache their own config — no
 * cross-tenant bleed. Cleared by `__resetBusinessConfigCacheForTests`.
 */
const _cacheByTenant = new Map<string, BusinessConfig>();
/**
 * MT-1 — per-tenant "already warned" set for the placeholder log.
 * Without this, every render that resolves the placeholder for a tenant
 * would re-emit the warning, flooding the production log. Tenant-keyed
 * so each tenant warns at most once per process. Reset by
 * `__resetBusinessConfigCacheForTests`.
 */
const _placeholderWarnedTenants = new Set<string>();

/**
 * MT-1 (2026-05-22) — synchronous tenant resolution for the deprecated
 * no-arg path. Mirrors the fail-loud spirit of `currentTenantId` but
 * cannot read request headers (it's synchronous), so it resolves only
 * from `BEACON_TENANT_ID`. Throws when that env var is unset.
 */
function resolveTenantIdFromEnvSync(): string {
  const envId = process.env.BEACON_TENANT_ID;
  if (typeof envId === "string" && envId.length > 0) return envId;
  throw new Error(
    "getBusinessConfig(): no tenantId argument and no BEACON_TENANT_ID env var. " +
      "Pass an explicit tenantId or use getBusinessConfigForCurrentTenant(). " +
      "In dev/test set BEACON_TENANT_ID=tenant-ritz-founder.",
  );
}

/**
 * MT-1 — one-time placeholder warning, per tenant. Fires AT MOST ONCE
 * per tenant per process so production dashboards surface the
 * "configuration needed" state without log flooding.
 */
function warnPlaceholderOnce(tenantId: string): void {
  if (_placeholderWarnedTenants.has(tenantId)) return;
  _placeholderWarnedTenants.add(tenantId);
  log.warn(
    "[business-config] no tenant config found — running on neutral placeholder. Set BEACON_BUSINESS_CONFIG_JSON env var or place a .data/global/business-config.json to load real tenant config.",
    {
      tenantId,
      envVarSet: typeof process.env.BEACON_BUSINESS_CONFIG_JSON === "string",
      topLevelFileExists: existsSync(TOP_LEVEL_CONFIG_PATH),
      globalFileExists: existsSync(GLOBAL_CONFIG_PATH),
      runningOn: process.env.VERCEL === "1" ? "vercel" : "local",
    },
  );
}

/**
 * MT-1 — pure resolution chain for ONE tenant. Priority order:
 *   a. `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT[tenantId]` (multi-tenant).
 *   b. when `tenantId === BEACON_TENANT_ID`: today's single-tenant chain,
 *      preserved EXACTLY — `BEACON_BUSINESS_CONFIG_JSON` →
 *      `.data/business-config.json` → `.data/global/business-config.json`
 *      (back-compat; keeps the env-named tenant byte-identical).
 *   c. `.data/tenants/<tenantId>/business-config.json` (local/dev).
 *   d. `PLACEHOLDER_CONFIG` (neutral, `__placeholder: true`).
 *
 * For sources a–c, missing fields are filled from the placeholder via
 * `mergeWithPlaceholder`. For source d, the placeholder is returned
 * verbatim and the one-time per-tenant warning fires.
 */
function resolveConfigForTenant(tenantId: string): BusinessConfig {
  const fromByTenant = readConfigFromByTenantEnv(tenantId);
  if (fromByTenant !== null) return mergeWithPlaceholder(fromByTenant);

  if (tenantId === process.env.BEACON_TENANT_ID) {
    const fromEnv = readConfigFromEnv();
    if (fromEnv !== null) return mergeWithPlaceholder(fromEnv);
    const fromFile = readConfigFromFiles();
    if (fromFile !== null) return mergeWithPlaceholder(fromFile);
  }

  const fromTenantFile = readConfigFromTenantFile(tenantId);
  if (fromTenantFile !== null) return mergeWithPlaceholder(fromTenantFile);

  warnPlaceholderOnce(tenantId);
  return PLACEHOLDER_CONFIG;
}

/**
 * Resolve the active business config for a tenant. Tenant-keyed cache;
 * resolution order documented on `resolveConfigForTenant`.
 *
 * Operator audit (2026-05-05) — when resolution falls through to the
 * neutral placeholder, a one-time-per-tenant `log.warn` fires so
 * production dashboards surface the "configuration needed" state.
 * Consumer code can branch on `isPlaceholderConfig(cfg)` for UI
 * affordances. Customer-facing surfaces should NOT show a scary
 * warning — only admin / diagnostic surfaces should expose this state.
 */
export function getBusinessConfig(tenantId: string): BusinessConfig;
/**
 * @deprecated MT-1 back-compat ONLY. Resolves the tenant synchronously
 * from `process.env.BEACON_TENANT_ID` and delegates to the tenant-aware
 * form. This no-arg path keeps existing consumers green during the
 * multi-tenant migration and will be REMOVED in a later MT slice once
 * every consumer threads an explicit tenantId (or uses
 * `getBusinessConfigForCurrentTenant`). Do NOT add new no-arg call-sites.
 */
export function getBusinessConfig(): BusinessConfig;
export function getBusinessConfig(tenantId?: string): BusinessConfig {
  const resolvedTenantId =
    typeof tenantId === "string" && tenantId.length > 0
      ? tenantId
      : resolveTenantIdFromEnvSync();

  const cached = _cacheByTenant.get(resolvedTenantId);
  if (cached) return cached;

  const resolved = resolveConfigForTenant(resolvedTenantId);
  _cacheByTenant.set(resolvedTenantId, resolved);
  return resolved;
}

/**
 * Async entry point for server components / actions / loaders. Resolves
 * the current tenant via `currentTenantId()` (request header → env) and
 * returns that tenant's config. Preferred over the deprecated no-arg
 * `getBusinessConfig()` — it routes per-request, not per-process-env.
 */
export async function getBusinessConfigForCurrentTenant(): Promise<BusinessConfig> {
  return getBusinessConfig(await currentTenantId());
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

export function saveBusinessConfig(
  tenantId: string,
  patch: Partial<BusinessConfig>,
): BusinessConfig;
/**
 * @deprecated MT-1 back-compat ONLY — the no-tenant form for the
 * existing settings call-site. Resolves the tenant from
 * `BEACON_TENANT_ID`. Will be tightened to a required tenantId in a
 * later MT slice. Do NOT add new no-tenant call-sites.
 */
export function saveBusinessConfig(patch: Partial<BusinessConfig>): BusinessConfig;
export function saveBusinessConfig(
  arg1: string | Partial<BusinessConfig>,
  arg2?: Partial<BusinessConfig>,
): BusinessConfig {
  const tenantId =
    typeof arg1 === "string" ? arg1 : resolveTenantIdFromEnvSync();
  const patch = typeof arg1 === "string" ? (arg2 ?? {}) : arg1;

  const current = getBusinessConfig(tenantId);
  const updated = { ...current, ...patch };
  // Saving makes this a real config; clear the placeholder marker.
  delete updated.__placeholder;

  // MT-1: file write stays single-tenant/back-compat — only the
  // env-named tenant writes to the shared top-level file (today's
  // behavior). A non-env tenant's save updates the tenant-keyed cache
  // only, so it can't clobber the shared file. Per-tenant write storage
  // lands in a later MT slice (no DB storage introduced in MT-1).
  if (process.env.VERCEL !== "1" && tenantId === process.env.BEACON_TENANT_ID) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TOP_LEVEL_CONFIG_PATH, JSON.stringify(updated, null, 2));
  }
  _cacheByTenant.set(tenantId, updated);
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
  _cacheByTenant.clear();
  _placeholderWarnedTenants.clear();
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

// MT-3C (2026-05-23) — `config` is REQUIRED (no no-arg fallback). All
// runtime callers thread the tenant-resolved config. (getLocationRegex /
// getServiceRegex keep the optional fallback until the extractor
// config-threading slice — they're called by the pure page extractor.)
export function isDirectoryDomain(domain: string, config: BusinessConfig): boolean {
  const norm = domain.toLowerCase().replace(/^www\./, "");
  return config.directoryDomains.some((d) => norm === d || norm.endsWith(`.${d}`));
}

// ---------------------------------------------------------------------------
// Derived config objects for subsystems
// ---------------------------------------------------------------------------

import type { SectionAnalyzerConfig } from "@/domains/product/section-analyzer";
import type { FaqTemplate } from "@/domains/product/morning-brief";

/** Build the section analyzer config from business config. MT-3C: `config` required. */
export function getSectionAnalyzerConfig(config: BusinessConfig): SectionAnalyzerConfig {
  return {
    urlPatterns: config.urlPatterns,
    stripWords: config.stripWords,
    industryThemes: config.industryThemes,
  };
}

/** Get FAQ templates from business config. MT-3C: `config` required. */
export function getFaqTemplates(config: BusinessConfig): FaqTemplate[] {
  return config.faqTemplates ?? [];
}
