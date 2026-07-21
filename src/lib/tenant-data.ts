/**
 * Tenant-filtered data adapters — the isolation boundary.
 *
 * Every route and domain module that reads persisted data MUST go through
 * these adapters instead of calling readStore or seed-data.server.ts
 * directly. Each adapter filters by tenant_id so cross-tenant data never
 * leaks to a consumer.
 *
 * For v1 beta (3 customers), all tenant data lives in the same .data/*.json
 * files and filtering happens in memory. This is fine for <100K records.
 * If Beacon scales beyond ~20 tenants, the filtering should move to
 * Supabase RLS or per-tenant file isolation.
 *
 * Global/aggregate stores (change-patterns, triage-rules, etc.) are NOT
 * exposed here — they have no tenant_id by design. Import them directly
 * from their domain modules.
 *
 * Sprint 7 Phase 7.8b-2-c (2026-04-25): each adapter is async because
 * `readStore` is async (Phase 7.8b-2-b). Filtering still happens
 * synchronously in memory after the routed-or-flat-fallback read
 * resolves.
 */

import "server-only";

import { readStore } from "@/lib/persistence/json-store";
import { listTenants } from "@/domains/tenants/store";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { Finding } from "@/domains/scanning/types";
import type { PageEntity, PageSnapshot } from "@/domains/pages/types";
import type { ObservationRun } from "@/domains/observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ---------------------------------------------------------------------------
// Generic filter
// ---------------------------------------------------------------------------

function filterByTenant<T extends { tenant_id: string }>(
  items: T[],
  tenantId: string,
): T[] {
  return items.filter((item) => item.tenant_id === tenantId);
}

/**
 * S3 (operator audit, 2026-05-05) — legacy-untagged tenant resolver.
 *
 * Some persisted stores (notably `.data/observation-runs.json`) accumulated
 * rows BEFORE the multi-tenant migration tagged every entity with a
 * `tenant_id`. The TS type marks `tenant_id: string` as required, but the
 * persisted JSON predates that contract. Until those rows get tagged on
 * disk (deferred — operator brief: "no recommendation queue mutation"
 * spirit), the read path interprets an undefined `tenant_id` as
 * "belongs to the founder tenant" — the ONLY tenant that ever wrote
 * those rows historically.
 *
 * Tenant isolation guarantees this preserves:
 *   • Queries for the founder tenant include legacy untagged rows.
 *   • Queries for ANY non-founder tenant exclude them entirely (the
 *     untagged → founder mapping pins them; they cannot leak).
 *
 * If/when a real `.data/observation-runs.json` rewrite stamps tenant_id
 * onto every row, the legacy fallback becomes a no-op — safe forward.
 *
 * Resolution looks up the tenant with `role === "founder"` from the
 * tenant store. Cached per process via `cachedFounderId`. Throws when
 * no founder tenant exists (catastrophic configuration; we'd rather
 * fail loud than silently include / exclude legacy rows).
 */
let cachedFounderId: string | null = null;

async function getFounderTenantIdForLegacyFallback(): Promise<string> {
  if (cachedFounderId !== null) return cachedFounderId;
  const tenants = await listTenants();
  const founders = tenants.filter((t) => t.role === "founder");
  // EXACTLY one founder is required and DETERMINISTIC. `listTenants()` returns
  // rows in unspecified order (Supabase has no ORDER BY here), so a plain
  // `.find()` over >1 founder would pick a different tenant per process / per
  // query and bind legacy untagged rows to the wrong tenant — a silent
  // cross-tenant breach. Fail loud on 0 or >1 rather than guess.
  if (founders.length === 0) {
    throw new Error(
      "No tenant with role='founder' found. The legacy-untagged tenant " +
        "resolver requires exactly one founder tenant — check the tenants registry.",
    );
  }
  if (founders.length > 1) {
    throw new Error(
      `Ambiguous founder tenant: ${founders.length} tenants have role='founder' ` +
        `(${founders.map((t) => t.id).join(", ")}). The legacy-untagged resolver requires ` +
        `EXACTLY one — tag the others as a customer tier so untagged rows can't attach to the wrong tenant.`,
    );
  }
  cachedFounderId = founders[0]!.id;
  return cachedFounderId;
}

/**
 * Filter that pretends untagged rows belong to the founder. Used ONLY
 * by adapters whose persisted store predates the multi-tenant migration
 * (currently observation-runs).
 *
 * Returned rows are normalized: untagged rows that match the founder
 * query are stamped with the founder `tenant_id` in the returned shape
 * so consumers can rely on the typed contract. The on-disk JSON stays
 * untouched; this is purely a read-time normalization.
 */
async function filterByTenantWithLegacyFounderFallback<
  T extends { tenant_id?: string },
>(items: T[], requestedTenantId: string): Promise<T[]> {
  const founderId = await getFounderTenantIdForLegacyFallback();
  const out: T[] = [];
  for (const item of items) {
    const itemTenant = item.tenant_id;
    if (typeof itemTenant === "string" && itemTenant.length > 0) {
      // Tagged row: strict equality.
      if (itemTenant === requestedTenantId) out.push(item);
      continue;
    }
    // Untagged legacy row: belongs to founder. Stamp the tenant_id on
    // the returned object (a shallow copy — never mutate the source
    // array) so consumers see the canonical shape.
    if (requestedTenantId === founderId) {
      out.push({ ...item, tenant_id: founderId } as T);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-entity adapters
// ---------------------------------------------------------------------------

export async function getResultsForTenant(tenantId: string): Promise<Result[]> {
  return filterByTenant(await readStore<Result>("imported-results"), tenantId);
}

export async function getChangesForTenant(
  tenantId: string,
): Promise<ChangelogEntry[]> {
  return filterByTenant(
    await readStore<ChangelogEntry>("imported-changes"),
    tenantId,
  );
}

export async function getOpportunitiesForTenant(
  tenantId: string,
): Promise<Opportunity[]> {
  return filterByTenant(
    await readStore<Opportunity>("imported-opportunities"),
    tenantId,
  );
}

export async function getCompetitorsForTenant(
  tenantId: string,
): Promise<Competitor[]> {
  return filterByTenant(
    await readStore<Competitor>("imported-competitors"),
    tenantId,
  );
}

export async function getFindingsForTenant(
  tenantId: string,
): Promise<Finding[]> {
  return filterByTenant(await readStore<Finding>("scan-findings"), tenantId);
}

export async function getPagesForTenant(
  tenantId: string,
): Promise<PageEntity[]> {
  return filterByTenant(await readStore<PageEntity>("pages"), tenantId);
}

export async function getPageSnapshotsForTenant(
  tenantId: string,
): Promise<PageSnapshot[]> {
  return filterByTenant(
    await readStore<PageSnapshot>("page-snapshots"),
    tenantId,
  );
}

export async function getObservationRunsForTenant(
  tenantId: string,
): Promise<ObservationRun[]> {
  // S3 (operator audit, 2026-05-05) — `.data/observation-runs.json`
  // predates the multi-tenant migration; many rows lack a `tenant_id`
  // even though the TS type marks it required. Use the legacy fallback
  // filter so untagged rows are interpreted as belonging to the
  // founder tenant (the only tenant that ever wrote them historically).
  // Cross-tenant queries still correctly return [] for untagged rows.
  return filterByTenantWithLegacyFounderFallback(
    await readStore<ObservationRun>("observation-runs"),
    tenantId,
  );
}

export async function getSnapshotsForTenant(
  tenantId: string,
): Promise<DailyMetricSnapshot[]> {
  return filterByTenant(
    await readStore<DailyMetricSnapshot>("daily-metric-snapshots"),
    tenantId,
  );
}

// getOutcomesForTenant removed 2026-07-21 (CORE 100K Lane F): no callers; the
// ChangeOutcome type retired with the attribution memory loop.

