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
 * Resolve a tenant's slug from an EXPLICIT id - no ambient headers()/React.cache
 * involved, so this is safe to call from a background context (e.g. next/server's
 * after()) where the request's async context may not reliably carry through. Same
 * resolution order + fallback as currentTenantSlug below, just keyed off an id the
 * caller already has in hand rather than resolving one ambiently.
 *
 * P2-f (2026-07-10, visual audit) - extracted so writers that already thread an
 * explicit tenantId (e.g. changes-data.ts's after() rebuild) can resolve its slug
 * without falling back to the ambient ("wrong tenant in a background task") path.
 */
export async function slugForTenantId(id: string): Promise<string> {
  const tenant = await getTenant(id);
  if (tenant) return tenant.slug;

  // Env fallback - only when the resolved id matches BEACON_TENANT_ID and
  // BEACON_TENANT_SLUG is set. Used during Vercel build/prerender (where
  // headers aren't available and `.data` is gitignored) and as a runtime
  // emergency override matching the BEACON_TENANT_ID env pattern above.
  const envId = process.env.BEACON_TENANT_ID;
  const envSlug = process.env.BEACON_TENANT_SLUG;
  if (envId && envSlug && envId === id) {
    return envSlug;
  }

  throw new Error(
    `slugForTenantId: tenant ${id} not found in store. ` +
      "Set BEACON_TENANT_SLUG (alongside BEACON_TENANT_ID) for environments " +
      "where the tenants registry isn't available (e.g. Vercel build/runtime " +
      "where `.data/global/tenants.json` is gitignored), or run " +
      "scripts/onboard-tenant.ts (Phase 7.10) to seed the registry.",
  );
}

/**
 * Returns the slug for the current tenant by resolving the ID through
 * the tenant store. Used by `.data/` pathing helpers (Phase 7.8 will
 * flip the default flat layout to per-tenant subdirs).
 *
 * Resolution order:
 *   1. Tenant registry lookup (`.data/global/tenants.json`). Authoritative
 *      when present - the registry is the only place slugs are persisted.
 *   2. Env fallback `BEACON_TENANT_SLUG`, BUT ONLY when the resolved id
 *      matches `BEACON_TENANT_ID`. This guards the Vercel-build /
 *      Vercel-runtime path where `.data` is not on the lambda
 *      filesystem (gitignored; not bundled). Without this fallback, every
 *      tenant-aware route prerender threw at `getTenant(id) === null`.
 *      The id-match check prevents a header-set tenant id from masquerading
 *      under the env-set slug.
 *   3. Throw - fail-loud with a message naming both env vars so the
 *      misconfiguration surfaces immediately.
 */
export const currentTenantSlug = cache(async (): Promise<string> => {
  const id = await currentTenantId();
  return slugForTenantId(id);
});
