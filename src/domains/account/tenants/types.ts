/**
 * Canonical Account and Website records (Product Truth: Account model).
 *
 * One account represents one business and exactly one website. The Account is
 * backed by the physical `tenants` row; the Website is a typed projection of
 * that row's domain identity, not a subsystem. Structured business truth
 * (name, type, topics, locations, competitors, constraints) lives in the
 * canonical BusinessProfile backed by the tenant-keyed `business_config` row.
 *
 * Legacy vertical columns on the `tenants` table (segment, project_mix,
 * cities_served, budget_range, publish_target, role, email_frequency,
 * discovered_competitors) remain physically present for historical rows but
 * are not part of this record and are never read or written by application
 * code. Every persisted entity carries a `tenant_id` referencing Account.id;
 * all reads filter by it, fail-closed.
 */

export type AccountStatus = "active" | "paused" | "cancelled" | "pending_onboarding";

export type Account = {
  id: string;                     // "tenant-<slug>" — the tenant_id every row carries
  slug: string;                   // URL-safe
  /**
   * INTERNAL provisional signup seed (the physical tenants.business_name
   * column), readable only by pre-activation onboarding code. It is NOT a
   * business-name authority: every active customer surface and evidence
   * decision reads the canonical BusinessProfile name, with the Website
   * domain as the fallback identity.
   */
  provisional_name: string;
  /** The account's one canonical domain. Consumers of URL identity use websiteOf(). */
  domain: string;
  /**
   * Account lifecycle.
   * - `pending_onboarding`: row created at signup; onboarding not finished.
   * - `active`: the one live state background work may run for.
   * - `paused` / `cancelled`: must still resolve (data never orphaned) but
   *   consume zero paid or background work and are never switchable-to.
   */
  status: AccountStatus;
  signup_date: string;
  tos_accepted_at: string | null;
  /** Per-account daily research spend cap in USD (fail-closed). */
  daily_budget_usd: number;
  /** The account's chosen onboarding goal, or null until Step 4 is done. */
  growth_goal: "recover" | "grow" | "balanced" | null;
  created_at: string;
  updated_at: string;
};

/** The account's one canonical domain and URL identity, projected from Account. */
export type Website = {
  account_id: string;
  domain: string;
  canonical_url: string;
};

/** Pure projection: the canonical Website of an Account. */
export function websiteOf(account: Account): Website {
  const domain = (account.domain ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return {
    account_id: account.id,
    domain,
    canonical_url: domain ? `https://${domain}` : "",
  };
}
