/**
 * Dual-write engine — file-first, Supabase-second.
 *
 * When DUAL_WRITE=true, every persist call that writes to a .data/*.json
 * file store also upserts the same rows to Supabase.
 *
 * 2026-07-21 (CORE 100K Lane O): the dead import-cluster writers
 * (results/opportunities/competitors/attribution/candidate-link syncs,
 * change-contract + page-issue syncs, guardrail-alert syncs, truncate +
 * clear-all) were deleted — zero prod callers. Surviving writers are the
 * LIVE nightly/scan/poll paths listed below.
 */

import "server-only";

import { getSupabaseAdmin } from "./supabase";

const CHUNK_SIZE = 500;

// Phase 3.5G-fix (2026-04-22): `TypeError: fetch failed` during long sequential
// uploads (seen at chunk 9 of 29 on prompt_answer_observations) aborts the
// whole import. Per-chunk retry with exponential backoff absorbs transient
// network / TLS / connection-reset failures. Schema/constraint errors bypass
// retry — they won't improve with time and need a migration, not another
// attempt.
const MAX_RETRY_ATTEMPTS = 4; // 1 initial + 3 retries
const RETRY_BACKOFF_BASE_MS = 500; // 500 → 1000 → 2000 between attempts

/** Schema-shape / constraint errors; retry is pointless. Match on message
 *  text because Supabase-js error objects don't always populate `.code`. */
function isNonRetryableError(msg: string): boolean {
  return /schema cache|does not exist|column|violates|constraint|invalid input syntax/i.test(
    msg,
  );
}

export function isDualWriteEnabled(): boolean {
  return process.env.DUAL_WRITE === "true";
}

export async function dualWriteUpsert(
  table: string,
  rows: Record<string, unknown>[],
  primaryKey: string,
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;

  const sb = getSupabaseAdmin();

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const chunkLabel = `${table} chunk ${i}-${i + chunk.length}`;

      // Retry loop — up to MAX_RETRY_ATTEMPTS total attempts per chunk.
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        try {
          const { error } = await sb
            .from(table)
            .upsert(chunk, { onConflict: primaryKey });
          if (!error) {
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
            }) — retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }

      if (lastErr) {
        console.error(
          `[dual-write] ${chunkLabel} failed after ${MAX_RETRY_ATTEMPTS} attempts — ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`,
        );
        // Bug-1 fix (2026-05-04): Supabase is now THE source of truth (W4
        // core publish landed; CLAUDE.md's "Optimize for premium internal
        // app" + the Supabase migration handoff). A persistent write
        // failure that's silently swallowed causes data loss on restart
        // AND produces the false-completed-poll signature that
        // surfaced on May 2-4 (observation_runs stamped completed,
        // observations rows never landed). Always throw.
        //
        // The previous `process.env.DATA_SOURCE === "supabase"` gate was
        // a transitional safety net during the json-store → Supabase
        // migration. That migration is done.
        throw new Error(
          `[dual-write] ${table}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: unexpected error — ${e instanceof Error ? e.message : e}`,
    );
    // Bug-1 fix (2026-05-04): see comment above. Always re-throw so the
    // caller (and the cron handler / poll-health pipeline) can mark the
    // run as failed instead of swallowing the error and showing a false
    // "complete" status.
    throw e;
  }
}

// ── Tenant scoping (Phase 7.7a, 2026-04-25) ──────────────────────────
//
// Sprint 7's read paths are tenant-scoped end-to-end (Phase 7.5). Write
// paths still upsert mixed-tenant rows without validation: row mappers
// stamp `tenant_id`, but the dual-write layer doesn't verify it matches
// the caller's tenant. Phase 7.7a adds the validation infrastructure
// ONLY — assertion + scoped-upsert wrapper + the explicit list of
// cross-tenant tables. No caller uses these yet; that lands in 7.7b.

/**
 * Tables whose Supabase rows do NOT carry a `tenant_id` column.
 * Writes to these MUST go through `dualWriteUpsert`. Writes to any
 * other table MUST go through `dualWriteUpsertScoped`.
 *
 * Categories:
 *   - registry:       `tenants`
 *   - singletons:     `business_config`, `citation_evidence_index`,
 *                     `answer_intelligence_index`
 *   - operator-shared config: `tracked_prompts`, `tracked_entities`,
 *                     `answer_texts`
 *   - global learning: `change_patterns`, `triage_rules`,
 *                     `confidence_calibration`
 *
 * Phase 7.8 consolidates this with `EXCLUDED_STORES` in
 * `scripts/backfill-tenant-id.ts` (which lists the analogous `.data`
 * file stores).
 */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  "tenants",
  "business_config",
  // Night-shift (2026-06-11): citation_evidence_index +
  // answer_intelligence_index were REMOVED from this set — both tables
  // are per-tenant now (tenant_id + (tenant_id,id) PK; migrations
  // applied 2026-06-11) and their sync wrappers stamp tenant_id.
  // tracked_prompts/tracked_entities remain listed pending a daylight
  // verification of every writer (their reads are already
  // tenant-filtered at the wrapper).
  "tracked_prompts",
  "tracked_entities",
  "answer_texts",
  "change_patterns",
  "triage_rules",
  "confidence_calibration",
]);

/**
 * Throws if any row's `tenant_id` doesn't match `tenantId`. Pure / no
 * I/O. Use as the first step of every tenant-scoped writer; failing
 * fast on mismatch is the leak-prevention contract.
 *
 * Treats missing/null `tenant_id` as a mismatch — defense against
 * row mappers that forgot to stamp the field. An empty `tenantId`
 * argument is also rejected so callers can't "validate" with the wrong
 * fail-open value.
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
 * Tenant-scoped variant of `dualWriteUpsert`. Refuses to write to a
 * table in `GLOBAL_TABLES`; refuses to write rows whose `tenant_id`
 * doesn't match `tenantId`. Validation happens before any I/O so
 * cross-tenant leaks fail loud at the call site.
 *
 * Phase 7.7a: helper exists; no caller uses it yet. Phase 7.7b threads
 * `tenantId` through every Tier A `sync*` helper and converts them to
 * call this helper instead of `dualWriteUpsert` directly.
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
      `[dual-write/${table}] is a global table — use dualWriteUpsert, not dualWriteUpsertScoped`,
    );
  }
  assertRowsScopedToTenant(rows, tenantId, table);
  await dualWriteUpsert(table, rows as Record<string, unknown>[], primaryKey);
}

/**
 * Force-stamps `tenant_id = tenantId` on every row. Throws only when an
 * input row already carries a NON-EMPTY `tenant_id` that doesn't match.
 * Empty string, `null`, and `undefined` are all coerced to `tenantId`.
 *
 * Phase 7.7b (2026-04-25) transitional helper. Production row-creation
 * sites still stamp `tenant_id: ""` literally (~40 sites verified by
 * audit). Tier A `sync*` wrappers wrap their input through `tenantizeRows`
 * so the resolved tenant ends up on every row before the upsert, while
 * any pre-stamped non-empty mismatch — the actual cross-tenant leak
 * vector — fails loud.
 *
 * Once row-creation sites are clean (Phase 7.7b.1 or 7.8 cleanup), Tier
 * A wrappers move from `dualWriteUpsert(tenantizeRows(...))` to
 * `dualWriteUpsertScoped(...)`, which enforces the strict contract.
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

// dualWriteTruncate + clearAllImportTables removed 2026-07-21 (CORE 100K
// Lane O): their only caller was the retired resetExperiment import-reset
// flow; zero callers remained.

// ── Typed convenience wrappers ──

import type { ImportRun } from "@/lib/import/types";
import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { Finding } from "@/domains/scanning/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";

type AnyRow = Record<string, unknown>;

export async function syncImportRuns(
  runs: ImportRun[],
  tenantId: string,
): Promise<void> {
  // Phase 7.7b Commit 2 (2026-04-25): tenantizeRows replaces the prior
  // `r.tenant_id ?? ""` defensive map. Any pre-stamped row with a non-
  // empty mismatched tenant_id now fails loud instead of silently
  // upserting under the wrong tenant.
  const rows = tenantizeRows(runs, tenantId, "import_runs");
  await dualWriteUpsert("import_runs", rows as unknown as AnyRow[], "id");
}

// syncResults / syncOpportunities / syncCompetitors / syncEventDecisions /
// syncCandidateLinks removed 2026-07-21 (CORE 100K Lane O): the CSV
// import-cluster writers lost their last caller when the import
// orchestrator's Supabase mirror path was retired; zero prod callers.

// syncChangelogEntries + mapChangelogEntryToRow removed 2026-07-22 (CORE 100K
// persistence collapse): zero live callers — the changelog write path that fed
// it was retired with the 28-domain strip. The tenant-scoped READ path
// (getChangelogEntries) stays live.

// ── Entity sync (Phase 6) ──

export async function syncPages(
  rows: PageEntity[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "pages");
  await dualWriteUpsert("pages", stamped as unknown as AnyRow[], "id");
}

export async function syncBusinessConfig(
  config: BusinessConfig,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  const sb = getSupabaseAdmin();
  try {
    const { error } = await sb.from("business_config").upsert(
      {
        id: "current",
        data: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error(`[dual-write] business_config: ${error.message}`);
    }
  } catch (e) {
    console.error(
      `[dual-write] business_config: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * North-star onboarding (2026-06-11) — PER-TENANT business-config row.
 *
 * `syncBusinessConfig` above is the legacy SINGLETON channel (id="current",
 * pre-multi-tenant): every tenant's save would clobber one shared row, so
 * hosted resolution had to rely on the hand-written
 * `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` env blob. This writes the same
 * table keyed by the tenant id instead — additive (text PK, no migration),
 * one row per tenant, read back by `hydrateBusinessConfigFromSupabase`.
 * Refuses the literal "current" id so the legacy row can never be
 * clobbered by a tenant write.
 */
export async function syncTenantBusinessConfig(
  tenantId: string,
  config: BusinessConfig,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  if (!tenantId || tenantId === "current") return;
  const sb = getSupabaseAdmin();
  try {
    const { error } = await sb.from("business_config").upsert(
      {
        id: tenantId,
        data: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error(
        `[dual-write] business_config(${tenantId}): ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] business_config(${tenantId}): ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * wave-4 #2 (2026-06-14) — CONFIRMED business_config upsert for the
 * ONBOARDING path. Unlike syncTenantBusinessConfig (fire-and-forget,
 * DUAL_WRITE-gated, void), this RETURNS whether the row durably landed and
 * is NOT gated on DUAL_WRITE — onboarding MUST persist the config row
 * regardless of the nightly-mirror flag, because on Vercel (where the file
 * write is skipped) the Supabase row is the ONLY durable channel and an
 * active tenant must never exist without a config (every downstream engine
 * reads it). The launch flow gates the status→active flip on a true result.
 */
export async function syncTenantBusinessConfigConfirmed(
  tenantId: string,
  config: BusinessConfig,
): Promise<{ ok: boolean; reason?: string }> {
  if (!tenantId || tenantId === "current") {
    return { ok: false, reason: "invalid_tenant_id" };
  }
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("business_config").upsert(
      {
        id: tenantId,
        data: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error(
        `[dual-write] business_config(${tenantId}) CONFIRMED upsert failed: ${error.message}`,
      );
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(
      `[dual-write] business_config(${tenantId}) CONFIRMED upsert threw: ${reason}`,
    );
    return { ok: false, reason };
  }
}

// mapChangeContractToRow + syncChangeContracts and mapPersistedIssueToRow +
// syncPageIssues removed 2026-07-21 (CORE 100K Lane O): zero prod callers —
// the contract/issue write paths that fed them were retired in earlier
// campaigns. The tenant-scoped READ paths (getChangeContracts) stay live.

// ── Operator memory sync (Phase 9) ──

export async function syncDailyMetricSnapshots(
  rows: DailyMetricSnapshot[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "daily_metric_snapshots");
  await dualWriteUpsert(
    "daily_metric_snapshots",
    stamped as unknown as AnyRow[],
    "id",
  );
}

/** The per-day uniqueness index on prompt_answer_observations:
 *  (tenant_id, prompt_id, platform, (observed_at AT TIME ZONE 'UTC')::date).
 *  An EXPRESSION index — supabase-js `onConflict` can't target it, so the
 *  primary upsert keys on `id` and same-day collisions are recovered below. */
const PAO_DAY_CONSTRAINT = "ux_pao_tenant_prompt_platform_day";

function paoDayKey(row: {
  prompt_id?: unknown;
  platform?: unknown;
  observed_at?: unknown;
}): string | null {
  if (
    typeof row.prompt_id !== "string" ||
    typeof row.platform !== "string" ||
    typeof row.observed_at !== "string"
  ) {
    return null;
  }
  return `${row.platform}|${row.observed_at.slice(0, 10)}|${row.prompt_id}`;
}

/**
 * 2026-06-09 — same-day re-poll recovery (root cause of the June 3
 * persistence-gate latch). When two polls fire on the same UTC day
 * (double cron fire / retry-after-partial), the second run's rows carry
 * NEW ids but the SAME (tenant, prompt, platform, day) — the id-keyed
 * upsert INSERTs and trips the day-uniqueness constraint, which used to
 * throw, mark the run PERSISTENCE FAILED, and latch the paid-poll gate.
 *
 * A same-day duplicate is skippable BY DEFINITION (that prompt's answer
 * for that day is already recorded). On this specific collision we
 * fetch the day's existing keys and write ONLY the genuinely-missing
 * rows — which also lets a re-run fill prompts an earlier partial run
 * missed. Any other error still throws (the gate's job is real
 * failures, not re-poll collisions).
 */
export async function syncPromptAnswerObservations(
  rows: PromptAnswerObservation[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "prompt_answer_observations");
  try {
    await dualWriteUpsert(
      "prompt_answer_observations",
      stamped as unknown as AnyRow[],
      "id",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(PAO_DAY_CONSTRAINT)) throw err;

    const sb = getSupabaseAdmin();
    const existing = new Set<string>();
    // One read per distinct (platform, day) in the batch (a poll chunk
    // is one platform + one day, so this is one query in practice).
    const groups = new Map<string, { platform: string; day: string }>();
    for (const row of stamped as unknown as AnyRow[]) {
      const key = paoDayKey(row);
      if (key == null) continue;
      const [platform, day] = key.split("|");
      groups.set(`${platform}|${day}`, { platform: platform!, day: day! });
    }
    for (const { platform, day } of groups.values()) {
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select("prompt_id")
        .eq("tenant_id", tenantId)
        .eq("platform", platform)
        .gte("observed_at", `${day}T00:00:00Z`)
        .lt("observed_at", `${day}T23:59:59.999Z`);
      if (error != null) throw err; // recovery read failed → surface the ORIGINAL error
      for (const r of (data ?? []) as Array<{ prompt_id?: string }>) {
        if (typeof r.prompt_id === "string") {
          existing.add(`${platform}|${day}|${r.prompt_id}`);
        }
      }
    }

    const missing = (stamped as unknown as AnyRow[]).filter((row) => {
      const key = paoDayKey(row);
      return key != null && !existing.has(key);
    });
    if (missing.length > 0) {
      await dualWriteUpsert("prompt_answer_observations", missing, "id");
    }
    console.error(
      `[dual-write] prompt_answer_observations: same-day re-poll collision — ` +
        `${stamped.length - missing.length} duplicate row(s) skipped, ` +
        `${missing.length} missing row(s) written`,
    );
  }
}

// ── Poll Integrity Hardening (2026-05-04, post May 2-4 incident) ──
// syncRawPollChunk + stampRawPollChunkReconciliation + RawPollChunkRow removed
// 2026-07-21 (CORE 100K Lane K): zero callers remained after the poll
// orchestrator retirement.

// ── Scan output sync (Phases 2 & 4) ──

// syncObservationRuns removed 2026-07-22 (CORE 100K persistence collapse): zero
// live callers — the scan/poll orchestrators that wrote observation_runs through
// it were retired with the 28-domain strip. The tenant-scoped READ path
// (getObservationRuns) stays live.

export async function syncPageSnapshots(
  rows: PageSnapshot[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "page_snapshots");
  await dualWriteUpsert("page_snapshots", stamped as unknown as AnyRow[], "id");
}

// syncGuardrailAlerts + syncGuardrailAlertsForUrl removed 2026-07-21 (CORE
// 100K Lane O): zero prod callers — the orchestrate-scan writer path and the
// verify-action URL-scoped path were both retired in earlier campaigns.
// The guardrail_alerts READ paths (getGuardrailAlerts) stay live.

// ── Scan findings sync (Phase 3) ──

/** Map camelCase Finding to snake_case DB row. */
function mapFindingToRow(f: Finding): AnyRow {
  return {
    id: f.id,
    type: f.type,
    url: f.url,
    page_path: f.pagePath,
    detected_at: f.detectedAt,
    scan_run_id: f.scanRunId,
    previous_state: f.previousState,
    current_state: f.currentState,
    severity: f.severity,
    priority: f.priority,
    priority_score: f.priorityScore,
    summary: f.summary,
    suggested_action: f.suggestedAction,
    status: f.status,
    resolved_at: f.resolvedAt,
    linked_change_id: f.linkedChangeId,
    promotion_status: f.promotionStatus,
    resolution_note: f.resolutionNote,
    suppress_until: f.suppressUntil,
    citation_count: f.citationCount,
    is_homepage: f.isHomepage,
    contradicts_changelog: f.contradictsChangelog,
    metric_movement_detected: f.metricMovementDetected ?? null,
    signal_strength: f.signalStrength ?? null,
    source_rec_id: f.source_rec_id ?? null,
    source_pattern_id: f.source_pattern_id ?? null,
    tenant_id: f.tenant_id ?? "",
  };
}

export async function syncScanFindings(
  findings: Finding[],
  tenantId: string,
): Promise<void> {
  if (!isDualWriteEnabled() || findings.length === 0) return;
  // Phase 7.7b Commit 3 (2026-04-25): validate cross-tenant mismatch and
  // stamp tenant_id before mapping to DB rows. mapFindingToRow's
  // `f.tenant_id ?? ""` fallback below now passes the resolved tenant
  // through (no longer empty string for legacy callers).
  const stamped = tenantizeRows(findings, tenantId, "scan_findings");
  const rows = stamped.map(mapFindingToRow);
  await dualWriteUpsert("scan_findings", rows, "id");
}

// ── Intelligence index sync (Phase 5) ──
// syncCitationEvidenceIndex + syncAnswerIntelligenceIndex removed 2026-07-21
// (CORE 100K Lane K): zero callers anywhere.

// ── Config tables sync (Phase 10) ──

// Phase 1 Stage C (2026-05-09): tracked_prompts and tracked_entities
// are still in GLOBAL_TABLES (writes go through dualWriteUpsert, not the
// scoped variant) but the migration adds an additive `tenant_id` column
// alongside `account_id`. Sync wrappers stamp tenant_id explicitly so the
// CHECK constraint never fires on a runtime write. account_id stays
// untouched for compatibility — the existing eq("account_id", slug)
// reads continue to work; new reads can use tenant_id (the canonical
// scoping column).
export async function syncTrackedPrompts(
  rows: TrackedPrompt[],
  tenantId: string,
): Promise<void> {
  if (!tenantId) {
    throw new Error(
      "[dual-write/tracked_prompts] syncTrackedPrompts: tenantId required",
    );
  }
  const stamped = tenantizeRows(rows, tenantId, "tracked_prompts");
  await dualWriteUpsert(
    "tracked_prompts",
    stamped as unknown as AnyRow[],
    "id",
  );
}

export async function syncTrackedEntities(
  rows: TrackedEntity[],
  tenantId: string,
): Promise<void> {
  if (!tenantId) {
    throw new Error(
      "[dual-write/tracked_entities] syncTrackedEntities: tenantId required",
    );
  }
  const stamped = tenantizeRows(rows, tenantId, "tracked_entities");
  await dualWriteUpsert(
    "tracked_entities",
    stamped as unknown as AnyRow[],
    "id",
  );
}

// syncAnswerTexts removed 2026-07-21 (CORE 100K): zero callers; the answer_texts
// table stays readable as deliberately historical data (see store-classification).

// ── Materialized relationship stores (Phase 11) ──
// syncChangeOutcomes removed 2026-07-21 (CORE 100K Lane F): its only caller was
// the retired attribution memory loop (change-outcome.ts).
// syncPageVisibility removed 2026-07-21 (CORE 100K Lane K): its only caller was
// the dead materializePageVisibility writer (page-visibility.ts, deleted).

// ── Learning stores sync (Phase 12) ──
// syncChangePatterns removed 2026-07-21 (CORE 100K Lane F): its only caller was
// the retired ChangeOutcome-fed materializeChangePatterns producer.

// ── Operator loop (Phase 1a) ──

/** Map camelCase RecommendationResponse to snake_case DB row. PK: rec_id.
 *  Phase 7.7b Commit 5 (2026-04-25): tenant_id is supplied by the helper's
 *  caller-provided tenantId, not by the input row. */
function mapRecommendationResponseToRow(
  r: RecommendationResponse,
  tenantId: string,
): AnyRow {
  return {
    rec_id: r.recId,
    status: r.status,
    responded_at: r.respondedAt,
    defer_until: r.deferUntil,
    target_page_url: r.targetPageUrl ?? null,
    pattern_id: r.patternId ?? null,
    dismiss_reason: r.dismissReason ?? null,
    tenant_id: tenantId,
    updated_at: new Date().toISOString(),
  };
}

export async function syncRecommendationResponses(
  rows: RecommendationResponse[],
  tenantId: string,
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  // Phase 7.7b Commit 5 (2026-04-25): RecommendationResponse type doesn't
  // carry tenant_id natively — the prior mapper used a defensive cast. We
  // still validate any row that DOES carry a stray tenant_id field via
  // tenantizeRows (catches a hypothetical cross-tenant leak), but the
  // mapper now stamps tenantId directly.
  tenantizeRows(
    rows as unknown as Array<{ tenant_id?: string | null } & Record<string, unknown>>,
    tenantId,
    "recommendation_responses",
  );
  const mapped = rows.map((r) => mapRecommendationResponseToRow(r, tenantId));
  // 2026-04-27 Accept-bug fix — analogous to Sprint 6A.2f's fix on
  // syncRecommendedEdits. The Phase 7.2 multi-tenant migration swapped
  // the recommendation_responses PRIMARY KEY from `(rec_id)` to
  // `(tenant_id, rec_id)` to allow two tenants to hold independent
  // responses for the same rec_id (e.g. two tenants both producing
  // `create_cluster_page:geo:Los Altos`). The dual-write spec was not
  // updated alongside, so every Accept against the live tenant threw
  // `there is no unique or exclusion constraint matching the ON CONFLICT
  // specification` from PostgREST. Verified the production index via
  //   SELECT indexdef FROM pg_indexes WHERE tablename='recommendation_responses'
  //   → `recommendation_responses_pkey ON ... USING btree (tenant_id, rec_id)`
  // before changing this string. Architecture invariant in
  // tests/architecture/dual-write-onconflict.test.ts pins this against
  // future regression.
  await dualWriteUpsert(
    "recommendation_responses",
    mapped,
    "tenant_id,rec_id",
  );
}

/**
 * Sprint 6A.1.16 (2026-04-25) — delete a recommendation_responses row by
 * rec_id. Required for the Undo path: the in-memory + on-disk arrays
 * splice the row out, but `syncRecommendationResponses` is upsert-only
 * — without an explicit delete, the row stays in Supabase and the
 * /recommendations page surfaces a stale "accepted" state on the next
 * cross-lambda render.
 *
 * Phase 7.7c (2026-04-25): tenant-scoped. The DELETE now carries
 * `.eq("tenant_id", tenantId)` so a cross-tenant `rec_id` collision
 * — e.g. two tenants both producing
 * `create_cluster_page:geo:Los Altos` — never lets one tenant's Undo
 * remove another tenant's response.
 *
 * Best-effort: errors logged, never thrown (matches the rest of this
 * module's posture). Caller has already removed the row from in-memory
 * state by the time this fires; if the Supabase delete fails, the
 * stale row is the worst case.
 */
export async function deleteRecommendationResponseByRecId(
  recId: string,
  tenantId: string,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  if (!tenantId) {
    throw new Error(
      "[dual-write/recommendation_responses] deleteRecommendationResponseByRecId: tenantId must be a non-empty string",
    );
  }
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("recommendation_responses")
      .delete()
      .eq("rec_id", recId)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error(
        `[dual-write] recommendation_responses delete (rec_id=${recId}, tenant=${tenantId}) failed — ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] recommendation_responses delete (rec_id=${recId}, tenant=${tenantId}) error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function syncUrlChangeOutcomes(
  rows: UrlChangeOutcome[],
  tenantId: string,
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  const stamped = tenantizeRows(rows, tenantId, "url_change_outcomes");
  // Shape is already snake_case — pass through, compound PK.
  await dualWriteUpsert(
    "url_change_outcomes",
    stamped as unknown as AnyRow[],
    "change_id,url",
  );
}

// ── Page element inventory sync (Sprint 6A.1 Phase 6) ──

// ── Recommended edits sync (Sprint 6A.1 Phase 11) ──

/**
 * Sprint 6A.1 Phase 11 (2026-04-24) — recommended_edits dual-write.
 *
 * Idempotent on `(tenant_id, rec_id, action_type, target_element_key)`
 * matching the production `ux_re_tenant_rec_action_element` unique
 * index. The index is `NULLS NOT DISTINCT` so page-level lifecycle
 * actions (which write `target_element_key = NULL`) de-duplicate per
 * `(tenant_id, rec_id, action_type)` instead of accumulating
 * duplicates.
 *
 * Rows arrive already snake_cased + DB-shaped from
 * `mapSpecificEditToRow` — pass-through, no further mapping.
 *
 * Phase 7.7d (2026-04-25): tenant-bound via STRICT `dualWriteUpsertScoped`
 * (not lenient `tenantizeRows`). The row source is already clean — every
 * row carries `tenant_id` stamped from `packet.tenantId` at construction
 * time, with no `""` legacy values to coerce. This helper is the first
 * production caller of `dualWriteUpsertScoped`; the contract is "every
 * row's `tenant_id` MUST equal `tenantId` — empty / null / undefined
 * counts as mismatch and throws".
 *
 * Sprint 6A.2f follow-up (2026-04-26): the `onConflict` column list
 * fixed to `"tenant_id,rec_id,action_type,target_element_key"` (was
 * missing `tenant_id`). The Phase 7.7d tenant-binding migration
 * extended the unique index to include `tenant_id` as the leading
 * column — `ux_re_rec_action_element` (3 cols) was renamed to
 * `ux_re_tenant_rec_action_element` (4 cols) — but the dual-write
 * spec wasn't updated alongside. Result: the first live LLM-sourced
 * `--write` against the Ritz tenant threw
 * `"there is no unique or exclusion constraint matching the ON CONFLICT
 * specification"` on the Supabase side. Local file persistence
 * succeeded (file-first contract), so the local UI saw the rows; the
 * Supabase mirror was empty. Verified the production index via
 * `\\d recommended_edits` before changing this string.
 */
export async function syncRecommendedEdits(
  rows: import("@/domains/recommendations/recommended-edits-persistence").RecommendedEditRow[],
  tenantId: string,
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  await dualWriteUpsertScoped(
    "recommended_edits",
    rows as unknown as Array<{ tenant_id?: string | null } & Record<string, unknown>>,
    "tenant_id,rec_id,action_type,target_element_key",
    tenantId,
  );
}

/**
 * Sprint 6A.1 Phase 6 (2026-04-24) — page_element_inventory dual-write.
 *
 * Idempotent on `(tenant_id, source_snapshot_id, element_key)` — re-
 * extracting the same snapshot for the same tenant replaces existing
 * rows in place rather than accumulating duplicates. The unique index
 * `ux_pei_tenant_snapshot_element_key` enforces this at the DB level.
 * Different snapshots (different `id`) keep their own inventory rows
 * so the table doubles as a per-scan audit trail.
 *
 * 2026-04-27 onConflict-audit fix: the spec was previously
 * `"source_snapshot_id,element_key"` (missing `tenant_id`) — same bug
 * class as the recommendation_responses + recommended_edits Sprint
 * 6A.2f fixes. The Phase 7.7d multi-tenant migration extended the
 * unique index to include `tenant_id` as the leading column, but the
 * dual-write spec was not updated alongside. Surfaced during the
 * Phase 3/4 lifecycle automation safety gate as:
 *   "[dual-write] page_element_inventory: there is no unique or
 *    exclusion constraint matching the ON CONFLICT specification"
 * Verified production index via `pg_indexes` before patching:
 *   ux_pei_tenant_snapshot_element_key
 *     ON page_element_inventory (tenant_id, source_snapshot_id, element_key)
 *
 * Rows arrive already snake_cased + DB-shaped from
 * `buildPageElementRows` in `src/domains/pages/extractors/persist.ts` —
 * pass-through, no mapping needed.
 */
export async function syncPageElementInventory(
  rows: import("@/domains/pages/extractors/persist").PageElementInventoryRow[],
  tenantId: string,
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  const stamped = tenantizeRows(rows, tenantId, "page_element_inventory");

  // 2026-04-27 onConflict-audit follow-up: dedupe by the compound
  // unique-index key before upsert. Same defensive pattern as
  // syncObservationRuns. Real-world cause: the JSON-LD extractor can
  // emit the same `(source_snapshot_id, element_key)` twice when a
  // Review block on the page has duplicated child properties (e.g.
  // two reviewRating.ratingValue entries from a malformed schema
  // block). Without dedup, the upsert batch contains two rows
  // targeting the same DB row → Postgres rejects with:
  //   "ON CONFLICT DO UPDATE command cannot affect row a second time"
  // Keep LAST occurrence (matches observation_runs semantics + the
  // file-first replace-by-id contract elsewhere).
  // Architecture invariant in tests/architecture/dual-write-onconflict.test.ts
  // pins both the onConflict spec AND the dedup line presence.
  const dedupedByKey = new Map<string, typeof stamped[number]>();
  for (const row of stamped) {
    const key = `${row.source_snapshot_id}|${row.element_key}`;
    if (typeof row.source_snapshot_id === "string" && typeof row.element_key === "string") {
      dedupedByKey.set(key, row);
    }
  }
  const dedupedRows = Array.from(dedupedByKey.values());

  await dualWriteUpsert(
    "page_element_inventory",
    dedupedRows as unknown as AnyRow[],
    "tenant_id,source_snapshot_id,element_key",
  );
}

// (clearAllImportTables removed 2026-07-21 with dualWriteTruncate — see the
// dated note above the typed convenience wrappers.)
