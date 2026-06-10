/**
 * Section 7 C7a (2026-05-16) — Off-Site Authority detection projection
 * types. Pure; no imports of helpers, no runtime logic.
 *
 * Scope: operator-only diagnostic in C7a; customer surfaces C7d (Today
 * off-site tile) + C7e (Recommendations off-site section) now shipped on
 * the tenant-correct path — business-config is tenant-keyed (MT-1+) and
 * connector-store is tenant-scoped per (tenant, provider). The former
 * `off-site-authority-multi-tenant-prerequisite` catalog row is retired.
 */

export type OffSitePresenceChannel =
  | "gbp"
  | "yelp"
  | "houzz"
  | "angi"
  | "bbb"
  | "industry_directory"
  | "local_press";

export type OffSitePresenceSource =
  | "connector_api"
  | "business_config"
  | "manual_operator"
  | "inferred";

export type OffSitePresenceConfidence =
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type OffSiteChannelState = {
  channel: OffSitePresenceChannel;
  /** `true` = confirmed claimed. `false` = confirmed NOT claimed. `null` = unknown (not yet detected). */
  claimed: boolean | null;
  review_count: number | null;
  rating: number | null;
  profile_url: string | null;
  source: OffSitePresenceSource;
  /** ISO 8601 timestamp. For inferred rows = snapshot generation time. */
  last_checked_at: string;
  confidence: OffSitePresenceConfidence;
};

export type OffSitePresenceSnapshot = {
  tenant_id: string;
  /** Display brand name resolved by the loader from `businessConfig.name`. `null` when empty. */
  brand_name: string | null;
  /**
   * `true` only when the tenant's business-config carries a non-empty
   * `industry` AND at least one `location`. Gates Section 7 surfaces
   * per the locked invariant (off-site recs do not apply to
   * non-local-service tenants).
   */
  is_local_service: boolean;
  /** Deterministic order: gbp, yelp, houzz, angi, bbb, industry_directory, local_press. */
  channels: OffSiteChannelState[];
  /**
   * Honest disclosure of each input's tenant-scope provenance. Surfaces
   * verbatim in the operator diagnostic footer so the multi-tenant
   * prerequisite is visible at the point of use.
   */
  data_sources_note: string[];
  generated_at: string;
};
