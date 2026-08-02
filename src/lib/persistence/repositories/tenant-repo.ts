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
import {
  readDotDataJson,
  writeDotDataJson,
} from "@/lib/persistence/dotdata-json";
import type { RobotsStateFile } from "@/domains/evidence/pages/robots-parser";

/**
 * Loose runtime filter — works for any row shape that may carry a
 * `tenant_id` field. Avoids the `T extends { tenant_id: string }` constraint
 * that would force every domain type to declare the field. Phase 7.8 will
 * tighten the types as part of the .data/per-tenant migration.
 */
function filterByTenantId<T>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => (r as { tenant_id?: unknown }).tenant_id === tenantId);
}

// (isProfoundImportRunShape / resolveSlugForTenant /
// readProfoundImportRunsForTenant removed 2026-07-21, CORE 100K Lane O:
// the Section 5 repeat-citation loader that consumed the
// getProfoundImportRuns read path was deleted in an earlier campaign.
// shipped-change-store.ts keeps its own inline poll-day reader.)

export function buildTenantRepo(
  base: SeedDataRepository,
  tenantId: string,
): TenantRepository {
  return {
    getPages: async () => filterByTenantId(await base.getPages(), tenantId),
    getPageSnapshots: async () =>
      filterByTenantId(await base.getPageSnapshots(), tenantId),
    getPageSnapshotLinkGraphs: async () =>
      filterByTenantId(await base.getPageSnapshotLinkGraphs(), tenantId),
    getRecommendedEdits: async () =>
      filterByTenantId(await base.getRecommendedEdits(), tenantId),
    getRecommendationResponses: async () =>
      filterByTenantId(await base.getRecommendationResponses(), tenantId),
    getChangelogEntries: async () =>
      filterByTenantId(await base.getChangelogEntries(), tenantId),
    getScanFindings: async () =>
      filterByTenantId(await base.getScanFindings(), tenantId),
    getObservationRuns: async () =>
      filterByTenantId(await base.getObservationRuns(), tenantId),
    getResults: async () => filterByTenantId(await base.getResults(), tenantId),
    getImportRuns: async () =>
      filterByTenantId(await base.getImportRuns(), tenantId),
    // E3 (operator audit, 2026-05-05) — accept optional `{ since }` window.
    // The file-backend reads everything off disk anyway (no Postgres
    // egress), but threading the option keeps the API symmetric with
    // the Supabase backend so callers don't branch on DATA_SOURCE.
    // Filtering happens in-memory after the disk read.
    getDailyMetricSnapshots: async (options) => {
      const all = filterByTenantId(
        await base.getDailyMetricSnapshots(),
        tenantId,
      );
      if (!options?.since) return all;
      const since = options.since;
      return all.filter((row) => {
        // The DailyMetricSnapshot type uses `date` (YYYY-MM-DD), not
        // `for_date`. Filter is lex-safe against ISO timestamps too
        // because YYYY-MM-DD is a prefix of YYYY-MM-DDTHH:mm:ssZ.
        const d = (row as { date?: string }).date;
        return typeof d === "string" && d >= since;
      });
    },
    getPromptAnswerObservations: async (options) => {
      // Emergency P0 fix (2026-05-12) — push the `promptId` filter
      // down to the base read. For the Supabase backend that's a
      // `.eq("prompt_id", id)` server-side filter (the row count
      // crossing the wire drops from ~15,000 to typically <500).
      // For the file backend it's an in-memory filter (cheap; the
      // array is hot in process). Both `since` and `promptId` are
      // applied; either may be omitted.
      const all = filterByTenantId(
        await base.getPromptAnswerObservations(
          options?.promptId ? { promptId: options.promptId } : undefined,
        ),
        tenantId,
      );
      const since = options?.since;
      const promptId = options?.promptId;
      if (!since && !promptId) return all;
      return all.filter((row) => {
        if (promptId) {
          const p = (row as { prompt_id?: string }).prompt_id;
          if (p !== promptId) return false;
        }
        if (since) {
          const o = (row as { observed_at?: string }).observed_at;
          if (typeof o !== "string" || o < since) return false;
        }
        return true;
      });
    },
    getUrlChangeOutcomes: async () =>
      filterByTenantId(await base.getUrlChangeOutcomes(), tenantId),
    // Customer-2 isolation fix (operator audit, 2026-05-06) — both
    // stores are TENANT_SCOPED in store-classification.ts; rows on
    // disk already carry tenant_id (and account_id). The unscoped
    // base.getTrackedPrompts() / .getTrackedEntities() paths return
    // ALL rows across tenants; filtering here keeps each tenant's
    // /today leaderboard isolated from the other.
    getTrackedPrompts: async () =>
      filterByTenantId(await base.getTrackedPrompts(), tenantId),
    getTrackedEntities: async () =>
      filterByTenantId(await base.getTrackedEntities(), tenantId),
    // Night-shift (2026-06-11) — rows carry tenant_id; the unscoped base
    // read returns every tenant on hosted.
    getChangeContracts: async () =>
      filterByTenantId(await base.getChangeContracts(), tenantId),
    getOpportunities: async () =>
      filterByTenantId(await base.getOpportunities(), tenantId),
    // ─────────────────────────────────────────────────────────────────
    // Phase A.3 (post-A.3.5) — tenant-scoped robots-state. File-backend
    // routes it through dotdata-json's classification dispatch:
    // `robots-state` is SINGLETON → resolved to
    // `.data/tenants/{slug}/robots-state.json` (slug from
    // AsyncLocalStorage). Soft-fail to null on missing data —
    // supabase-backend matches this with the 42P01 undefined-table
    // soft-fail (sequencing model A).
    // ─────────────────────────────────────────────────────────────────
    getRobotsState: async () =>
      (await readDotDataJson<RobotsStateFile>("robots-state")) ?? null,
    setRobotsState: async (state: RobotsStateFile) => {
      await writeDotDataJson<RobotsStateFile>("robots-state", state);
    },
  };
}
