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

import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { PageEntity } from "./types";

export async function getOwnedPages(): Promise<PageEntity[]> {
  const tenantId = await currentTenantId();
  return getRepository().forTenant(tenantId).getPages();
}
