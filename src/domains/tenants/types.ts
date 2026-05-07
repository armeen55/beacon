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

export type BeaconTenant = {
  id: string;                           // "tenant-<slug>"
  slug: string;                         // URL-safe
  business_name: string;
  domain: string;
  /** v1 supports a single segment only. */
  segment: "local_residential_builder";
  project_mix: ProjectMixTag[];
  cities_served: string[];
  budget_range: "under_1m" | "1m_5m" | "5m_plus" | "mixed";
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
