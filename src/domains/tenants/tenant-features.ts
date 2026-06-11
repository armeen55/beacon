/**
 * 2026-06-10 — Per-tenant engine toggles (multi-property activation).
 *
 * Local-service-shaped engines (off-site authority, local pressure,
 * CallRail, geo/city recommendations) must not run for a content
 * encyclopedia or a product app. Rather than rewriting those engines,
 * each consults `resolveTenantFeatures` at its seam and renders/skips
 * accordingly.
 *
 * Resolution: explicit per-tenant override (`BeaconTenant.features`)
 * wins; absent fields fall back to SEGMENT defaults. Unknown segment →
 * everything off except core (defensive).
 *
 * PURE resolver + a server loader. Pinned by
 * tests/domains/tenants/tenant-features.test.ts.
 */

import type { BeaconTenant, TenantFeatures, TenantSegment } from "./types";

export type ResolvedTenantFeatures = Required<TenantFeatures>;

const SEGMENT_DEFAULTS: Record<TenantSegment, ResolvedTenantFeatures> = {
  local_residential_builder: {
    local_service: true,
    call_tracking: true,
    geo_pages: true,
  },
  // North-star onboarding (2026-06-11): any non-builder local business
  // (restaurant, dentist, plumber, …) — same toggles as the builder
  // segment; the local engines are vertical-agnostic. Separate label so
  // cross-tenant brain bins stay honest.
  local_service: {
    local_service: true,
    call_tracking: true,
    geo_pages: true,
  },
  content_publisher: {
    local_service: false,
    call_tracking: false,
    geo_pages: false,
  },
  product_app: {
    local_service: false,
    call_tracking: false,
    geo_pages: false,
  },
};

const SAFE_FALLBACK: ResolvedTenantFeatures = {
  local_service: false,
  call_tracking: false,
  geo_pages: false,
};

/** Pure: tenant row → resolved toggles (override > segment default). */
export function resolveTenantFeatures(
  tenant: Pick<BeaconTenant, "segment" | "features"> | null,
): ResolvedTenantFeatures {
  if (tenant == null) return SAFE_FALLBACK;
  const defaults = SEGMENT_DEFAULTS[tenant.segment] ?? SAFE_FALLBACK;
  return {
    local_service: tenant.features?.local_service ?? defaults.local_service,
    call_tracking: tenant.features?.call_tracking ?? defaults.call_tracking,
    geo_pages: tenant.features?.geo_pages ?? defaults.geo_pages,
  };
}

/**
 * Server loader: features for a tenant id. Soft-fails to the segment-
 * default-for-builder when the registry can't be read for the FOUNDER
 * tenant (preserves today's behavior for Ritz on any registry hiccup)
 * and to SAFE_FALLBACK for unknown tenants.
 */
/** Convenience: features for the ambient current tenant. */
export async function getCurrentTenantFeatures(): Promise<ResolvedTenantFeatures> {
  try {
    const { currentTenantId } = await import("@/lib/tenant-context");
    return getTenantFeatures(await currentTenantId());
  } catch {
    return SAFE_FALLBACK;
  }
}

export async function getTenantFeatures(
  tenantId: string,
): Promise<ResolvedTenantFeatures> {
  try {
    const { getTenant } = await import("./store");
    const tenant = await getTenant(tenantId);
    if (tenant != null) return resolveTenantFeatures(tenant);
    // Registry miss: the founder tenant predates the registry in some
    // environments (e.g. hosted, where the json registry isn't present).
    // Ritz keeps its historical all-on behavior; anyone else gets safe-off.
    return tenantId === "tenant-ritz-founder"
      ? SEGMENT_DEFAULTS.local_residential_builder
      : SAFE_FALLBACK;
  } catch {
    return tenantId === "tenant-ritz-founder"
      ? SEGMENT_DEFAULTS.local_residential_builder
      : SAFE_FALLBACK;
  }
}
