/**
 * Tenant context — resolves the current tenant for server components,
 * server actions, and route handlers.
 *
 * Sprint 7 Phase 7.3 (2026-04-25): rewritten as async + React.cache-d.
 *
 * Resolution order:
 *   1. Request header `x-beacon-tenant` (set by middleware after auth in
 *      Phase 7.4). Always preferred when present.
 *   2. Env var `BEACON_TENANT_ID` (CLI / scripts / Vercel env emergency
 *      override). Required in environments where middleware hasn't set
 *      the header yet (today: production, until Phase 7.4 ships).
 *   3. Throw — no silent default. The throw is the leak prevention.
 *
 * `headers()` is async in Next 16. Calling it outside a request context
 * throws — the try/catch falls through to env so CLIs and tests work.
 *
 * `React.cache` makes resolution once per request render tree; nested
 * server components sharing the same render don't re-resolve.
 */

import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { getTenantOrThrow, getTenant } from "@/domains/tenants/store";
import type { BeaconTenant } from "@/domains/tenants/types";

/**
 * Returns the active tenant ID. Throws when neither the header nor the
 * env var is set — intentional fail-loud posture so misconfiguration
 * surfaces immediately rather than silently routing to ritz.
 */
export const currentTenantId = cache(async (): Promise<string> => {
  let headerValue: string | null = null;
  try {
    headerValue = (await headers()).get("x-beacon-tenant");
  } catch {
    // Not in a request context (CLI / vitest / module init). Fall through to env.
  }
  if (headerValue) return headerValue;
  if (process.env.BEACON_TENANT_ID) return process.env.BEACON_TENANT_ID;
  throw new Error(
    "currentTenantId: no x-beacon-tenant header and no BEACON_TENANT_ID env var. " +
      "In production this means middleware (Phase 7.4) didn't run. " +
      "In dev/test set BEACON_TENANT_ID=tenant-ritz-founder.",
  );
});

/**
 * Returns the full tenant record for the current context. Throws if the
 * resolved ID doesn't exist in the tenant store — same fail-loud posture
 * as `currentTenantId`.
 */
export const currentTenant = cache(async (): Promise<BeaconTenant> => {
  return await getTenantOrThrow(await currentTenantId());
});

/**
 * Returns the slug for the current tenant by resolving the ID through
 * the tenant store. Used by `.data/` pathing helpers (Phase 7.8 will
 * flip the default flat layout to per-tenant subdirs).
 */
export const currentTenantSlug = cache(async (): Promise<string> => {
  const id = await currentTenantId();
  const tenant = await getTenant(id);
  if (!tenant) {
    throw new Error(
      `currentTenantSlug: tenant ${id} not found in store. ` +
        "Run scripts/onboard-tenant.ts (Phase 7.10) first.",
    );
  }
  return tenant.slug;
});
