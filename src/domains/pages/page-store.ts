/**
 * Sprint 7 Phase 7.5c/3 (2026-04-25) — module-level page-list lift.
 *
 * Pre-7.5c: page-store exported a top-level-await snapshot keyed at module
 * init with whatever env tenant the runtime had on first import. Wrong for
 * multi-tenant.
 *
 * Post-7.5c: `getOwnedPages()` is a lazy async function. Each call resolves
 * the active tenant via `currentTenantId()` and fetches through the
 * tenant-scoped repository. The `forTenant(tenantId).getPages()` chain
 * pushes the filter to Postgres (or in-memory filter on the file backend),
 * so multi-tenant correctness comes for free.
 *
 * Naming kept as `getOwnedPages` per directive — the returned array
 * contains every PageEntity for the tenant (both `is_owned=true` and
 * external rows, matching the legacy semantics). Consumers that need only
 * is_owned rows must filter explicitly.
 */

import "server-only";

import { cache } from "react";

import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { PageEntity, PageSummary } from "./types";

/**
 * Perf+egress bundle (2026-05-12) — `React.cache`-wrapped so a single
 * render that consumes pages from multiple call sites (e.g.
 * `/today` calls `getOwnedPages()` once in the top-level loader AND
 * again inside the top-pick branch) only pays one Supabase round-trip
 * per request.
 *
 * The cache is **per-request** (React's `cache` API resets between
 * requests by design) so:
 *   • Tenant isolation: each request resolves `currentTenantId()`
 *     fresh, and the cache key is tied to the request scope — no
 *     cross-tenant leak risk.
 *   • Data freshness: a write that happens on request N is visible
 *     to request N+1; only a single request's repeated reads share
 *     the same array.
 *
 * Naming kept as `getOwnedPages` per Sprint 7 Phase 7.5c/3 directive
 * — the returned array contains every PageEntity for the tenant
 * (both `is_owned=true` and external rows, matching legacy
 * semantics). Consumers that need only is_owned rows must filter
 * explicitly.
 */
export const getOwnedPages = cache(async (): Promise<PageEntity[]> => {
  const tenantId = await currentTenantId();
  return getRepository().forTenant(tenantId).getPages();
});

/**
 * Perf+egress bundle 2 (2026-05-12) — narrow projection of
 * `getOwnedPages` for callers that only need URL → id lookup,
 * ownership classification, or page-type filtering. ~6 columns
 * instead of the full 20-field row.
 *
 * Same per-request `React.cache` semantics as `getOwnedPages` —
 * each request resolves `currentTenantId()` fresh inside the
 * cached body so tenants never see each other's data. The cache
 * key is the function identity AND the (zero) arguments; a write
 * on request N is visible to request N+1.
 *
 * Use this helper when the caller's needs fit inside `PageSummary`.
 * Callers that touch `city`, `service`, `title_last_seen`,
 * `discovery_sources`, `metadata`, `changelog_ids`, or any of the
 * other PageEntity-only fields MUST stay on `getOwnedPages()`.
 */
export const getOwnedPageSummaries = cache(
  async (): Promise<PageSummary[]> => {
    const tenantId = await currentTenantId();
    return getRepository().forTenant(tenantId).getPageSummaries();
  },
);
