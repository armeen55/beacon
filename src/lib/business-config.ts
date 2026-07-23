import "server-only";

import { EVENT_PRIORS_V1 as EVENT_PRIORS_V1_SOURCE } from "@/lib/event-priors";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";

/** Re-export for code that imports the priors from this module. */
export const EVENT_PRIORS_V1 = EVENT_PRIORS_V1_SOURCE;

/**
 * Canonical BusinessProfile (Product Truth: canonical business records).
 *
 * The structured, confirmed truth about one account's business, backed by
 * the tenant-keyed `business_config` Supabase row (JSONB). One authority:
 * the confirmed business name and structured facts live HERE; the Account
 * row's business_name is only the signup seed, and the Website projection
 * owns domain identity.
 *
 * Resolution is per-account and fail-generic: in-memory cache, then the
 * account's own Supabase row, then the neutral placeholder. There is no
 * env-blob, no shared file, no founder fallback, and no path that can
 * resolve another business's profile. Tests inject state via
 * setBusinessProfileForTests / setBusinessProfileRepositoryForTests.
 */
export interface BusinessProfile {
  name: string;
  domain: string;
  industry: string;
  /** The account's monthly-visit goal. Per-account DATA; unset = no goal line renders. */
  monthlyVisitGoal?: number | null;
  /**
   * Content-site classification mode. When true (encyclopedias, blogs, docs
   * sites), HTML pages that aren't homepage/hub/utility/asset classify as
   * "content" detail pages instead of falling to "other". Local-service
   * sites leave this unset.
   */
  contentSiteMode?: boolean;
  /**
   * The derived business TYPE — the canonical classification (the legacy
   * tenants.segment column is not read):
   *   • local_service     — serves customers in physical places; `locations`
   *     are its service areas.
   *   • content_publisher — encyclopedia/blog/news/docs; no service areas.
   *   • ecommerce         — sells products online; no service areas.
   *   • saas              — software product/app; no service areas.
   *   • other             — ambiguous; local engines stay off until confirmed.
   * Derived from the account's own data; a manually confirmed value is
   * pinned and never clobbered by re-derivation.
   */
  businessType?: "local_service" | "content_publisher" | "ecommerce" | "saas" | "other";
  /**
   * Per-account CONTENT RULES: plain-English rules every generation for this
   * account must follow. Violations of `flaggedTerms` are hard-rejected.
   * Per-account config — never hardcoded vocabulary.
   */
  contentRules?: string[];
  /** Banned terms enforced by the draft validator (word-boundary, case-sensitive). */
  flaggedTerms?: string[];
  /**
   * Account-curated domains that count as AUTHORITATIVE sources for this
   * account's factual-source gate, on top of the universal .gov/.edu +
   * encyclopedic/major-press set (source-authority.ts). Per-account DATA,
   * never code. Unset = only the universal set applies.
   */
  authoritativeSourceDomains?: string[];
  /**
   * First-mention rule for an account whose content names terms in a
   * non-English script: `native` is the Unicode range checked at first
   * mention; `transliteration` requires a Latin rendering alongside;
   * `englishContext` requires a short English gloss. A miss is a soft
   * "worth a look", never a hard block. Null/absent = contributes nothing.
   */
  firstMention?: { native: string; transliteration: boolean; englishContext: boolean } | null;
  /**
   * Operator-set unit economics. Multiplied by real measured traffic to
   * label estimated dollars as "your rate x real traffic", never a measured
   * payout. Unset = dormant, no estimated dollars appear.
   */
  revenueModel?: {
    kind: "rpm" | "per_lead";
    rpmUsd?: number;
    dollarsPerLead?: number;
  };
  phone: string;
  address: string;
  /** Yelp Fusion business id or alias (Settings → Connectors → Yelp sync). */
  yelpBusinessId: string;
  /**
   * Operator-entered off-site profile URLs. "" = not configured; a value
   * must begin with https:// or http:// (validated downstream). Beacon does
   * not HTTP-verify these; the operator vouches for them.
   */
  houzzProfileUrl: string;
  angiProfileUrl: string;
  bbbProfileUrl: string;
  industryDirectoryProfileUrl: string;
  locations: string[];
  services: string[];
  primaryCompetitors: string[];
  keyPages: string[];
  locationTerms: string[];
  serviceTerms: string[];
  directoryDomains: string[];
  /** Duplicate of scan settings — prefer `getScanSettings()` for runtime truth. */
  scanSettings: {
    preferredHour: number;
    timezone: string;
    scope: "priority" | "full";
    enabled: boolean;
  };

  // Domain knowledge — drives section analysis, page-type inference, and FAQ
  // generation. These fields keep Beacon portable across industries.

  /** URL path prefixes that identify page types (e.g. city/service/project). */
  urlPatterns?: {
    city?: string;
    service?: string;
    project?: string;
  };
  /** Words stripped when normalizing H2s for section comparison (brand words, geography). */
  stripWords?: string[];
  /** Additional section themes beyond the universal set. */
  industryThemes?: { pattern: string; label: string; display: string }[];
  /** FAQ question templates keyed by topic-matching pattern; first match wins. */
  faqTemplates?: { topicPattern: string; questions: string[] }[];
  /**
   * Static edit-type priors used when scoring sitewide rollouts. Every use
   * MUST carry `confidence_source: "seed_prior"` so seed priors never
   * masquerade as learned truth.
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
   * True only on the neutral placeholder (no confirmed profile found).
   * Consumer surfaces branch on this to show a "configuration needed"
   * affordance instead of pretending to be a real business. Real loaded
   * profiles MUST omit this field.
   */
  __placeholder?: true;
}

/**
 * Neutral placeholder profile. All brand-shaped fields are EMPTY or
 * generic; domain-knowledge fields are minimal/universal; the
 * `__placeholder: true` flag pins detection. No business, vertical,
 * geography, or provider literal may ever appear here.
 */
const PLACEHOLDER_PROFILE: BusinessProfile = {
  name: "",
  domain: "",
  industry: "",
  phone: "",
  address: "",
  yelpBusinessId: "",
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
  // ANY vertical's leaderboard (not real competitors). Cross-industry only.
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
    // Default OFF — an account with no confirmed profile should not
    // auto-trigger scans until it explicitly opts in.
    enabled: false,
  },
  urlPatterns: undefined,
  stripWords: undefined,
  industryThemes: undefined,
  faqTemplates: undefined,
  event_priors_v1: { ...EVENT_PRIORS_V1 },
  __placeholder: true,
};

/** Is the resolved profile the neutral placeholder ("configuration needed")? Pure. */
export function isPlaceholderProfile(profile: BusinessProfile): boolean {
  return profile.__placeholder === true;
}

/** Per-account profile cache. Keyed by canonical tenantId, never by slug. */
const _cacheByTenant = new Map<string, BusinessProfile>();
/** One-time-per-account placeholder warning memo. */
const _placeholderWarnedTenants = new Set<string>();
/** Per-account "Supabase hydrate already attempted" memo. */
const _supabaseHydrateAttempted = new Set<string>();

/** Injected persistence for the profile row. Production default = Supabase. */
export type BusinessProfileRepository = {
  load(tenantId: string): Promise<Partial<BusinessProfile> | null>;
  save(tenantId: string, profile: BusinessProfile): Promise<{ ok: boolean; reason?: string }>;
};

const supabaseProfileRepository: BusinessProfileRepository = {
  async load(tenantId) {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const { data, error } = await getSupabaseAdmin()
      .from("business_config")
      .select("data")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data?.data) return null;
    return data.data as Partial<BusinessProfile>;
  },
  async save(tenantId, profile) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
      const { error } = await getSupabaseAdmin()
        .from("business_config")
        .upsert(
          { id: tenantId, data: profile as unknown as Record<string, unknown>, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
      if (error) return { ok: false, reason: error.message.slice(0, 300) };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message.slice(0, 300) : "unknown" };
    }
  },
};

let profileRepository: BusinessProfileRepository = supabaseProfileRepository;

/** Tests inject an in-memory repository; pass null to restore production. */
export function setBusinessProfileRepositoryForTests(
  repo: BusinessProfileRepository | null,
): void {
  profileRepository = repo ?? supabaseProfileRepository;
}

/** Test seam: seed the resolved profile for an account directly (sync readers see it). */
export function setBusinessProfileForTests(
  tenantId: string,
  patch: Partial<BusinessProfile>,
): void {
  _cacheByTenant.set(tenantId, mergeWithPlaceholder(patch));
}

function warnPlaceholderOnce(tenantId: string): void {
  if (_placeholderWarnedTenants.has(tenantId)) return;
  _placeholderWarnedTenants.add(tenantId);
  log.warn(
    "[business-profile] no confirmed profile for this account — running on the neutral placeholder until onboarding confirms one.",
    { tenantId },
  );
}

/**
 * Synchronous profile read for an account: cache, else the neutral
 * placeholder. The durable Supabase row is consulted by the async paths
 * (getBusinessProfileForCurrentTenant / hydrateBusinessProfile), which
 * fill this cache. Missing configuration always resolves generically —
 * never another business's data.
 */
export function getBusinessProfile(tenantId: string): BusinessProfile {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("getBusinessProfile(): tenantId is required.");
  }
  const cached = _cacheByTenant.get(tenantId);
  if (cached) return cached;
  warnPlaceholderOnce(tenantId);
  return PLACEHOLDER_PROFILE;
}

/**
 * Async entry point for server components / actions / loaders: resolves the
 * current account and returns its profile, consulting the durable Supabase
 * row before settling for the placeholder.
 */
export async function getBusinessProfileForCurrentTenant(): Promise<BusinessProfile> {
  const tenantId = await currentTenantId();
  const resolved = getBusinessProfile(tenantId);
  if (!resolved.__placeholder) return resolved;
  const hydrated = await hydrateBusinessProfile(tenantId);
  return hydrated ?? resolved;
}

/**
 * Durable per-account profile read: loads the account's `business_config`
 * row through the injected repository and caches the merged result.
 * Returns null (and memoizes the miss) when the account has no row.
 * Failure-soft: an error returns null rather than crashing a render.
 */
export async function hydrateBusinessProfile(
  tenantId: string,
): Promise<BusinessProfile | null> {
  const cached = _cacheByTenant.get(tenantId);
  if (cached && !cached.__placeholder) return cached;
  if (_supabaseHydrateAttempted.has(tenantId)) return null;
  _supabaseHydrateAttempted.add(tenantId);
  try {
    const loaded = await profileRepository.load(tenantId);
    if (!loaded) return null;
    const merged = mergeWithPlaceholder(loaded);
    _cacheByTenant.set(tenantId, merged);
    return merged;
  } catch {
    return null;
  }
}

/** Overlay real values on the placeholder so missing fields never crash
 *  consumers; strips the placeholder marker and any legacy provider keys. */
function mergeWithPlaceholder(loaded: Partial<BusinessProfile>): BusinessProfile {
  const cleaned = { ...loaded } as Record<string, unknown>;
  delete cleaned.__placeholder;
  // Legacy provider-scoping keys from removed connectors may persist in old
  // rows; they are not part of the canonical profile and are never read.
  delete cleaned.profound;
  const merged: BusinessProfile = { ...PLACEHOLDER_PROFILE, ...(cleaned as Partial<BusinessProfile>) };
  delete merged.__placeholder;
  return merged;
}

export type SaveBusinessProfileResult = {
  profile: BusinessProfile;
  /** True when the durable Supabase write landed. Callers that must not
   *  proceed on a lost write (onboarding launch) check this. */
  persisted: boolean;
  persistError?: string;
};

/**
 * Save a profile patch for an account. Single write path: the account's
 * own Supabase `business_config` row. The merged profile is cached for
 * this process so sync readers see it immediately.
 */
export async function saveBusinessProfile(
  tenantId: string,
  patch: Partial<BusinessProfile>,
): Promise<SaveBusinessProfileResult> {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("saveBusinessProfile(): tenantId is required.");
  }
  const current = _cacheByTenant.get(tenantId) ?? (await hydrateBusinessProfile(tenantId)) ?? PLACEHOLDER_PROFILE;
  const updated = mergeWithPlaceholder({ ...current, ...patch });
  _cacheByTenant.set(tenantId, updated);
  // A fresh save invalidates the "no row" memo so the next hydrate re-reads.
  _supabaseHydrateAttempted.delete(tenantId);
  const saved = await profileRepository.save(tenantId, updated);
  return { profile: updated, persisted: saved.ok, persistError: saved.reason };
}

/** Test-only — reset caches so resolution re-runs per test. */
export function __resetBusinessProfileCacheForTests(): void {
  _cacheByTenant.clear();
  _placeholderWarnedTenants.clear();
  _supabaseHydrateAttempted.clear();
}

/** Location term matcher from the profile; never-match when unset. Pure. */
export function getLocationRegex(profile: BusinessProfile): RegExp {
  const terms =
    profile.locationTerms.length > 0 ? profile.locationTerms : profile.locations;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

/** Service term matcher from the profile; never-match when unset. Pure. */
export function getServiceRegex(profile: BusinessProfile): RegExp {
  const terms =
    profile.serviceTerms.length > 0 ? profile.serviceTerms : profile.services;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]?"),
  );
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}
