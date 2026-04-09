import { readStore } from "../json-store";
import { readDotDataJson } from "../dotdata-json";
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
import type { RenderCheckResult } from "@/domains/pages/render-check";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { ObservationRun } from "@/domains/observations/types";
import type { ConfiguredCompetitorEntry } from "@/domains/competitors/universe-types";

/**
 * `DATA_SOURCE=file` implementation of `SeedDataRepository`.
 * Wraps `readStore` / `readDotDataJson` here only — not for ad-hoc use elsewhere.
 * Returns the same cached `readStore` array references so import mutations stay visible.
 */
export const fileBackend: SeedDataRepository = {
  // Phase 1B
  getImportRuns: async () => readStore<ImportRun>("import-runs"),
  getResults: async () => readStore<Result>("imported-results"),
  getChangelogEntries: async () =>
    readStore<ChangelogEntry>("imported-changes"),
  getOpportunities: async () =>
    readStore<Opportunity>("imported-opportunities"),
  getCompetitors: async () => readStore<Competitor>("imported-competitors"),

  // Phase 1D
  getEventDecisions: async () =>
    readStore<EventDecision>("event-decisions"),
  getCandidateLinks: async () =>
    readStore<CandidateLink>("candidate-links"),
  getPageIssues: async () =>
    readStore<PersistedIssue>("page-issues"),
  getChangeContracts: async () =>
    readStore<ChangeContract>("change-contracts"),

  // Phase 1E
  getPages: async () => readStore<PageEntity>("pages"),

  getPageSnapshots: async () =>
    readDotDataJson<PageSnapshot[]>("page-snapshots") ?? [],

  getGuardrailAlerts: async () =>
    readDotDataJson<GuardrailAlert[]>("page-guardrails") ?? [],

  getCitationEvidenceIndex: async () =>
    readDotDataJson<CitationEvidenceIndex>("citation-evidence-index"),

  getObservationRuns: async () => {
    const raw = readDotDataJson<Record<string, unknown>[]>("observation-runs") ?? [];
    const typed = raw.filter(
      (r): r is Record<string, unknown> & ObservationRun =>
        typeof r === "object" && r !== null && "run_type" in r,
    ) as ObservationRun[];

    type LegacyScanRow = {
      run_id: string;
      started_at: string;
      completed_at: string;
      pages_scanned: number;
      pages_changed: number;
      pages_with_errors: number;
      guardrail_alerts: number;
      critical_count: number;
      regression_count: number;
      improvement_count: number;
    };
    const legacy = readDotDataJson<LegacyScanRow[]>("scan-runs") ?? [];
    const existingIds = new Set(typed.map((r) => r.run_id));
    for (const row of legacy) {
      if (row?.run_id && !existingIds.has(row.run_id)) {
        typed.push({
          ...row,
          run_type: "website_crawl",
          source: "scan-runs.json (legacy)",
          status: "completed",
          scope_label:
            "Owned pages from sitemap scan (legacy row)",
          parser_version: undefined,
          baseline_run_id: null,
        });
      }
    }
    return typed;
  },

  getCompetitorConfigEntries: async () => {
    const raw = readDotDataJson<{ competitors?: ConfiguredCompetitorEntry[] }>(
      "competitor-universe",
    );
    return raw?.competitors?.filter(Boolean) ?? [];
  },

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
