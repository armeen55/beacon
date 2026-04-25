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

export async function syncImportRuns(runs: ImportRun[]): Promise<void> {
  // Phase 3.5G-fix (2026-04-22): legacy `.data/import-runs.json` rows pre-date
  // the `tenant_id` field on ImportRun. When a new row is pushed onto the
  // heterogeneous array and upserted, Supabase-js serializes missing keys as
  // `null`, which PostgREST applies as UPDATE SET tenant_id=null → violates
  // the NOT NULL column added by `import_runs_add_tenant_id`. Normalize
  // defensively so every row in the payload has a valid tenant_id.
  const rows = runs.map((r) => ({ ...r, tenant_id: r.tenant_id ?? "" }));
  await dualWriteUpsert("import_runs", rows as unknown as AnyRow[], "id");
}

export async function syncResults(rows: Result[]): Promise<void> {
  await dualWriteUpsert("results", rows as unknown as AnyRow[], "id");
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
): Promise<void> {
  const mapped = rows.map(mapChangelogEntryToRow);
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

export async function syncPages(rows: PageEntity[]): Promise<void> {
  await dualWriteUpsert("pages", rows as unknown as AnyRow[], "id");
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
