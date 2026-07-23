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

import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { headers } from "next/headers";

import { getTenantOrThrow, getTenant } from "@/domains/account/tenants/store";
import type { BeaconTenant } from "@/domains/account/tenants/types";

/**
 * Explicit-tenant override (2026-07-11, refresh-reliability wave, BUG 1).
 *
 * A cron fan-out warms MANY tenants inside ONE request. The header/env chain
 * below resolves ONE ambient tenant per request, so a fan-out that warmed
 * tenant B inline (the parent request's ambient = BEACON_TENANT_ID = ritz)
 * had every store (and warm-caches' own cross-tenant guard) resolve to
 * ritz, silently skipping the tenant it meant to warm. (Root cause of the
 * "the active tenant context is tenant-ritz-founder, not tenant-iranopedia,
 * so we skipped to protect its caches" skips.)
 *
 * `runWithTenant(id, fn)` carries an EXPLICIT tenant end-to-end: inside the
 * callback (and everything it awaits) `currentTenantId()` / `currentTenant()`
 * / `currentTenantSlug()` resolve to `id`, regardless of the request header or
 * BEACON_TENANT_ID. The override is checked BEFORE the React.cache-d resolvers,
 * so warming tenant A then tenant B in the SAME request resolves each one
 * correctly instead of returning the first render's memoized value. The guard
 * still protects genuine cross-tenant work: with NO override, ambient !=
 * requested tenant trips it exactly as before.
 */
const tenantOverride = new AsyncLocalStorage<string>();

/** Run `fn` with `tenantId` as the explicit ambient tenant for its whole async
 *  subtree. Used by the precompute cron so each tenant warms under ITS OWN
 *  context without a per-tenant HTTP self-call (see route.ts). */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantOverride.run(tenantId, fn);
}

/** The header/env resolution, memoized per request render tree. Kept as an
 *  inner cached resolver so the override above can win WITHOUT being trapped by
 *  the memo (a fan-out resolves multiple tenants in one request). */
const resolveTenantIdFromRequest = cache(async (): Promise<string> => {
  let headerValue: string | null = null;
  // Belt-and-suspenders (2026-07-18 tenant-safety fix): distinguish "no request
  // context at all" from "request context but the middleware failed to inject the
  // header". The first is legitimate (CLI / scripts / vitest / module init) and
  // uses the env quietly. The second means an authenticated request is about to
  // silently resolve to BEACON_TENANT_ID (which names ritz in prod) — the exact
  // shape of the incident — so we warn LOUDLY naming the env tenant. We do NOT
  // throw: middleware now redirects/honors-the-cookie on lookup failure, so this
  // path should be unreachable for authenticated requests, but if it ever fires
  // the log is the tripwire. Throwing here would also break the legitimate
  // headers()-succeeded-but-genuinely-header-free machine paths.
  let inRequestContext = false;
  try {
    headerValue = (await headers()).get("x-beacon-tenant");
    inRequestContext = true;
  } catch {
    // Not in a request context (CLI / vitest / module init). Fall through to env.
  }
  if (headerValue) return headerValue;
  // SaaS-foundation hardening (CORE 100K, 2026-07-22): an AUTHENTICATED request
  // must NEVER fall back to the env tenant. The middleware always injects
  // x-beacon-tenant for an authenticated user with a resolved tenant, so a
  // missing header inside a real request means auth/middleware failed — fail
  // closed rather than silently resolve to BEACON_TENANT_ID (a cross-tenant
  // leak). The env fallback survives ONLY for the explicit auth-disabled bypass
  // (BEACON_AUTH_DISABLED=1: local audit + CLI) and for out-of-request contexts
  // (scripts / module init / vitest), which are never authenticated user traffic.
  const authBypass = process.env.BEACON_AUTH_DISABLED === "1";
  if (inRequestContext && !authBypass) {
    throw new Error(
      "currentTenantId: authenticated request has no x-beacon-tenant header. " +
        "The middleware did not resolve a tenant for this user; failing closed " +
        "rather than falling back to an env tenant (cross-tenant leak guard).",
    );
  }
  if (process.env.BEACON_TENANT_ID) {
    return process.env.BEACON_TENANT_ID;
  }
  throw new Error(
    "currentTenantId: no x-beacon-tenant header and no BEACON_TENANT_ID env var. " +
      "In production this means middleware (Phase 7.4) didn't run. " +
      "In dev/test set BEACON_TENANT_ID=tenant-ritz-founder.",
  );
});

/**
 * Returns the active tenant ID. An explicit `runWithTenant` override wins;
 * otherwise resolves via the request header then BEACON_TENANT_ID. Throws when
 * neither is set, an intentional fail-loud posture so misconfiguration surfaces
 * immediately rather than silently routing to ritz.
 */
export const currentTenantId = async (): Promise<string> => {
  const override = tenantOverride.getStore();
  if (override) return override;
  return resolveTenantIdFromRequest();
};

const resolveTenantFromRequest = cache(async (): Promise<BeaconTenant> => {
  return await getTenantOrThrow(await resolveTenantIdFromRequest());
});

/**
 * Returns the full tenant record for the current context. Throws if the
 * resolved ID doesn't exist in the tenant store — same fail-loud posture
 * as `currentTenantId`. Honors the `runWithTenant` override.
 */
export const currentTenant = async (): Promise<BeaconTenant> => {
  const override = tenantOverride.getStore();
  if (override) return await getTenantOrThrow(override);
  return resolveTenantFromRequest();
};

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
const resolveTenantSlugFromRequest = cache(async (): Promise<string> => {
  const id = await resolveTenantIdFromRequest();
  return slugForTenantId(id);
});

export const currentTenantSlug = async (): Promise<string> => {
  const override = tenantOverride.getStore();
  if (override) return slugForTenantId(override);
  return resolveTenantSlugFromRequest();
};
