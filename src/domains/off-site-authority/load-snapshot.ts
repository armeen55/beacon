/**
 * Section 7 C7a (2026-05-16) — Off-Site Authority detection projection,
 * server loader.
 *
 * Single tenant-scope-discipline boundary. The loader is the ONLY
 * module in this domain that imports global / hybrid-scope helpers.
 * Pure modules in this domain receive every input as an argument.
 *
 * Import allowlist (pinned by
 * `tests/architecture/off-site-authority-loader-allowed-imports.test.ts`):
 *   - @/lib/business-config        (tenant-keyed; called as
 *                                   getBusinessConfig(tenantId) — MT-1+)
 *   - @/lib/local-reviews-store    (request-scoped per tenant via
 *                                   currentTenantSlug — OK)
 *   - @/lib/connector-store        (tenant-scoped via composite PK +
 *                                   currentTenantId, 2026-05-16 — OK)
 *   - @/lib/tenant-context         (request-scoped — OK)
 *   - ./types
 *   - ./compute-snapshot
 *
 * Specifically forbidden:
 *   - `getRepository` (no Supabase repository read here)
 *   - `@/lib/connectors/*` (no new connector module wiring)
 *   - `fetch`, `axios`, any HTTP-client identifier
 *   - any LLM-provider identifier
 *
 * Multi-tenant prerequisite — RESOLVED (2026-05-22/23): connector-store
 * has been tenant-scoped since 2026-05-16 (composite PK + currentTenantId);
 * business-config became tenant-keyed in MT-1 and all customer + operator +
 * deep-helper callers were migrated in MT-2/MT-3A/MT-3B/MT-3C(.2). This
 * loader resolves `getBusinessConfig(tenantId)` per request. Section 7
 * customer surfaces C7d (Today tile) + C7e (Recommendations section) now
 * ship on this tenant-correct path. (Only the deprecated no-arg
 * getBusinessConfig() overload remains, pending MT-5.) See catalog row
 * `off-site-authority-multi-tenant-prerequisite`.
 */

import "server-only";

import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
  isPlaceholderConfig,
} from "@/lib/business-config";
import { readLocalReviews } from "@/lib/local-reviews-store";
import {
  getGoogleConnectorToken,
  getYelpConnectorToken,
} from "@/lib/connector-store";
import { currentTenantId } from "@/lib/tenant-context";

import type { OffSitePresenceSnapshot } from "./types";
import {
  computeOffSitePresenceSnapshot,
  type ComputeBusinessConfigInput,
  type ComputeConnectorTokenInput,
  type ComputeLocalReviewInput,
} from "./compute-snapshot";

export type LoadOffSitePresenceSnapshotOptions = {
  /** Override the "now" instant for tests. Defaults to `new Date()`. */
  now?: Date | string;
};

/**
 * Resolve all inputs (tenant id, business config, connector tokens,
 * local reviews) and run the pure compute. `isPlaceholderConfig` is
 * called HERE (not inside the pure compute) so the pure module stays
 * free of any global-helper import.
 */
export async function loadOffSitePresenceSnapshot(
  options: LoadOffSitePresenceSnapshotOptions = {},
): Promise<OffSitePresenceSnapshot> {
  const tenantId = await currentTenantId();

  // MT-2 (2026-05-22) — tenant-aware resolution. tenantId is already in
  // scope (resolved above), so pass it explicitly instead of the
  // deprecated no-arg path. Makes the off-site C7d/C7e data path
  // tenant-correct end-to-end (downstream compute is pure/injected).
  // audit #2 (2026-06-14): hydrate from Supabase so off-site presence sees
  // the tenant's real config on Vercel (sync chain → placeholder there).
  const businessConfig =
    (await hydrateBusinessConfigFromSupabase(tenantId)) ??
    getBusinessConfig(tenantId);
  const businessConfigIsPlaceholder = isPlaceholderConfig(businessConfig);
  const brandName =
    typeof businessConfig.name === "string" && businessConfig.name.length > 0
      ? businessConfig.name
      : null;

  // Off-site authority care-about: GBP review presence. GSC tokens
  // don't satisfy this surface — provider-discriminate explicitly.
  const googleToken = await getGoogleConnectorToken("gbp");
  const yelpToken = await getYelpConnectorToken();

  const localReviews = await readLocalReviews();

  const computeBusinessConfig: ComputeBusinessConfigInput = {
    name: businessConfig.name,
    industry: businessConfig.industry,
    yelpBusinessId: businessConfig.yelpBusinessId,
    locations: businessConfig.locations,
    // Section 7 C7g v1 (2026-05-16) — operator-entered off-site
    // profile URLs threaded into the pure compute. Empty strings
    // keep the corresponding channel inferred/unknown.
    houzzProfileUrl: businessConfig.houzzProfileUrl,
    angiProfileUrl: businessConfig.angiProfileUrl,
    bbbProfileUrl: businessConfig.bbbProfileUrl,
    industryDirectoryProfileUrl: businessConfig.industryDirectoryProfileUrl,
  };

  const computeReviews: ComputeLocalReviewInput[] = localReviews.map((r) => ({
    source: r.source,
    rating: r.rating,
  }));

  const computeGoogleToken: ComputeConnectorTokenInput =
    googleToken != null ? { provider: "google" } : null;
  const computeYelpToken: ComputeConnectorTokenInput =
    yelpToken != null ? { provider: "yelp" } : null;

  const now =
    options.now == null
      ? new Date()
      : options.now instanceof Date
        ? options.now
        : new Date(options.now);

  return computeOffSitePresenceSnapshot({
    tenantId,
    brandName,
    businessConfig: computeBusinessConfig,
    businessConfigIsPlaceholder,
    localReviews: computeReviews,
    googleToken: computeGoogleToken,
    yelpToken: computeYelpToken,
    now,
  });
}
