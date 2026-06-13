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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SeedDataRepository, TenantRepository } from "./types";
import {
  readDotDataJson,
  writeDotDataJson,
} from "@/lib/persistence/dotdata-json";
import { getDataDir } from "@/lib/tenant";
import { getTenant } from "@/domains/tenants/store";
import type {
  SitemapReconciliation,
} from "@/domains/pages/types";
import type { RobotsStateFile } from "@/domains/pages/robots-parser";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";

/**
 * Loose runtime filter — works for any row shape that may carry a
 * `tenant_id` field. Avoids the `T extends { tenant_id: string }` constraint
 * that would force every domain type to declare the field. Phase 7.8 will
 * tighten the types as part of the .data/per-tenant migration.
 */
function filterByTenantId<T>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => (r as { tenant_id?: unknown }).tenant_id === tenantId);
}

/**
 * Section 5 precursor (2026-05-16) — positive-shape discriminator
 * for `ProfoundImportRun` rows in the mixed `.data/observation-
 * runs.json` store. The file historically contains both shapes
 * (website-crawl `ObservationRun` AND poll-run `ProfoundImportRun`);
 * the website-crawl shape has `run_id` + `run_type`, the poll-run
 * shape has `run_date` + `source_type`. We discriminate positively
 * on the two fields the consumer needs (run_date + source_type)
 * rather than negatively on the absence of `run_type`, so a future
 * row that carries both shapes' fields still classifies cleanly.
 */
export function isProfoundImportRunShape(
  r: unknown,
): r is ProfoundImportRun {
  if (r == null || typeof r !== "object") return false;
  const row = r as Record<string, unknown>;
  return typeof row.run_date === "string" && typeof row.source_type === "string";
}

/**
 * Section 5 precursor (2026-05-16) — explicit-tenant slug resolver
 * for the disk-backed `ProfoundImportRun` read.
 *
 * Resolves the captured `tenantId` argument to its slug WITHOUT
 * touching ambient `currentTenantSlug()` (the contract is that
 * `forTenant(tenantId)` scopes by `tenantId`, not by the active
 * request slug). Returns `null` when neither the tenant registry
 * nor the operator-bootstrap env fallback can supply a slug; the
 * caller treats `null` as "no data" (returns `[]`).
 *
 * Operator-bootstrap fallback rule mirrors `currentTenantSlug()`
 * in `src/lib/tenant-context.ts:78-99`: when the explicit
 * `tenantId` matches `BEACON_TENANT_ID` AND `BEACON_TENANT_SLUG`
 * is set, accept the env slug. For any other tenantId, missing
 * registry entry = null + caller returns `[]`. This preserves
 * Ritz production reads (registry typically empty on Vercel
 * because `.data/global/tenants.json` is gitignored) while
 * refusing to leak data for any non-bootstrap tenant.
 */
async function resolveSlugForTenant(tenantId: string): Promise<string | null> {
  const tenant = await getTenant(tenantId);
  if (tenant) return tenant.slug;
  const envId = process.env.BEACON_TENANT_ID;
  const envSlug = process.env.BEACON_TENANT_SLUG;
  if (envId && envSlug && envId === tenantId) return envSlug;
  return null;
}

/**
 * Section 5 precursor (2026-05-16) — explicit-tenant disk read for
 * `ProfoundImportRun[]`. Reads
 * `.data/tenants/{slug}/observation-runs.json` directly via
 * `readFileSync` after resolving the slug from the explicit
 * `tenantId`. NEVER consults `readStore("observation-runs")` (which
 * would route through ambient `currentTenantSlug()` and silently
 * ignore the explicit `tenantId`).
 *
 * Returns `[]` on:
 *   • Missing slug (tenant not in registry AND env fallback doesn't
 *     match) — fail-soft so Section 5's loader treats it as
 *     "no polling-day evidence yet" rather than throwing.
 *   • Missing file (per-tenant directory not yet seeded).
 *   • Malformed JSON.
 *   • Non-array root (defensive).
 *
 * Positive-shape filter runs after the disk read, dropping any
 * website-crawl `ObservationRun` rows that share the same file.
 */
export async function readProfoundImportRunsForTenant(
  tenantId: string,
): Promise<ProfoundImportRun[]> {
  const slug = await resolveSlugForTenant(tenantId);
  if (slug == null) return [];
  const filePath = join(getDataDir(slug), "observation-runs.json");
  if (!existsSync(filePath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isProfoundImportRunShape);
}

export function buildTenantRepo(
  base: SeedDataRepository,
  tenantId: string,
): TenantRepository {
  return {
    getPages: async () => filterByTenantId(await base.getPages(), tenantId),
    // Perf+egress bundle 2 (2026-05-12) — narrow projection of
    // `pages`. The file backend's `filterByTenantId` requires
    // `tenant_id` on each row; PageSummary carries it for exactly
    // this reason.
    getPageSummaries: async () =>
      filterByTenantId(await base.getPageSummaries(), tenantId),
    getPageSnapshots: async () =>
      filterByTenantId(await base.getPageSnapshots(), tenantId),
    getPageSnapshotLinkGraphs: async () =>
      filterByTenantId(await base.getPageSnapshotLinkGraphs(), tenantId),
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
    // Night-shift fix (2026-06-11) — citation_evidence_index is a
    // SINGLE OBJECT per tenant (not rows), so filterByTenantId can't
    // protect it. Pre-fix, hosted reads returned ONE global row blended
    // across tenants. Prefer the backend's explicit-tenant read when it
    // exists (Supabase); the file backend's ambient per-tenant routing
    // already isolates, so fall back to the ambient read there.
    getCitationEvidenceIndex: async () =>
      base.getCitationEvidenceIndexScoped
        ? base.getCitationEvidenceIndexScoped(tenantId)
        : base.getCitationEvidenceIndex(),
    getAnswerIntelligenceIndex: async () =>
      base.getAnswerIntelligenceIndexScoped
        ? base.getAnswerIntelligenceIndexScoped(tenantId)
        : base.getAnswerIntelligenceIndex(),
    // Night-shift (2026-06-11) — rows carry tenant_id; the unscoped base
    // read returns every tenant on hosted.
    getChangeContracts: async () =>
      filterByTenantId(await base.getChangeContracts(), tenantId),
    getPageIssues: async () =>
      filterByTenantId(await base.getPageIssues(), tenantId),
    getEventDecisions: async () =>
      filterByTenantId(await base.getEventDecisions(), tenantId),
    getCandidateLinks: async () =>
      filterByTenantId(await base.getCandidateLinks(), tenantId),
    getOpportunities: async () =>
      filterByTenantId(await base.getOpportunities(), tenantId),
    getCompetitors: async () =>
      filterByTenantId(await base.getCompetitors(), tenantId),
    /**
     * Section 5 precursor (2026-05-16) — explicit-tenant poll-run
     * read. Scopes by the captured `tenantId` argument, NOT by
     * ambient `currentTenantSlug()`. Resolves `tenantId → slug`
     * via the tenant registry (with operator-bootstrap env
     * fallback only when `tenantId === BEACON_TENANT_ID`), then
     * reads `.data/tenants/{slug}/observation-runs.json`
     * directly. Returns `[]` when the slug is unresolvable, the
     * file is missing, or the file is malformed — fail-soft for
     * Section 5's downstream compute.
     *
     * Architectural contract: a caller running
     * `forTenant("tenant-a").getProfoundImportRuns()` while
     * ambient request slug is `tenant-b` gets tenant-a's data,
     * not tenant-b's. Pinned by
     * `tests/architecture/profound-import-runs-explicit-tenant-scope.test.ts`.
     */
    getProfoundImportRuns: async () =>
      readProfoundImportRunsForTenant(tenantId),
    // ─────────────────────────────────────────────────────────────────
    // Phase A.3 (post-A.3.5) — tenant-scoped robots-state +
    // sitemap-reconciliation. File-backend routes both through
    // dotdata-json's classification dispatch:
    //   • `robots-state` is SINGLETON → resolved to
    //     `.data/tenants/{slug}/robots-state.json` (slug from
    //     AsyncLocalStorage). The pre-A.3 flat-path file
    //     (`.data/robots-state.json`) is retired by the parallel
    //     robots-parser retrofit.
    //   • `sitemap-reconciliation` was flipped GLOBAL → TENANT_SCOPED
    //     in `store-classification.ts` as part of this step; it now
    //     resolves to `.data/tenants/{slug}/sitemap-reconciliation.json`.
    // Soft-fail to null on missing data — supabase-backend matches
    // this with the 42P01 undefined-table soft-fail (sequencing
    // model A).
    // ─────────────────────────────────────────────────────────────────
    getRobotsState: async () =>
      (await readDotDataJson<RobotsStateFile>("robots-state")) ?? null,
    setRobotsState: async (state: RobotsStateFile) => {
      await writeDotDataJson<RobotsStateFile>("robots-state", state);
    },
    getSitemapReconciliation: async () =>
      (await readDotDataJson<SitemapReconciliation>(
        "sitemap-reconciliation",
      )) ?? null,
    setSitemapReconciliation: async (recon: SitemapReconciliation) => {
      await writeDotDataJson<SitemapReconciliation>(
        "sitemap-reconciliation",
        recon,
      );
    },
  };
}
