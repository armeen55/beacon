/**
 * Dual-write engine — file-first, Supabase-second.
 *
 * When DUAL_WRITE=true, every persist call that writes to a .data/*.json
 * file store also upserts the same rows to Supabase. The Supabase write
 * is best-effort: errors are logged but never thrown, so the file-backed
 * path always succeeds.
 *
 * Phase 1F covers 7 entity tables:
 *   import_runs, results, changelog_entries, opportunities, competitors,
 *   attribution_decisions, candidate_links
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
        // When Supabase is the canonical read source, a silent write failure
        // causes data loss on restart. Surface the error so callers can handle it.
        if (process.env.DATA_SOURCE === "supabase") {
          throw new Error(
            `[dual-write] ${table}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
          );
        }
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: unexpected error — ${e instanceof Error ? e.message : e}`,
    );
    if (process.env.DATA_SOURCE === "supabase") {
      throw e;
    }
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
  "citation_evidence_index",
  "answer_intelligence_index",
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

export async function dualWriteTruncate(table: string): Promise<void> {
  if (!isDualWriteEnabled()) return;

  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from(table).delete().gte("id", "");
    if (error) {
      console.error(
        `[dual-write] ${table}: truncate failed — ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: truncate error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ── Typed convenience wrappers ──

import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type { EventDecision, CandidateLink } from "@/domains/attribution/types";
import type { PageSnapshot, CitationEvidenceIndex, PageEntity } from "@/domains/pages/types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { Finding } from "@/domains/scanning/types";
import type { ObservationRun } from "@/domains/observations/types";
import type { AnswerIntelligenceIndex } from "@/domains/answer-intelligence/types";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type { PersistedIssue } from "@/domains/pages/issues";
import type { BusinessConfig } from "@/lib/business-config";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { PageVisibilitySummary } from "@/domains/pages/page-visibility";
import type { ChangePattern } from "@/domains/learning/change-patterns";
import type { TriageRule } from "@/domains/learning/triage-rules";
import type { ConfidenceCalibration } from "@/domains/learning/confidence-calibration";
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

export async function syncResults(
  rows: Result[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "results");
  await dualWriteUpsert("results", stamped as unknown as AnyRow[], "id");
}

/**
 * Map a ChangelogEntry to a DB row. Phase 1a (2026-04-21): schema-experiment
 * fields + rec/pattern linkage + dedupe/archive flags + tenant_id are now
 * columns on `changelog_entries`, so we pass the full shape through.
 * `tenant_id` defaults to '' server-side when absent.
 */
function mapChangelogEntryToRow(entry: ChangelogEntry): AnyRow {
  return entry as unknown as AnyRow;
}

export async function syncChangelogEntries(
  rows: ChangelogEntry[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "changelog_entries");
  const mapped = stamped.map(mapChangelogEntryToRow);
  await dualWriteUpsert("changelog_entries", mapped, "id");
}

export async function syncOpportunities(rows: Opportunity[]): Promise<void> {
  await dualWriteUpsert("opportunities", rows as unknown as AnyRow[], "id");
}

export async function syncCompetitors(rows: Competitor[]): Promise<void> {
  await dualWriteUpsert("competitors", rows as unknown as AnyRow[], "id");
}

export async function syncEventDecisions(
  rows: EventDecision[],
): Promise<void> {
  await dualWriteUpsert(
    "attribution_decisions",
    rows as unknown as AnyRow[],
    "id",
  );
}

export async function syncCandidateLinks(
  rows: CandidateLink[],
): Promise<void> {
  await dualWriteUpsert("candidate_links", rows as unknown as AnyRow[], "id");
}

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

/** Map camelCase ChangeContract to snake_case DB row. PK: contract_id. */
function mapChangeContractToRow(c: ChangeContract): AnyRow {
  return {
    contract_id: c.contractId,
    account_id: c.accountId,
    date_requested: c.dateRequested,
    date_live: c.dateLive,
    source_document: c.sourceDocument,
    source_input_type: c.sourceInputType,
    page_url: c.pageUrl,
    page_type: c.pageType,
    city: c.city,
    service: c.service,
    topic: c.topic,
    change_type: c.changeType,
    change_summary: c.changeSummary,
    business_goal: c.businessGoal,
    intended_hypothesis: c.intendedHypothesis,
    faq_count_expected: c.faqCountExpected,
    schema_types_expected: c.schemaTypesExpected,
    h1_expected: c.h1Expected,
    title_expected: c.titleExpected,
    meta_expected: c.metaExpected,
    internal_links_expected: c.internalLinksExpected,
    expected_verification: c.expectedVerification,
    expected_outcome_window_days: c.expectedOutcomeWindowDays,
    attribution_readiness: c.attributionReadiness,
    linked_issue_id: c.linkedIssueId,
    linked_plan_id: c.linkedPlanId,
    linked_wave_id: c.linkedWaveId,
    linked_frontier_id: c.linkedFrontierId,
    linked_changelog_entry_id: c.linkedChangelogEntryId,
    verification_status: c.verificationStatus,
    verification_result: c.verificationResult,
    verified_at: c.verifiedAt,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    notes: c.notes,
  };
}

export async function syncChangeContracts(
  rows: ChangeContract[],
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  const mapped = rows.map(mapChangeContractToRow);
  await dualWriteUpsert("change_contracts", mapped, "contract_id");
}

/** Map camelCase PersistedIssue to snake_case DB row. PK: issue_id. */
function mapPersistedIssueToRow(issue: PersistedIssue): AnyRow {
  return {
    issue_id: issue.issueId,
    page_url: issue.pageUrl,
    page_path: issue.pagePath,
    category: issue.category,
    status: issue.status,
    handed_off_at: issue.handedOffAt,
    shipped_at: issue.shippedAt,
    verified_at: issue.verifiedAt,
    updated_at: issue.updatedAt,
    verify_result: issue.verifyResult,
    verification_observation_run_id: issue.verificationObservationRunId ?? null,
    verification_baseline_observation_run_id:
      issue.verificationBaselineObservationRunId ?? null,
  };
}

export async function syncPageIssues(
  rows: PersistedIssue[],
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  const mapped = rows.map(mapPersistedIssueToRow);
  await dualWriteUpsert("page_issues", mapped, "issue_id");
}

// ── Operator memory sync (Phase 9) ──

export async function syncDailyMetricSnapshots(
  rows: DailyMetricSnapshot[],
): Promise<void> {
  await dualWriteUpsert(
    "daily_metric_snapshots",
    rows as unknown as AnyRow[],
    "id",
  );
}

export async function syncPromptAnswerObservations(
  rows: PromptAnswerObservation[],
): Promise<void> {
  await dualWriteUpsert(
    "prompt_answer_observations",
    rows as unknown as AnyRow[],
    "id",
  );
}

// ── Scan output sync (Phases 2 & 4) ──

export async function syncObservationRuns(
  runs: ObservationRun[],
): Promise<void> {
  // PK is run_id, NOT id.
  // Local file may contain mixed run types (website crawl + Profound import)
  // with extra fields not in the DB schema. Map explicitly to table columns.
  const rows: AnyRow[] = runs
    .filter((r) => r.run_id && r.run_type)
    .map((r) => ({
      run_id: r.run_id,
      run_type: r.run_type,
      source: r.source,
      status: r.status,
      started_at: r.started_at,
      completed_at: r.completed_at,
      scope_label: r.scope_label,
      parser_version: r.parser_version ?? null,
      pages_scanned: r.pages_scanned,
      pages_changed: r.pages_changed,
      pages_with_errors: r.pages_with_errors,
      guardrail_alerts: r.guardrail_alerts,
      critical_count: r.critical_count,
      regression_count: r.regression_count,
      improvement_count: r.improvement_count,
      baseline_run_id: r.baseline_run_id ?? null,
      competitor_universe_version: r.competitor_universe_version ?? null,
      competitor_universe_fingerprint: r.competitor_universe_fingerprint ?? null,
      competitor_universe_scope: r.competitor_universe_scope ?? null,
      competitor_universe_pin_status: r.competitor_universe_pin_status ?? null,
    }));
  await dualWriteUpsert("observation_runs", rows, "run_id");
}

export async function syncPageSnapshots(
  rows: PageSnapshot[],
): Promise<void> {
  await dualWriteUpsert("page_snapshots", rows as unknown as AnyRow[], "id");
}

export async function syncGuardrailAlerts(
  alerts: GuardrailAlert[],
): Promise<void> {
  if (!isDualWriteEnabled() || alerts.length === 0) return;

  const sb = getSupabaseAdmin();
  try {
    // Delete-replace: guardrail_alerts has auto-increment integer PK,
    // no stable text key for upsert. Local file also fully replaces on each scan.
    const { error: delErr } = await sb
      .from("guardrail_alerts")
      .delete()
      .gte("id", 0);
    if (delErr) {
      console.error(
        `[dual-write] guardrail_alerts: delete failed — ${delErr.message}`,
      );
      return;
    }
    // Insert fresh rows without 'id' — let Postgres auto-generate
    const rows = alerts.map((a) => ({
      page_id: a.page_id,
      url: a.url,
      severity: a.severity,
      category: a.category,
      message: a.message,
      detail: a.detail,
      observation_run_id: a.observation_run_id ?? null,
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await sb.from("guardrail_alerts").insert(chunk);
      if (error) {
        console.error(
          `[dual-write] guardrail_alerts: insert chunk ${i}-${i + chunk.length} failed — ${error.message}`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] guardrail_alerts: unexpected error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * Phase 4.5 (Sprint 4, 2026-04-24) — URL-scoped guardrail_alerts replace.
 *
 * `syncGuardrailAlerts` above is a GLOBAL delete-replace (nukes every row
 * before re-inserting). That's correct for `orchestrate-scan` which rewrites
 * every URL's alerts in one transaction, but unsafe for verify-action which
 * only has fresh alerts for ONE URL — calling the global helper from verify
 * would wipe every OTHER URL's alerts as a side effect.
 *
 * This helper mirrors verify-action.ts's local-file behavior: delete only
 * the rows matching the passed URL, then insert the fresh alert set for
 * that URL. Other URLs' alerts untouched.
 *
 * Pass `alerts = []` to clear this URL's alerts entirely (valid — means
 * the verify pass found zero guardrail issues).
 */
export async function syncGuardrailAlertsForUrl(
  url: string,
  alerts: GuardrailAlert[],
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  const sb = getSupabaseAdmin();
  try {
    const { error: delErr } = await sb
      .from("guardrail_alerts")
      .delete()
      .eq("url", url);
    if (delErr) {
      console.error(
        `[dual-write] guardrail_alerts (url=${url}): delete failed — ${delErr.message}`,
      );
      return;
    }
    if (alerts.length === 0) return;
    const rows = alerts.map((a) => ({
      page_id: a.page_id,
      url: a.url,
      severity: a.severity,
      category: a.category,
      message: a.message,
      detail: a.detail,
      observation_run_id: a.observation_run_id ?? null,
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await sb.from("guardrail_alerts").insert(chunk);
      if (error) {
        console.error(
          `[dual-write] guardrail_alerts (url=${url}): insert chunk ${i}-${i + chunk.length} failed — ${error.message}`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] guardrail_alerts (url=${url}): unexpected error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

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
): Promise<void> {
  if (!isDualWriteEnabled() || findings.length === 0) return;
  const rows = findings.map(mapFindingToRow);
  await dualWriteUpsert("scan_findings", rows, "id");
}

// ── Intelligence index sync (Phase 5) ──

export async function syncCitationEvidenceIndex(
  index: CitationEvidenceIndex,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  const sb = getSupabaseAdmin();
  try {
    const { error } = await sb.from("citation_evidence_index").upsert(
      {
        id: "current",
        built_at: index.built_at,
        total_citations_processed: index.total_citations_processed,
        by_page_and_topic: index.by_page_and_topic,
        by_topic: index.by_topic,
        page_to_topics: index.page_to_topics,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error(
        `[dual-write] citation_evidence_index: ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] citation_evidence_index: ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function syncAnswerIntelligenceIndex(
  index: AnswerIntelligenceIndex,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  const sb = getSupabaseAdmin();
  try {
    const { error } = await sb.from("answer_intelligence_index").upsert(
      {
        id: "current",
        built_at: index.built_at,
        data: index,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error(
        `[dual-write] answer_intelligence_index: ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] answer_intelligence_index: ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ── Config tables sync (Phase 10) ──

export async function syncTrackedPrompts(
  rows: TrackedPrompt[],
): Promise<void> {
  await dualWriteUpsert("tracked_prompts", rows as unknown as AnyRow[], "id");
}

export async function syncTrackedEntities(
  rows: TrackedEntity[],
): Promise<void> {
  await dualWriteUpsert("tracked_entities", rows as unknown as AnyRow[], "id");
}

export async function syncAnswerTexts(
  texts: Record<string, string>,
): Promise<void> {
  if (!isDualWriteEnabled()) return;

  const sb = getSupabaseAdmin();
  const entries = Object.entries(texts);
  if (entries.length === 0) return;

  try {
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE).map(([observation_id, body]) => ({
        observation_id,
        body,
      }));
      const { error } = await sb
        .from("answer_texts")
        .upsert(chunk, { onConflict: "observation_id" });
      if (error) {
        console.error(
          `[dual-write] answer_texts: upsert chunk ${i}-${i + chunk.length} failed — ${error.message}`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] answer_texts: unexpected error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ── Materialized relationship stores (Phase 11) ──

export async function syncChangeOutcomes(
  rows: ChangeOutcome[],
): Promise<void> {
  await dualWriteUpsert("change_outcomes", rows as unknown as AnyRow[], "id");
}

export async function syncPageVisibility(
  rows: PageVisibilitySummary[],
): Promise<void> {
  await dualWriteUpsert("page_visibility", rows as unknown as AnyRow[], "id");
}

// ── Learning stores sync (Phase 12) ──

export async function syncChangePatterns(
  rows: ChangePattern[],
): Promise<void> {
  await dualWriteUpsert("change_patterns", rows as unknown as AnyRow[], "id");
}

export async function syncTriageRules(
  rows: TriageRule[],
): Promise<void> {
  await dualWriteUpsert("triage_rules", rows as unknown as AnyRow[], "id");
}

export async function syncConfidenceCalibration(
  calibration: ConfidenceCalibration,
): Promise<void> {
  await dualWriteUpsert(
    "confidence_calibration",
    [calibration] as unknown as AnyRow[],
    "id",
  );
}

// ── Operator loop (Phase 1a) ──

/** Map camelCase RecommendationResponse to snake_case DB row. PK: rec_id. */
function mapRecommendationResponseToRow(r: RecommendationResponse): AnyRow {
  return {
    rec_id: r.recId,
    status: r.status,
    responded_at: r.respondedAt,
    defer_until: r.deferUntil,
    target_page_url: r.targetPageUrl ?? null,
    pattern_id: r.patternId ?? null,
    tenant_id: (r as RecommendationResponse & { tenant_id?: string }).tenant_id ?? "",
    updated_at: new Date().toISOString(),
  };
}

export async function syncRecommendationResponses(
  rows: RecommendationResponse[],
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  const mapped = rows.map(mapRecommendationResponseToRow);
  await dualWriteUpsert("recommendation_responses", mapped, "rec_id");
}

/**
 * Sprint 6A.1.16 (2026-04-25) — delete a recommendation_responses row by
 * rec_id. Required for the Undo path: the in-memory + on-disk arrays
 * splice the row out, but `syncRecommendationResponses` is upsert-only
 * — without an explicit delete, the row stays in Supabase and the
 * /recommendations page surfaces a stale "accepted" state on the next
 * cross-lambda render.
 *
 * Best-effort: errors logged, never thrown (matches the rest of this
 * module's posture). Caller has already removed the row from in-memory
 * state by the time this fires; if the Supabase delete fails, the
 * stale row is the worst case.
 */
export async function deleteRecommendationResponseByRecId(
  recId: string,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("recommendation_responses")
      .delete()
      .eq("rec_id", recId);
    if (error) {
      console.error(
        `[dual-write] recommendation_responses delete (rec_id=${recId}) failed — ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] recommendation_responses delete (rec_id=${recId}) error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function syncUrlChangeOutcomes(
  rows: UrlChangeOutcome[],
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  // Shape is already snake_case — pass through, compound PK.
  await dualWriteUpsert(
    "url_change_outcomes",
    rows as unknown as AnyRow[],
    "change_id,url",
  );
}

// ── Page element inventory sync (Sprint 6A.1 Phase 6) ──

// ── Recommended edits sync (Sprint 6A.1 Phase 11) ──

/**
 * Sprint 6A.1 Phase 11 (2026-04-24) — recommended_edits dual-write.
 *
 * Idempotent on `(rec_id, action_type, target_element_key)` matching
 * the migration's `ux_re_rec_action_element` unique index. The index
 * was created `NULLS NOT DISTINCT` so page-level lifecycle actions
 * (which write `target_element_key = NULL`) de-duplicate per
 * `(rec_id, action_type)` instead of accumulating duplicates.
 *
 * Rows arrive already snake_cased + DB-shaped from
 * `mapSpecificEditToRow` — pass-through, no further mapping.
 */
export async function syncRecommendedEdits(
  rows: import("@/domains/recommendations/recommended-edits-persistence").RecommendedEditRow[],
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  await dualWriteUpsert(
    "recommended_edits",
    rows as unknown as AnyRow[],
    "rec_id,action_type,target_element_key",
  );
}

/**
 * Sprint 6A.1 Phase 6 (2026-04-24) — page_element_inventory dual-write.
 *
 * Idempotent on `(source_snapshot_id, element_key)` — re-extracting the
 * same snapshot replaces existing rows in place rather than accumulating
 * duplicates. The unique index `ux_pei_snapshot_element_key` enforces
 * this at the DB level. Different snapshots (different `id`) keep their
 * own inventory rows so the table doubles as a per-scan audit trail.
 *
 * Rows arrive already snake_cased + DB-shaped from
 * `buildPageElementRows` in `src/domains/pages/extractors/persist.ts` —
 * pass-through, no mapping needed.
 */
export async function syncPageElementInventory(
  rows: import("@/domains/pages/extractors/persist").PageElementInventoryRow[],
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;
  await dualWriteUpsert(
    "page_element_inventory",
    rows as unknown as AnyRow[],
    "source_snapshot_id,element_key",
  );
}

/**
 * Clear all 7 import-path tables in Supabase (used by resetExperiment).
 * Best-effort — errors logged, never thrown.
 */
export async function clearAllImportTables(): Promise<void> {
  if (!isDualWriteEnabled()) return;

  const tables = [
    "import_runs",
    "results",
    "changelog_entries",
    "opportunities",
    "competitors",
    "attribution_decisions",
    "candidate_links",
  ];

  for (const t of tables) {
    await dualWriteTruncate(t);
  }
}
