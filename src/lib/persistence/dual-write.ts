/**
 * The ONE production write path: canonical records go straight to Supabase, unconditionally, and a write that did not land throws.
 *
 * 2026-07-31 (V1 Truth Convergence, Phase 0): the `DUAL_WRITE === "true"` gate that used to front every writer here was deleted. Unset anywhere, it made each of these calls a SUCCESS-SHAPED NO-OP - page snapshots, the in-process scan, the extractor persist path and the research run's owned-page read all resolved having written nothing while their callers advanced as though the rows were durable. Nothing on a canonical path consults an environment variable to decide whether to persist.
 */

import "server-only";

import { getSupabaseAdmin } from "./supabase";

const CHUNK_SIZE = 500;

// Phase 3.5G-fix (2026-04-22): `TypeError: fetch failed` during long sequential uploads (seen at chunk 9 of 29 on prompt_answer_observations) aborts the whole import. Per-chunk retry with exponential backoff absorbs transient network / TLS / connection-reset failures. Schema/constraint errors bypass retry - they won't improve with time and need a migration, not another attempt.
const MAX_RETRY_ATTEMPTS = 4; // 1 initial + 3 retries
const RETRY_BACKOFF_BASE_MS = 500; // 500 → 1000 → 2000 between attempts

/** Schema-shape / constraint errors; retry is pointless. Match on message text because Supabase-js error objects don't always populate `.code`. */
function isNonRetryableError(msg: string): boolean {
  return /schema cache|does not exist|column|violates|constraint|invalid input syntax/i.test(
    msg,
  );
}

async function dualWriteUpsert(
  table: string,
  rows: Record<string, unknown>[],
  primaryKey: string,
): Promise<void> {
  if (rows.length === 0) return;

  const sb = getSupabaseAdmin();
  // Proof of the write is the rows Postgres hands back, never the absence of an error. A lean projection of the conflict key's first column keeps the confirmation read to one small field per row.
  const confirmColumn = primaryKey.split(",")[0]!.trim();

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const chunkLabel = `${table} chunk ${i}-${i + chunk.length}`;

      // Retry loop - up to MAX_RETRY_ATTEMPTS total attempts per chunk.
      let lastErr: unknown = null;
      let written = 0;
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        try {
          const { data, error } = await sb
            .from(table)
            .upsert(chunk, { onConflict: primaryKey })
            .select(confirmColumn);
          if (!error) {
            written = Array.isArray(data) ? data.length : 0;
            lastErr = null;
            break;
          }
          if (isNonRetryableError(error.message ?? "")) {
            throw new Error(error.message ?? String(error));
          }
          lastErr = new Error(error.message ?? String(error));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isNonRetryableError(msg)) throw e;
          lastErr = e;
        }
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
          console.error(
            `[dual-write] ${chunkLabel}: attempt ${attempt} transient failure (${
              lastErr instanceof Error ? lastErr.message : String(lastErr)
            }) - retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }

      if (lastErr) {
        console.error(
          `[dual-write] ${chunkLabel} failed after ${MAX_RETRY_ATTEMPTS} attempts - ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`,
        );
        // A persistent write failure that is silently swallowed loses data and produces the false-completed signature seen on May 2-4 2026 (runs stamped completed, rows never landed). Always throw.
        throw new Error(
          `[dual-write] ${table}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        );
      }

      // No error and no rows back: the batch did not land. Silent zero is the same lie as a swallowed failure, so it fails closed too.
      if (written === 0) {
        throw new Error(
          `[dual-write] ${table}: ${chunk.length} row(s) sent, 0 written`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: unexpected error - ${e instanceof Error ? e.message : e}`,
    );
    // Always re-throw so the caller marks its run failed instead of showing a false "complete".
    throw e;
  }
}

// ── Tenant scoping (Phase 7.7a, 2026-04-25) ──────────────────────────
//
// Sprint 7's read paths are tenant-scoped end-to-end (Phase 7.5). Write paths still upsert mixed-tenant rows without validation: row mappers stamp `tenant_id`, but the dual-write layer doesn't verify it matches the caller's tenant. Phase 7.7a adds the validation infrastructure ONLY - assertion + scoped-upsert wrapper + the explicit list of cross-tenant tables. No caller uses these yet; that lands in 7.7b.

/**
 * Tables whose Supabase rows do NOT carry a `tenant_id` column. Writes to these MUST go through `dualWriteUpsert`. Writes to any other table MUST go through `dualWriteUpsertScoped`.
 *
 * Categories:
 * - registry:       `tenants`
 * - singletons:     `business_config`, `citation_evidence_index`, `answer_intelligence_index`
 * - operator-shared config: `tracked_prompts`, `tracked_entities`, `answer_texts`
 * - global learning: `change_patterns`, `triage_rules`, `confidence_calibration`
 *
 * Phase 7.8 consolidates this with `EXCLUDED_STORES` in `scripts/backfill-tenant-id.ts` (which lists the analogous `.data` file stores).
 */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  "tenants",
  "business_config",
  // Night-shift (2026-06-11): citation_evidence_index + answer_intelligence_index were REMOVED from this set - both tables are per-tenant now (tenant_id + (tenant_id,id) PK; migrations applied 2026-06-11) and their sync wrappers stamp tenant_id. tracked_prompts/tracked_entities remain listed pending a daylight verification of every writer (their reads are already tenant-filtered at the wrapper).
  "tracked_prompts",
  "tracked_entities",
  "answer_texts",
  "change_patterns",
  "triage_rules",
  "confidence_calibration",
]);

/**
 * Throws if any row's `tenant_id` doesn't match `tenantId`. Pure / no I/O. Use as the first step of every tenant-scoped writer; failing fast on mismatch is the leak-prevention contract.
 *
 * Treats missing/null `tenant_id` as a mismatch - defense against row mappers that forgot to stamp the field. An empty `tenantId` argument is also rejected so callers can't "validate" with the wrong fail-open value.
 */
export function assertRowsScopedToTenant(
  rows: ReadonlyArray<{ tenant_id?: string | null }>,
  tenantId: string,
  context: string,
): void {
  if (!tenantId) {
    throw new Error(
      `[dual-write/${context}] assertRowsScopedToTenant: tenantId must be a non-empty string`,
    );
  }
  for (const row of rows) {
    const rowTenant = row.tenant_id ?? "";
    if (rowTenant !== tenantId) {
      throw new Error(
        `[dual-write/${context}] tenant mismatch: row.tenant_id=${JSON.stringify(rowTenant)} expected=${tenantId}`,
      );
    }
  }
}

/**
 * Tenant-scoped variant of `dualWriteUpsert`. Refuses to write to a table in `GLOBAL_TABLES`; refuses to write rows whose `tenant_id` doesn't match `tenantId`. Validation happens before any I/O so cross-tenant leaks fail loud at the call site.
 *
 * Phase 7.7a: helper exists; no caller uses it yet. Phase 7.7b threads `tenantId` through every Tier A `sync*` helper and converts them to call this helper instead of `dualWriteUpsert` directly.
 */
export async function dualWriteUpsertScoped(
  table: string,
  rows: ReadonlyArray<{ tenant_id?: string | null } & Record<string, unknown>>,
  primaryKey: string,
  tenantId: string,
): Promise<void> {
  if (rows.length === 0) return;
  if (GLOBAL_TABLES.has(table)) {
    throw new Error(
      `[dual-write/${table}] is a global table - use dualWriteUpsert, not dualWriteUpsertScoped`,
    );
  }
  assertRowsScopedToTenant(rows, tenantId, table);
  await dualWriteUpsert(table, rows as Record<string, unknown>[], primaryKey);
}

/**
 * Force-stamps `tenant_id = tenantId` on every row. Throws only when an input row already carries a NON-EMPTY `tenant_id` that doesn't match. Empty string, `null`, and `undefined` are all coerced to `tenantId`.
 *
 * Phase 7.7b (2026-04-25) transitional helper. Production row-creation sites still stamp `tenant_id: ""` literally (~40 sites verified by audit). Tier A `sync*` wrappers wrap their input through `tenantizeRows` so the resolved tenant ends up on every row before the upsert, while any pre-stamped non-empty mismatch - the actual cross-tenant leak vector - fails loud.
 *
 * Once row-creation sites are clean (Phase 7.7b.1 or 7.8 cleanup), Tier A wrappers move from `dualWriteUpsert(tenantizeRows(...))` to `dualWriteUpsertScoped(...)`, which enforces the strict contract.
 *
 * Pure / no I/O. Does not mutate input rows (returns a new array).
 */
export function tenantizeRows<
  T extends Record<string, unknown> & { tenant_id?: string | null },
>(
  rows: ReadonlyArray<T>,
  tenantId: string,
  context: string,
): T[] {
  if (!tenantId) {
    throw new Error(
      `[dual-write/${context}] tenantizeRows: tenantId must be a non-empty string`,
    );
  }
  return rows.map((row) => {
    const existing = row.tenant_id ?? "";
    if (existing !== "" && existing !== tenantId) {
      throw new Error(
        `[dual-write/${context}] tenant mismatch: row.tenant_id=${JSON.stringify(existing)} expected=${tenantId}`,
      );
    }
    return { ...row, tenant_id: tenantId };
  });
}

// dualWriteTruncate + clearAllImportTables removed 2026-07-21 (CORE 100K Lane O): their only caller was the retired resetExperiment import-reset flow; zero callers remained.

// ── Typed convenience wrappers ──

import type { ImportRun } from "@/lib/import/types";
import type { PageSnapshot, PageEntity } from "@/domains/evidence/pages/types";

type AnyRow = Record<string, unknown>;

export async function syncImportRuns(
  runs: ImportRun[],
  tenantId: string,
): Promise<void> {
  // Phase 7.7b Commit 2 (2026-04-25): tenantizeRows replaces the prior `r.tenant_id ?? ""` defensive map. Any pre-stamped row with a non- empty mismatched tenant_id now fails loud instead of silently upserting under the wrong tenant.
  const rows = tenantizeRows(runs, tenantId, "import_runs");
  await dualWriteUpsert("import_runs", rows as unknown as AnyRow[], "id");
}

// syncResults / syncOpportunities / syncCompetitors / syncEventDecisions / syncCandidateLinks removed 2026-07-21 (CORE 100K Lane O): the CSV import-cluster writers lost their last caller when the import orchestrator's Supabase mirror path was retired; zero prod callers.

// syncChangelogEntries + mapChangelogEntryToRow removed 2026-07-22 (CORE 100K persistence collapse): zero live callers - the changelog write path that fed it was retired with the 28-domain strip. The tenant-scoped READ path (getChangelogEntries) stays live.

// ── Entity sync (Phase 6) ──

export async function syncPages(
  rows: PageEntity[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "pages");
  await dualWriteUpsert("pages", stamped as unknown as AnyRow[], "id");
}

// syncBusinessConfig / syncTenantBusinessConfig / syncTenantBusinessConfigConfirmed removed (Slice 1, generic Account + BusinessProfile): the canonical BusinessProfile write path is saveBusinessProfile in src/domains/account/business-profile.ts, which upserts the account's own business_config row directly. The legacy singleton "current" row is never written again (historical row preserved).

// mapChangeContractToRow + syncChangeContracts and mapPersistedIssueToRow + syncPageIssues removed 2026-07-21 (CORE 100K Lane O): zero prod callers - the contract/issue write paths that fed them were retired in earlier campaigns. The tenant-scoped READ paths (getChangeContracts) stay live.

// syncPromptAnswerObservations + its per-day collision recovery removed 2026-08-19 (AEO reconstruction): the history projection was a parallel copy of ai_observations, and the ONE canonical record needs no second write. The prompt_answer_observations table keeps its rows as history; nothing writes it again.


// ── Poll Integrity Hardening (2026-05-04, post May 2-4 incident) ── syncRawPollChunk + stampRawPollChunkReconciliation + RawPollChunkRow removed 2026-07-21 (CORE 100K Lane K): zero callers remained after the poll orchestrator retirement.

// ── Scan output sync (Phases 2 & 4) ──

// syncObservationRuns removed 2026-07-22 (CORE 100K persistence collapse): zero live callers - the scan/poll orchestrators that wrote observation_runs through it were retired with the 28-domain strip. The tenant-scoped READ path (getObservationRuns) stays live.

export async function syncPageSnapshots(
  rows: PageSnapshot[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "page_snapshots");
  await dualWriteUpsert("page_snapshots", stamped as unknown as AnyRow[], "id");
}

// syncGuardrailAlerts + syncGuardrailAlertsForUrl removed 2026-07-21 (CORE 100K Lane O): zero prod callers - the orchestrate-scan writer path and the verify-action URL-scoped path were both retired in earlier campaigns. The guardrail_alerts READ paths (getGuardrailAlerts) stay live.

// ── Scan findings sync (Phase 3) ──

// ── Intelligence index sync (Phase 5) ── syncCitationEvidenceIndex + syncAnswerIntelligenceIndex removed 2026-07-21 (CORE 100K Lane K): zero callers anywhere.

// ── Config tables sync (Phase 10) ── syncTrackedPrompts/syncTrackedEntities/syncDailyMetricSnapshots removed 2026-07-25 (Slice 6C): their last caller, canonical-store persist* family, was dead. syncAnswerTexts removed 2026-07-21 (CORE 100K): zero callers; the answer_texts table stays readable as deliberately historical data (see store-classification).

// ── Materialized relationship stores (Phase 11) ── syncChangeOutcomes removed 2026-07-21 (CORE 100K Lane F): its only caller was the retired attribution memory loop (change-outcome.ts). syncPageVisibility removed 2026-07-21 (CORE 100K Lane K): its only caller was the dead materializePageVisibility writer (page-visibility.ts, deleted).

// ── Learning stores sync (Phase 12) ── syncChangePatterns removed 2026-07-21 (CORE 100K Lane F): its only caller was the retired ChangeOutcome-fed materializeChangePatterns producer.


// ── Page element inventory sync (Sprint 6A.1 Phase 6) ──

// ── Recommended edits sync (Sprint 6A.1 Phase 11) ──

