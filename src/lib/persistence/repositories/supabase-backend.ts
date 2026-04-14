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
import { mapRowToEntity } from "./key-mapper";

async function query<T>(table: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []) as T[];
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
  getResults: () => query<Result>("results"),
  getChangelogEntries: () => query<ChangelogEntry>("changelog_entries"),
  getOpportunities: () => query<Opportunity>("opportunities"),
  getCompetitors: () => query<Competitor>("competitors"),

  // Phase 1D
  getEventDecisions: () => query<EventDecision>("attribution_decisions"),
  getCandidateLinks: () => query<CandidateLink>("candidate_links"),
  getPageIssues: () => queryMapped<PersistedIssue>("page_issues"),
  getChangeContracts: () => queryMapped<ChangeContract>("change_contracts"),

  // Phase 1E
  getPages: () => query<PageEntity>("pages"),
  getPageSnapshots: () => query<PageSnapshot>("page_snapshots"),
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

  // Answer intelligence — no Supabase table yet; read from disk (same as file backend)
  getAnswerIntelligenceIndex: async () =>
    readDotDataJson<AnswerIntelligenceIndex>("answer-intelligence-index"),

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
};
