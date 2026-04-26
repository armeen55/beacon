/**
 * Sprint 7 Phase 7.5a (2026-04-25) — tenant-bound repository facade.
 *
 * `buildTenantRepo(base, tenantId)` returns a `TenantRepository` whose
 * methods all filter rows down to one tenant. Both backends use the same
 * helper:
 *   - File backend reads all rows from `.data/*.json` then filters in memory
 *     (cheap; arrays are already hot in process).
 *   - Supabase backend (Phase 7.5a) ALSO uses in-memory filter for parity;
 *     Phase 7.5b will switch each method to push the filter to Postgres
 *     via `.eq("tenant_id", tenantId)` for index-friendly queries.
 *
 * The skeleton is non-breaking: every base method on `SeedDataRepository`
 * still works unscoped. Call sites convert to `getRepository().forTenant(id).getX()`
 * one route/file at a time in Phase 7.5b/c.
 *
 * Type-segregation enforcement (moving methods OFF `SeedDataRepository` so
 * the unscoped form becomes a TYPE ERROR) is deferred to a later commit
 * after all call sites are converted.
 */

import "server-only";

import type { SeedDataRepository, TenantRepository } from "./types";

/**
 * Loose runtime filter — works for any row shape that may carry a
 * `tenant_id` field. Avoids the `T extends { tenant_id: string }` constraint
 * that would force every domain type to declare the field. Phase 7.8 will
 * tighten the types as part of the .data/per-tenant migration.
 */
function filterByTenantId<T>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => (r as { tenant_id?: unknown }).tenant_id === tenantId);
}

export function buildTenantRepo(
  base: SeedDataRepository,
  tenantId: string,
): TenantRepository {
  return {
    getPages: async () => filterByTenantId(await base.getPages(), tenantId),
    getPageSnapshots: async () =>
      filterByTenantId(await base.getPageSnapshots(), tenantId),
    getPageElementInventory: async () =>
      filterByTenantId(await base.getPageElementInventory(), tenantId),
    getRecommendedEdits: async () =>
      filterByTenantId(await base.getRecommendedEdits(), tenantId),
    getRecommendationResponses: async () =>
      filterByTenantId(await base.getRecommendationResponses(), tenantId),
    getChangelogEntries: async () =>
      filterByTenantId(await base.getChangelogEntries(), tenantId),
    getScanFindings: async () =>
      filterByTenantId(await base.getScanFindings(), tenantId),
    getPendingScanFindings: async () =>
      filterByTenantId(await base.getPendingScanFindings(), tenantId),
    getGuardrailAlerts: async () =>
      filterByTenantId(await base.getGuardrailAlerts(), tenantId),
    getObservationRuns: async () =>
      filterByTenantId(await base.getObservationRuns(), tenantId),
    getResults: async () => filterByTenantId(await base.getResults(), tenantId),
    getImportRuns: async () =>
      filterByTenantId(await base.getImportRuns(), tenantId),
    getDailyMetricSnapshots: async () =>
      filterByTenantId(await base.getDailyMetricSnapshots(), tenantId),
    getPromptAnswerObservations: async () =>
      filterByTenantId(await base.getPromptAnswerObservations(), tenantId),
    getUrlChangeOutcomes: async () =>
      filterByTenantId(await base.getUrlChangeOutcomes(), tenantId),
  };
}
