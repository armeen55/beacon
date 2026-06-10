/**
 * Beacon tenant — the customer identity boundary.
 *
 * Every persisted entity carries a `tenant_id` that references a tenant.
 * All reads filter by tenant_id. The global pattern store (CX4) is the
 * only data that crosses tenants, and it is anonymized by construction.
 */

export type ProjectMixTag =
  | "new_construction"
  | "whole_home_remodel"
  | "kitchen_bath"
  | "adu_addition"
  | "teardown_rebuild"
  | "commercial_residential";

export type BeaconTenantRole = "founder" | "beta_customer" | "paid_customer";

/**
 * 2026-06-10 — multi-property activation. v1 was single-segment
 * (`local_residential_builder`); the union widens ADDITIVELY so every
 * existing row/caller keeps compiling. Cross-tenant brain pattern keys
 * include segment, so patterns never mix across segments by construction.
 *   • local_residential_builder — local-service business (Ritz).
 *   • content_publisher         — content/encyclopedia site (Iranopedia).
 *   • product_app               — product/app property (Finglish).
 */
export type TenantSegment =
  | "local_residential_builder"
  | "content_publisher"
  | "product_app";

/**
 * Per-tenant engine toggles. Absent field → segment default (see
 * `tenant-features.ts`). Lets local-service-shaped engines switch OFF
 * for non-local properties instead of being rewritten.
 */
export type TenantFeatures = {
  /** Local-service surfaces: off-site authority, local pressure, GBP. */
  local_service?: boolean;
  /** CallRail call tracking + calls in outcome copy. */
  call_tracking?: boolean;
  /** City/geo attribution + city-page recommendations. */
  geo_pages?: boolean;
};

export type BeaconTenant = {
  id: string;                           // "tenant-<slug>"
  slug: string;                         // URL-safe
  business_name: string;
  domain: string;
  segment: TenantSegment;
  /** Builder-vertical mix tags. Empty array for non-builder segments. */
  project_mix: ProjectMixTag[];
  cities_served: string[];
  budget_range: "under_1m" | "1m_5m" | "5m_plus" | "mixed";
  /** Optional per-tenant engine toggles; absent → segment defaults. */
  features?: TenantFeatures;
  signup_date: string;
  role: BeaconTenantRole;
  tos_accepted_at: string | null;
  discovered_competitors: string[];
  /** Per-tenant daily API budget override. Falls back to global default. */
  daily_budget_usd: number;
  /**
   * Tenant lifecycle state.
   * - `pending_onboarding` (Gap B, 2026-05-07): row created by signup
   *   flow; user has NOT completed the /onboard wizard yet. Excluded
   *   from cron polling (Gap A's list-active-tenants filters on
   *   status='active'). Migrates to 'active' once onboarding completes.
   * - `active`: included in daily polling.
   * - `paused`: deliberately suspended by operator/customer.
   * - `cancelled`: closed account.
   */
  status: "active" | "paused" | "cancelled" | "pending_onboarding";
  /** Email frequency for digest. */
  email_frequency: "weekly" | "immediate_only" | "off";
  created_at: string;
  updated_at: string;
};
