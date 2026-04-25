/**
 * `DATA_SOURCE=supabase` implementation of `SeedDataRepository`.
 * Route-critical tables read from Postgres; supplementary + json-store-only domains
 * still hit disk (`readDotDataJson` / `readStore`) until migrated — same behavior as
 * pre-cutover direct-file access, centralized here.
 */
import { readDotDataJson } from "../dotdata-json";
import { readStore } from "../json-store";
import { getSupabaseAdmin } from "../supabase";
import type { SeedDataRepository } from "./types";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type { EventDecision, CandidateLink } from "@/domains/attribution/types";
import type {
  PersistedIssue,
  RolloutExecution,
  PatternEvidenceRecord,
} from "@/domains/pages/issues";
import type { RolloutWave } from "@/domains/pages/wave-planner";
import type { FrontierOpportunity } from "@/domains/pages/frontier-planner";
import type {
  FrontierAttackPackage,
  TrackedMissingPage,
} from "@/domains/pages/frontier-compiler";
import type { AssetResponse } from "@/domains/pages/asset-response";
import type { OutcomeObservation } from "@/domains/pages/outcome-watch";
import type {
  CompetitorPageEvidence,
  SourcePatternEvidence,
} from "@/domains/pages/competitor-evidence";
import type { PersistedActionState } from "@/domains/actions/types";
import type { PersistedBriefState } from "@/domains/brief-generation/types";
import type { TruthLabel } from "@/domains/attribution/types";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type {
  PageEntity,
  PageSnapshot,
  PageSnapshotDiff,
  CitationEvidenceIndex,
  SitemapReconciliation,
} from "@/domains/pages/types";
import type { AnswerIntelligenceIndex } from "@/domains/answer-intelligence/types";
import type { RenderCheckResult } from "@/domains/pages/render-check";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { ObservationRun } from "@/domains/observations/types";
import type { ConfiguredCompetitorEntry } from "@/domains/competitors/universe-types";
import type { Finding } from "@/domains/scanning/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import { mapRowToEntity } from "./key-mapper";

async function query<T>(table: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

/**
 * Phase 3.5E (2026-04-22) — pages through a table in 1000-row batches. Use
 * this for tables that can exceed PostgREST's default `max-rows` limit
 * (prompt_answer_observations at 11,996 and daily_metric_snapshots at
 * 24,085 both do). One-shot per cold start; results held in-memory by the
 * canonical-store seed layer.
 */
async function queryAllPaged<T>(table: string): Promise<T[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`Supabase query failed on ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function queryMapped<T>(table: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []).map((row) =>
    mapRowToEntity<T>(row as Record<string, unknown>),
  );
}

export const supabaseBackend: SeedDataRepository = {
  // Phase 1B
  getImportRuns: () => query<ImportRun>("import_runs"),
  // results: 1719 rows as of 2026-04-24 — past PostgREST's 1000-row cap.
  getResults: () => queryAllPaged<Result>("results"),
  getChangelogEntries: () => query<ChangelogEntry>("changelog_entries"),
  getOpportunities: () => query<Opportunity>("opportunities"),
  getCompetitors: () => query<Competitor>("competitors"),

  // Phase 1D
  getEventDecisions: () => query<EventDecision>("attribution_decisions"),
  getCandidateLinks: () => query<CandidateLink>("candidate_links"),
  getPageIssues: () => queryMapped<PersistedIssue>("page_issues"),
  getChangeContracts: () => queryMapped<ChangeContract>("change_contracts"),

  // Phase 1E
  // pages: 5929 rows as of 2026-04-24 — past PostgREST's 1000-row cap. Without
  // pagination, buildPageInventory saw only ~3 owned rows on hosted and the
  // resolver fell through to create_new_page for every blocker cluster.
  getPages: () => queryAllPaged<PageEntity>("pages"),
  getPageSnapshots: async () => {
    // Supabase accumulates snapshot history (35 rows per scan).
    // Routes expect only the latest snapshot per page.
    // Order by fetched_at DESC and deduplicate by page_id in application code
    // (PostgREST does not support DISTINCT ON).
    const { data, error } = await getSupabaseAdmin()
      .from("page_snapshots")
      .select("*")
      .order("fetched_at", { ascending: false });
    if (error)
      throw new Error(
        `Supabase query failed on page_snapshots: ${error.message}`,
      );
    const seen = new Set<string>();
    const latest: PageSnapshot[] = [];
    for (const row of (data ?? []) as PageSnapshot[]) {
      if (!seen.has(row.page_id)) {
        seen.add(row.page_id);
        latest.push(row);
      }
    }
    return latest;
  },
  getGuardrailAlerts: () => query<GuardrailAlert>("guardrail_alerts"),

  getCitationEvidenceIndex: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("citation_evidence_index")
      .select("*")
      .eq("id", "current")
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on citation_evidence_index: ${error.message}`,
      );
    if (!data) return null;
    return {
      built_at: data.built_at,
      total_citations_processed: data.total_citations_processed,
      by_page_and_topic: data.by_page_and_topic,
      by_topic: data.by_topic,
      page_to_topics: data.page_to_topics,
    } as CitationEvidenceIndex;
  },

  // Phase 3.5E (2026-04-22) — the `answer_intelligence_index` Supabase table
  // exists and is dual-written on import. Read the `data` jsonb column. Stale
  // previously-disk-only comment removed; file backend still reads disk for
  // DATA_SOURCE=file.
  getAnswerIntelligenceIndex: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("answer_intelligence_index")
      .select("*")
      .eq("id", "current")
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on answer_intelligence_index: ${error.message}`,
      );
    if (!data) return null;
    // Row shape: { id, built_at, data: AnswerIntelligenceIndex }
    return (data.data as AnswerIntelligenceIndex) ?? null;
  },

  getObservationRuns: () => query<ObservationRun>("observation_runs"),
  getCompetitorConfigEntries: () =>
    query<ConfiguredCompetitorEntry>("competitor_config"),

  // Supplementary dotdata — no tables yet; read same files as file mode
  getPageSnapshotDiffs: async () =>
    readDotDataJson<PageSnapshotDiff[]>("page-snapshot-diffs") ?? [],

  getRenderChecks: async () =>
    readDotDataJson<RenderCheckResult[]>("render-checks") ?? [],

  getSitemapReconciliation: async () =>
    readDotDataJson<SitemapReconciliation>("sitemap-reconciliation"),

  getVisibilityObservationRunsExplicit: async () =>
    readDotDataJson<VisibilityObservationRun[]>(
      "visibility-observation-runs",
    ) ?? [],

  getRolloutExecutions: async () =>
    readStore<RolloutExecution>("rollout-executions"),
  getPatternEvidence: async () =>
    readStore<PatternEvidenceRecord>("pattern-evidence"),
  getRolloutWaves: async () => readStore<RolloutWave>("rollout-waves"),
  getFrontierOpportunities: async () =>
    readStore<FrontierOpportunity>("frontier-opportunities"),
  getFrontierAttackPackages: async () =>
    readStore<FrontierAttackPackage>("frontier-attack-packages"),
  getTrackedMissingPages: async () =>
    readStore<TrackedMissingPage>("tracked-missing-pages"),
  getAssetResponses: async () =>
    readStore<AssetResponse>("asset-responses"),
  getOutcomeObservations: async () =>
    readStore<OutcomeObservation>("outcome-observations"),
  getCompetitorPageEvidence: async () =>
    readStore<CompetitorPageEvidence>("competitor-page-evidence"),
  getSourcePatternEvidence: async () =>
    readStore<SourcePatternEvidence>("source-pattern-evidence"),
  getActionStates: async () =>
    readStore<PersistedActionState>("action-states"),
  getBriefStates: async () =>
    readStore<PersistedBriefState>("brief-states", []),
  getTruthLabels: async () => readStore<TruthLabel>("truth-labels"),

  // Phase 7 — scan findings via repository
  getScanFindings: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("scan_findings")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on scan_findings: ${error.message}`,
      );
    return (data ?? []).map((row) =>
      mapRowToEntity<Finding>(row as Record<string, unknown>),
    );
  },
  getPendingScanFindings: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("scan_findings")
      .select("*")
      .eq("status", "pending")
      .order("priority_score", { ascending: false });
    if (error)
      throw new Error(
        `Supabase query failed on scan_findings: ${error.message}`,
      );
    return (data ?? []).map((row) =>
      mapRowToEntity<Finding>(row as Record<string, unknown>),
    );
  },

  // Phase 1a — operator loop stores
  getRecommendationResponses: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("recommendation_responses")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on recommendation_responses: ${error.message}`,
      );
    return (data ?? []).map((row) => ({
      recId: row.rec_id,
      status: row.status,
      respondedAt: row.responded_at,
      deferUntil: row.defer_until,
      targetPageUrl: row.target_page_url ?? null,
      patternId: row.pattern_id ?? null,
    })) as RecommendationResponse[];
  },
  getUrlChangeOutcomes: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("url_change_outcomes")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on url_change_outcomes: ${error.message}`,
      );
    return (data ?? []) as UrlChangeOutcome[];
  },

  // Sprint 6A.1 Phase 12 — specific edits read path. Rows are already
  // snake_cased to match the migration; no key mapping needed.
  getRecommendedEdits: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("recommended_edits")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on recommended_edits: ${error.message}`,
      );
    return (data ?? []) as unknown as RecommendedEditRow[];
  },

  // Sprint 6A.1 Phase 14 — page_element_inventory read path.
  // Phase 15 (2026-04-25): a single scan produces ~4300 rows for 35
  // pages. PostgREST's default `max-rows` is 1000, so a non-paged
  // query silently truncates. Use queryAllPaged like the other
  // big tables.
  getPageElementInventory: async () =>
    queryAllPaged<PageElementInventoryRow>("page_element_inventory"),

  // Phase 3.5E — hero-surface data. Paged reads for the two large tables
  // (prompt_answer_observations 11,996 rows, daily_metric_snapshots 24,085
  // rows) to defeat PostgREST's default 1000-row cap.
  getPromptAnswerObservations: async () =>
    queryAllPaged<PromptAnswerObservation>("prompt_answer_observations"),
  getDailyMetricSnapshots: async () =>
    queryAllPaged<DailyMetricSnapshot>("daily_metric_snapshots"),
  getTrackedEntities: async () =>
    query<TrackedEntity>("tracked_entities"),
  getTrackedPrompts: async () =>
    query<TrackedPrompt>("tracked_prompts"),
};
