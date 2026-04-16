/**
 * Tenant context — resolves the current tenant for server components.
 *
 * v1 resolution order:
 *   1. BEACON_TENANT_ID env var (dev switching + scripts)
 *   2. Default: "tenant-ritz-founder"
 *
 * CX7 replaces this with Clerk session-based tenant resolution.
 * Until then, the env var is the only switching mechanism.
 */

import "server-only";

import { getTenantOrThrow } from "@/domains/tenants/store";
import type { BeaconTenant } from "@/domains/tenants/types";

const DEFAULT_TENANT_ID = "tenant-ritz-founder";

/**
 * Returns the active tenant ID. Never returns null — always resolves
 * to at least the founder tenant. Throws only if the resolved ID
 * doesn't exist in the tenant store (via `currentTenant()`).
 */
export function currentTenantId(): string {
  return process.env.BEACON_TENANT_ID ?? DEFAULT_TENANT_ID;
}

/**
 * Returns the full tenant record for the current context.
 * Throws a clear error if the tenant doesn't exist in the store —
 * this is intentional so misconfigured env vars fail loud.
 */
export function currentTenant(): BeaconTenant {
  return getTenantOrThrow(currentTenantId());
}
