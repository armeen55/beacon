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
 *   - @/lib/business-config        (PROCESS-GLOBAL — documented)
 *   - @/lib/local-reviews-store    (request-scoped per tenant via
 *                                   currentTenantSlug — OK)
 *   - @/lib/connector-store        (PROCESS-GLOBAL — documented)
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
 * Multi-tenant prerequisite (documented in catalog row
 * `off-site-authority-multi-tenant-prerequisite`): business-config and
 * connector-store are process-global today. Section 7 customer
 * surfaces (C7d/C7e) MUST NOT ship for Customer 2 until those stores
 * grow tenant-aware routing. C7a's operator-only diagnostic inherits
 * the same boundary; the snapshot's `data_sources_note` surfaces this
 * limitation in-place so it can't be silently overlooked.
 */

import "server-only";

import {
  getBusinessConfig,
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

  const businessConfig = getBusinessConfig();
  const businessConfigIsPlaceholder = isPlaceholderConfig(businessConfig);
  const brandName =
    typeof businessConfig.name === "string" && businessConfig.name.length > 0
      ? businessConfig.name
      : null;

  const googleToken = getGoogleConnectorToken();
  const yelpToken = getYelpConnectorToken();

  const localReviews = await readLocalReviews();

  const computeBusinessConfig: ComputeBusinessConfigInput = {
    name: businessConfig.name,
    industry: businessConfig.industry,
    yelpBusinessId: businessConfig.yelpBusinessId,
    locations: businessConfig.locations,
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
