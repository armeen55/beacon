import "server-only";

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import {
  syncBusinessConfig,
  syncTenantBusinessConfig,
} from "@/lib/persistence/dual-write";
import { EVENT_PRIORS_V1 as EVENT_PRIORS_V1_SOURCE } from "@/lib/event-priors";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";

/** Re-export for backwards compatibility with code that imports from business-config. */
export const EVENT_PRIORS_V1 = EVENT_PRIORS_V1_SOURCE;

export interface BusinessConfig {
  name: string;
  domain: string;
  industry: string;
  /**
   * P0 wall 3 (2026-06-10) — content-site classification mode. When
   * true (encyclopedias, blogs, docs sites — content_publisher-segment
   * tenants), HTML pages that aren't homepage/hub/utility/asset
   * classify as "content" detail pages instead of falling to "other",
   * so content-edit triggers (title/meta/h1/…) actually apply to the
   * site's real pages. Local-service sites leave this unset — their
   * "other" pages stay conservatively excluded from content edits.
   */
  contentSiteMode?: boolean;
  /**
   * Night-shift #35/#67 (2026-06-11) — per-tenant CONTENT RULES.
   * Plain-English rules every LLM generation for this tenant must
   * follow (e.g. "Call the language Persian, never Farsi."). The page
   * factory injects these as defaults when a cluster plan doesn't
   * carry its own; violations of `flaggedTerms` are HARD-REJECTED
   * (audit #47). Per-tenant config — never hardcoded vocabulary.
   */
  contentRules?: string[];
  /** Banned terms enforced by the factory validator (word-boundary,
   *  case-sensitive). Pairs with `contentRules`. */
  flaggedTerms?: string[];
  /**
   * Profound topic-scoping (2026-06-24). When the tenant's AEO prompts live
   * INSIDE a shared/borrowed Profound workspace category (one category that
   * mixes many subjects' topics), set this so the nightly sync scopes every
   * report to the tenant's OWN topic instead of pulling the whole category
   * (which would drown the tenant in unrelated citations — e.g. a borrowed
   * "Frontier Models" category whose Iranopedia prompts are one topic among 16).
   * `topicId` = the Profound topic UUID (filter `{field:"topic",operator:"is",
   * value:topicId}`); optional `categoryId` restricts the sync to that one
   * category. Unset → sync pulls the full category (original behavior).
   * Per-tenant connection config — never hardcoded vocabulary.
   */
  profound?: {
    categoryId?: string;
    topicId?: string;
    topicLabel?: string;
  };
  /**
   * Revenue facts item 3 (2026-07-01) - operator-set unit economics. The
   * nightly revenue pass multiplies these rates by REAL measured GA4
   * traffic to write `revenue_facts` rows with source='unit_economics'.
   * Every dollar produced this way is labeled "your rate x real traffic",
   * never presented as a measured payout. Unset = the pass stays dormant
   * and no estimated dollars appear anywhere.
   *   kind 'rpm'      - content tenants: dollars earned per 1,000 sessions.
   *   kind 'per_lead' - service tenants: dollars one lead (GA4 key event)
   *                     is worth to the business.
   */
  revenueModel?: {
    kind: "rpm" | "per_lead";
    rpmUsd?: number;
    dollarsPerLead?: number;
  };
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
   * Multi-tenant note: BusinessConfig is tenant-keyed as of MT-1
   * (resolve via `getBusinessConfig(tenantId)` /
   * `getBusinessConfigForCurrentTenant()`). C7g v1's operator-entered
   * URLs are read per-tenant; customer surfaces (C7d/C7e) now ship on
   * the tenant-correct path (MT-2/MT-3*).
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


/**
 * ISOLATION-CRITICAL (2026-06-15) — the FOUNDER tenant id.
 *
 * The legacy single-tenant resolution chain (the `BEACON_BUSINESS_CONFIG_JSON`
 * env blob + `.data/business-config.json` + `.data/global/business-config.json`)
 * describes ONE specific tenant: the founder's. That global file literally
 * contains the founder's brand ("Ritz Builders"). It must serve ONLY the
 * founder tenant — NEVER an arbitrary active tenant.
 *
 * Pre-fix, the legacy chain was gated `tenantId === process.env.BEACON_TENANT_ID`,
 * which meant "whoever the deploy/CLI env points at." On a per-tenant dev/CLI
 * run (or any deploy where `BEACON_TENANT_ID` is set to a CUSTOMER tenant, e.g.
 * `tenant-iranopedia`), the gate fired for the customer and served them the
 * founder's global "Ritz Builders" config — a cross-tenant brand leak onto a
 * customer surface ("Who AI thinks you are" rendered "Ritz Builders" for
 * Iranopedia). Non-founder tenants resolve via their per-tenant file (priority
 * c), their `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` entry (priority a), or their
 * own `business_config` Supabase row (hydrate) — never the founder's global file.
 *
 * `tenant-ritz-founder` is the well-known founder id across the codebase
 * (seed-data owner, tenant-features all-on fallback, tenant-context dev hint).
 * Kept overridable via `BEACON_FOUNDER_TENANT_ID` for non-Ritz founder deploys.
 * Read lazily (function, not module-load constant) so an env override set after
 * module init — and the test suite's per-case env — is honored.
 */
function founderTenantId(): string {
  const override = process.env.BEACON_FOUNDER_TENANT_ID;
  return typeof override === "string" && override.length > 0
    ? override
    : "tenant-ritz-founder";
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
  // Universal directory/aggregator blocklist — AI-answer sources that pollute
  // ANY vertical's leaderboard (not real competitors). De-verticalized
  // (2026-06-15): dropped the home-services-specific directories
  // (houzz/angi/thumbtack/homeadvisor/buildzoom — those belong in a builder
  // tenant's OWN config, not the universal placeholder) and kept only
  // cross-industry channels.
  directoryDomains: [
    "yelp.com",
    "reddit.com",
    "bbb.org",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "nextdoor.com",
    "google.com",
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
  // Tenant data dirs are keyed by SLUG on disk (.data/tenants/<slug>/).
  // Try the id-named dir (legacy), then the slug dir when the CLI env
  // pair (BEACON_TENANT_ID + BEACON_TENANT_SLUG) identifies this exact
  // tenant — scan/poll/generation matrix jobs always set both.
  let candidate = path.join(TENANTS_DIR, tenantId, "business-config.json");
  if (!existsSync(candidate)) {
    const envSlug = process.env.BEACON_TENANT_SLUG;
    if (
      typeof envSlug === "string" &&
      envSlug.length > 0 &&
      process.env.BEACON_TENANT_ID === tenantId
    ) {
      candidate = path.join(TENANTS_DIR, envSlug, "business-config.json");
    }
  }
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
 * North-star onboarding (2026-06-11) — per-tenant "Supabase hydrate
 * already attempted" memo. Prevents every placeholder render from
 * re-querying the `business_config` table when the tenant genuinely has
 * no row yet. Cleared per tenant on save (a new row may now exist) and
 * by `__resetBusinessConfigCacheForTests`.
 */
const _supabaseHydrateAttempted = new Set<string>();

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

  // P0 wall 3 fix (2026-06-10): the per-tenant file now BEATS the
  // legacy env-named chain. Pre-fix, any per-tenant CLI job (matrix
  // scan/generation sets BEACON_TENANT_ID=<that tenant>) fell into the
  // legacy branch and read the GLOBAL business-config file — serving
  // tenant B the founder tenant's config (caught live: Iranopedia
  // classified with Ritz's urlPatterns). A tenant with its own config
  // file gets its own config, full stop; the legacy chain remains as
  // the founder-deploy fallback for tenants WITHOUT a per-tenant file.
  const fromTenantFile = readConfigFromTenantFile(tenantId);
  if (fromTenantFile !== null) return mergeWithPlaceholder(fromTenantFile);

  // ISOLATION-CRITICAL (2026-06-15): the legacy single-tenant chain
  // (`BEACON_BUSINESS_CONFIG_JSON` env blob + `.data/business-config.json` +
  // `.data/global/business-config.json`) is the FOUNDER's config — the global
  // file literally carries the founder's brand. It may serve ONLY the founder
  // tenant. The previous gate (`tenantId === process.env.BEACON_TENANT_ID`)
  // served whichever tenant the deploy/CLI env named, so a per-tenant run with
  // `BEACON_TENANT_ID=<customer>` leaked the founder's "Ritz Builders" config
  // onto that customer's surface. Non-founder tenants resolve via priority a
  // (BY_TENANT env), priority c (per-tenant file) above, or their own Supabase
  // row (hydrate) — never the founder's global file.
  if (tenantId === founderTenantId()) {
    const fromEnv = readConfigFromEnv();
    if (fromEnv !== null) return mergeWithPlaceholder(fromEnv);
    const fromFile = readConfigFromFiles();
    if (fromFile !== null) return mergeWithPlaceholder(fromFile);
  }

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
  const tenantId = await currentTenantId();
  const resolved = getBusinessConfig(tenantId);
  if (!resolved.__placeholder) return resolved;
  // North-star onboarding (2026-06-11): the sync chain (env → files)
  // came up empty. On Vercel `.data` doesn't exist, so a self-served
  // tenant's only durable config channel is its per-tenant Supabase row
  // — consult it before settling for the placeholder.
  const hydrated = await hydrateBusinessConfigFromSupabase(tenantId);
  return hydrated ?? resolved;
}

/**
 * North-star onboarding (2026-06-11) — hosted per-tenant config read.
 *
 * Reads the `business_config` Supabase row keyed by `tenantId` (written
 * by `saveBusinessConfig` via `syncTenantBusinessConfig`) and caches the
 * merged result. This is what makes a stranger's onboarding-saved config
 * actually resolve on Vercel, where the file chain can never exist and
 * the only pre-existing channel was the operator-hand-written
 * `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` env blob.
 *
 * Returns null (and memoizes the miss) when the tenant has no row —
 * callers keep the placeholder. Failure-soft: any Supabase error returns
 * null rather than crashing a render.
 */
export async function hydrateBusinessConfigFromSupabase(
  tenantId: string,
): Promise<BusinessConfig | null> {
  // Run the SYNC chain first so the operator's env-blob / file config
  // always beats the Supabase row (priority a–c before d') — a cron
  // calling hydrate as its first config touch must not invert the
  // resolution order.
  const resolved = getBusinessConfig(tenantId);
  if (!resolved.__placeholder) return resolved;
  if (_supabaseHydrateAttempted.has(tenantId)) return null;
  _supabaseHydrateAttempted.add(tenantId);
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("business_config")
      .select("data")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data?.data) return null;
    const merged = mergeWithPlaceholder(data.data as Partial<BusinessConfig>);
    _cacheByTenant.set(tenantId, merged);
    return merged;
  } catch {
    return null;
  }
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

  // MT-1 back-compat: the env-named tenant keeps writing the shared
  // top-level file so the operator's /settings/config save path is
  // byte-identical to today.
  // audit-wave6 #7: gate the shared TOP-LEVEL config write on the FOUNDER tenant
  // (symmetric with the read gate), not raw BEACON_TENANT_ID — otherwise a deploy
  // with BEACON_TENANT_ID set to a CUSTOMER tenant would write that customer's
  // config into the founder's shared file.
  if (process.env.VERCEL !== "1" && tenantId === founderTenantId()) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TOP_LEVEL_CONFIG_PATH, JSON.stringify(updated, null, 2));
  }
  // North-star onboarding (2026-06-11) — the "later MT slice" lands:
  // EVERY tenant's save persists to its own per-tenant file
  // (.data/tenants/<tenantId>/business-config.json — the exact path
  // resolution priority (c) already reads), so a save survives a
  // process restart instead of living only in the in-memory cache.
  if (process.env.VERCEL !== "1") {
    const tenantDir = path.join(TENANTS_DIR, tenantId);
    if (!existsSync(tenantDir)) mkdirSync(tenantDir, { recursive: true });
    writeFileSync(
      path.join(tenantDir, "business-config.json"),
      JSON.stringify(updated, null, 2),
    );
  }
  _cacheByTenant.set(tenantId, updated);
  // A fresh save invalidates the "no Supabase row" memo so the next
  // hydrate sees the new row.
  _supabaseHydrateAttempted.delete(tenantId);
  // Fire-and-forget: saveBusinessConfig is synchronous, dual-write is
  // async best-effort. The per-tenant row is the hosted source of truth
  // (read back by hydrateBusinessConfigFromSupabase); the legacy
  // singleton row (id="current") keeps the env-named tenant's
  // pre-multi-tenant channel byte-identical.
  syncTenantBusinessConfig(tenantId, updated).catch(() => {});
  // audit-wave6 #7: the legacy singleton "current" Supabase row belongs to the
  // FOUNDER tenant — gate on founderTenantId() (symmetric with the read path) so
  // a customer save can't overwrite the founder's singleton.
  if (tenantId === founderTenantId()) {
    syncBusinessConfig(updated).catch(() => {});
  }
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
  _supabaseHydrateAttempted.clear();
}

// MT-3C.2 (2026-05-23) — `config` is REQUIRED (no no-arg fallback). The
// only runtime caller is the pure page extractor, which now resolves the
// per-tenant config from its `tenantId` param and injects it.
export function getLocationRegex(config: BusinessConfig): RegExp {
  const terms =
    config.locationTerms.length > 0
      ? config.locationTerms
      : config.locations;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

export function getServiceRegex(config: BusinessConfig): RegExp {
  const terms =
    config.serviceTerms.length > 0
      ? config.serviceTerms
      : config.services;
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
