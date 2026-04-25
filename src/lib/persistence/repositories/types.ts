import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type {
  EventDecision,
  CandidateLink,
  TruthLabel,
} from "@/domains/attribution/types";
import type { Finding } from "@/domains/scanning/types";
import type { PersistedActionState } from "@/domains/actions/types";
import type { PersistedBriefState } from "@/domains/brief-generation/types";
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
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";

/**
 * Async read interface for route-critical and repository-routed stores.
 *
 * **Canonical runtime:** With `DATA_SOURCE=supabase`, Postgres is the read source
 * for tables that exist; file/json-store remains the durability + rollback path
 * via dual-write and `DATA_SOURCE=file`.
 *
 * App code: use `getRepository()` — not `readStore` / raw `readDotDataJson` —
 * except documented exceptions (see `docs/architecture.md`).
 */
export interface SeedDataRepository {
  // Phase 1B — seed-data entities
  getImportRuns(): Promise<ImportRun[]>;
  getResults(): Promise<Result[]>;
  getChangelogEntries(): Promise<ChangelogEntry[]>;
  getOpportunities(): Promise<Opportunity[]>;
  getCompetitors(): Promise<Competitor[]>;

  // Phase 1D — centralized store modules
  getEventDecisions(): Promise<EventDecision[]>;
  getCandidateLinks(): Promise<CandidateLink[]>;
  getPageIssues(): Promise<PersistedIssue[]>;
  getChangeContracts(): Promise<ChangeContract[]>;

  // Phase 1E — remaining route-critical stores
  getPages(): Promise<PageEntity[]>;
  getPageSnapshots(): Promise<PageSnapshot[]>;
  getGuardrailAlerts(): Promise<GuardrailAlert[]>;
  getCitationEvidenceIndex(): Promise<CitationEvidenceIndex | null>;

  // Phase 7 — scan findings via repository
  getScanFindings(): Promise<Finding[]>;
  getPendingScanFindings(): Promise<Finding[]>;
  getAnswerIntelligenceIndex(): Promise<AnswerIntelligenceIndex | null>;
  getObservationRuns(): Promise<ObservationRun[]>;
  getCompetitorConfigEntries(): Promise<ConfiguredCompetitorEntry[]>;

  /**
   * Supplementary `.data/*.json` reads — no DB tables yet. Both backends read
   * from disk so Supabase-default mode still sees the same files as before.
   */
  getPageSnapshotDiffs(): Promise<PageSnapshotDiff[]>;
  getRenderChecks(): Promise<RenderCheckResult[]>;
  getSitemapReconciliation(): Promise<SitemapReconciliation | null>;
  getVisibilityObservationRunsExplicit(): Promise<VisibilityObservationRun[]>;

  /**
   * json-store-backed operator / pages domain state — no Postgres tables yet.
   * Both backends delegate to `readStore` so DATA_SOURCE=supabase keeps the same
   * in-process cached array references as file mode (mutation + writeStore paths).
   */
  getRolloutExecutions(): Promise<RolloutExecution[]>;
  getPatternEvidence(): Promise<PatternEvidenceRecord[]>;
  getRolloutWaves(): Promise<RolloutWave[]>;
  getFrontierOpportunities(): Promise<FrontierOpportunity[]>;
  getFrontierAttackPackages(): Promise<FrontierAttackPackage[]>;
  getTrackedMissingPages(): Promise<TrackedMissingPage[]>;
  getAssetResponses(): Promise<AssetResponse[]>;
  getOutcomeObservations(): Promise<OutcomeObservation[]>;
  getCompetitorPageEvidence(): Promise<CompetitorPageEvidence[]>;
  getSourcePatternEvidence(): Promise<SourcePatternEvidence[]>;
  getActionStates(): Promise<PersistedActionState[]>;
  getBriefStates(): Promise<PersistedBriefState[]>;
  getTruthLabels(): Promise<TruthLabel[]>;

  // Phase 1a — operator loop stores
  getRecommendationResponses(): Promise<RecommendationResponse[]>;
  getUrlChangeOutcomes(): Promise<UrlChangeOutcome[]>;

  // Sprint 6A.1 Phase 12 (2026-04-24) — specific edits read path.
  // Fetched fresh per request on /recommendations (Sprint 1 pattern).
  getRecommendedEdits(): Promise<RecommendedEditRow[]>;

  // Phase 3.5E — hosted hero-surface data (visibility score / rankings /
  // competitor comparison / entity universe). File backend wraps existing
  // canonical-store consts; Supabase backend fetches from the corresponding
  // tables with explicit paging for the large ones.
  getPromptAnswerObservations(): Promise<PromptAnswerObservation[]>;
  getDailyMetricSnapshots(): Promise<DailyMetricSnapshot[]>;
  getTrackedEntities(): Promise<TrackedEntity[]>;
  getTrackedPrompts(): Promise<TrackedPrompt[]>;
}
