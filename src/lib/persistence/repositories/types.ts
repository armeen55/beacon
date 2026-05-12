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
} from "@/domains/pages/competitor-evidence";
import type { CompetitorPageSnapshot } from "@/domains/pages/competitor-page-snapshots";
import type {
  SourcePatternEvidence,
} from "@/domains/pages/competitor-evidence";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type {
  PageEntity,
  PageSummary,
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
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
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
  /**
   * Perf+egress bundle 2 (2026-05-12) — narrow projection of
   * `pages`. Backends select only the 6 columns the projection
   * needs (id, url, canonical_url, is_owned, page_type, topics,
   * tenant_id), reducing wire payload ~80% on routes that don't
   * need full PageEntity fields. Callers that need the full row
   * MUST stay on `getPages()`.
   */
  getPageSummaries(): Promise<PageSummary[]>;
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
  /**
   * T-CompPageBlueprints (2026-05-08) — manually-captured competitor
   * page structure (h1, top h2s, faq questions, meta description).
   * Decoupled lifecycle from `getCompetitorPageEvidence` (citation-
   * derived). File-only v1; same posture as competitor-page-evidence.
   */
  getCompetitorPageSnapshots(): Promise<CompetitorPageSnapshot[]>;
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

  // Sprint 6A.1 Phase 14 (2026-04-24) — page_element_inventory read path.
  // Used by the queue-driven CLI to feed `targetPageElements` into
  // `buildSpecificEditEvidencePacket`. Production-empty until a scan
  // runs after Phase 6's wiring (callers must handle empty gracefully).
  getPageElementInventory(): Promise<PageElementInventoryRow[]>;

  // Phase 3.5E — hosted hero-surface data (visibility score / rankings /
  // competitor comparison / entity universe). File backend wraps existing
  // canonical-store consts; Supabase backend fetches from the corresponding
  // tables with explicit paging for the large ones.
  getPromptAnswerObservations(): Promise<PromptAnswerObservation[]>;
  getDailyMetricSnapshots(): Promise<DailyMetricSnapshot[]>;
  getTrackedEntities(): Promise<TrackedEntity[]>;
  getTrackedPrompts(): Promise<TrackedPrompt[]>;

  // Sprint 7 Phase 7.5a (2026-04-25) — tenant-bound facade. Returns a
  // `TenantRepository` whose every method filters rows down to one tenant.
  // Phase 7.5b/c will convert call sites to `.forTenant(...).getX()`.
  // Phase 7.8+ will move these methods OFF this base so unscoped reads
  // become a compile error.
  forTenant(tenantId: string): TenantRepository;
}

/**
 * Sprint 7 Phase 7.5a — tenant-scoped read interface. Subset of
 * `SeedDataRepository` containing only methods that read from
 * tenant-scoped storage (Supabase tables with a `tenant_id` column or
 * `.data/*.json` files whose rows carry a `tenant_id` field).
 *
 * Methods from `SeedDataRepository` that read GLOBAL stores
 * (change-patterns, business-config, tenants registry, file-only
 * artifacts like the citation evidence index) intentionally stay OFF
 * this interface — global data crosses tenants by design.
 */
/**
 * E3 (operator audit, 2026-05-05) — optional date-window for the two
 * heaviest tenant reads. Callers that only need recent data (e.g.,
 * /today's enrichment rollup operates on the last 7-30 days) can pass
 * a `since` ISO date and avoid pulling the full ~14k-row history.
 *
 * Default behavior unchanged: omitting the option pulls all rows
 * for backwards compatibility. Scripts (verify-daily-poll, materialize,
 * citation-rebuild) that genuinely need full history don't have to
 * change anything.
 */
export type WindowedReadOptions = {
  /** ISO date string (YYYY-MM-DD or full ISO timestamp). Filters the
   *  read at the database with `<column> >= since` so the rows never
   *  cross the wire. */
  since?: string;
};

export interface TenantRepository {
  getPages(): Promise<PageEntity[]>;
  /** Perf+egress bundle 2 — narrow projection of `pages`. See base
   *  `SeedDataRepository.getPageSummaries` docstring. */
  getPageSummaries(): Promise<PageSummary[]>;
  getPageSnapshots(): Promise<PageSnapshot[]>;
  getPageElementInventory(): Promise<PageElementInventoryRow[]>;
  getRecommendedEdits(): Promise<RecommendedEditRow[]>;
  getRecommendationResponses(): Promise<RecommendationResponse[]>;
  getChangelogEntries(): Promise<ChangelogEntry[]>;
  getScanFindings(): Promise<Finding[]>;
  getPendingScanFindings(): Promise<Finding[]>;
  getGuardrailAlerts(): Promise<GuardrailAlert[]>;
  getObservationRuns(): Promise<ObservationRun[]>;
  getResults(): Promise<Result[]>;
  getImportRuns(): Promise<ImportRun[]>;
  /** E3 — accepts optional `{ since }` date window. Default: full history. */
  getDailyMetricSnapshots(
    options?: WindowedReadOptions,
  ): Promise<DailyMetricSnapshot[]>;
  /** E3 — accepts optional `{ since }` date window. Default: full history. */
  getPromptAnswerObservations(
    options?: WindowedReadOptions,
  ): Promise<PromptAnswerObservation[]>;
  getUrlChangeOutcomes(): Promise<UrlChangeOutcome[]>;
  /**
   * Customer-2 isolation fix (operator audit, 2026-05-06) —
   * tenant-scoped reads for `tracked_prompts` and `tracked_entities`.
   *
   * Both stores are TENANT_SCOPED in `store-classification.ts`, but
   * the canonical fresh-load path was still calling the unscoped
   * `repo.getTrackedPrompts()` / `repo.getTrackedEntities()`. With
   * customer-2 onboarding on the horizon, that would silently mix
   * Ritz's prompts + competitors into customer-2's /today
   * leaderboard. These tenant-scoped methods close the leak before
   * any second-tenant data lands.
   *
   * Filter shapes:
   *   • File backend: in-memory `tenant_id === tenantId` (rows on
   *     disk already carry both `tenant_id` and `account_id`).
   *   • Supabase backend: `.eq("account_id", tenantSlug)` because the
   *     `tracked_prompts` / `tracked_entities` tables use
   *     `account_id` (the slug) as their tenant-scoping column,
   *     not `tenant_id`. Slug is resolved from the `tenants`
   *     registry via `getTenant(tenantId)`.
   */
  getTrackedPrompts(): Promise<TrackedPrompt[]>;
  getTrackedEntities(): Promise<TrackedEntity[]>;
}
