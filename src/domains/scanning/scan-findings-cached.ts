/**
 * Per-request cached reader for `scan_findings` (perf+egress bundle,
 * 2026-05-12).
 *
 * Background: `today-data.ts` fetches scan findings via
 * `repo.getScanFindings()` and the shell `layout.tsx` reads them via
 * `getPendingFindings()` (the disk-backed shim in
 * `findings-store.ts`). On Vercel, the disk shim returns `[]`
 * because the read-only FS has no `.data/*.json`, so the shell
 * layout's call is effectively a no-op there. Inside one render
 * pipeline that does end up hitting the repo from multiple call
 * sites (e.g. today-data's own pending-vs-resolved split, or a
 * future shell-layout fix that switches to the repo), this cached
 * helper prevents repeat Supabase round-trips.
 *
 * Tenant safety: `React.cache` is scoped per-request. The cache key
 * is the function identity AND the (zero) arguments; each request
 * resolves `currentTenantId()` fresh inside the cached function
 * body, so different requests never see each other's data. A
 * write that happens on request N is visible to request N+1.
 *
 * Freshness impact: zero — the cache evaporates between requests.
 * The only behavior change is "two reads in the SAME request now
 * pay one Supabase round-trip instead of two".
 */
import "server-only";

import { cache } from "react";

import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { Finding } from "./types";

/**
 * Fetch every `scan_findings` row for the current tenant, cached
 * per-request via `React.cache`. Returns the full tenant array;
 * callers filter (e.g. by `status === "pending"`) downstream.
 */
export const getTenantScanFindingsCached = cache(
  async (): Promise<Finding[]> => {
    const tenantId = await currentTenantId();
    return getRepository().forTenant(tenantId).getScanFindings();
  },
);
