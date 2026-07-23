import { readStore } from "../json-store";
import { readDotDataJson } from "../dotdata-json";
import type { SeedDataRepository } from "./types";
import { buildTenantRepo } from "./tenant-repo";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type {
  CompetitorPageEvidence,
  SourcePatternEvidence,
} from "@/domains/pages/competitor-evidence";
import type { CompetitorPageSnapshot } from "@/domains/pages/competitor-page-snapshots";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type {
  PageEntity,
  PageSnapshot,
} from "@/domains/pages/types";
import type { ObservationRun } from "@/domains/observations/types";
import { readObservationRunsMergedSync } from "@/domains/observations/observation-runs-merge";
import { getFindings } from "@/domains/scanning/findings-store";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import type { RecommendedEditRow } from "@/domains/changes/recommended-edits-persistence";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";

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
  // (getEventDecisions / getCandidateLinks / getPageIssues removed
  // 2026-07-21, CORE 100K Lane O: zero callers.)
  getChangeContracts: async () =>
    readStore<ChangeContract>("change-contracts"),

  // Phase 1E
  getPages: async () => readStore<PageEntity>("pages"),

  getPageSnapshots: async () =>
    (await readDotDataJson<PageSnapshot[]>("page-snapshots")) ?? [],

  // Link-graph feed (2026-06-12): file rows carry internal_links
  // in full — derive the narrow graph rows.
  getPageSnapshotLinkGraphs: async () =>
    ((await readDotDataJson<PageSnapshot[]>("page-snapshots")) ?? [])
      .filter((s) => Array.isArray(s.internal_links) && s.internal_links.length > 0)
      .map((s) => ({
        page_id: s.page_id,
        url: s.url,
        fetched_at: s.fetched_at,
        tenant_id: s.tenant_id ?? "",
        internal_links: s.internal_links!,
      })),

  getObservationRuns: async () => await readObservationRunsMergedSync(),

  // (Dead columns removed 2026-07-21, CORE 100K Lane O: page-snapshot-diffs,
  // render-checks, legacy-global sitemap-reconciliation, visibility runs,
  // rollout/pattern/frontier/wave/asset/outcome/truth-label reads,
  // page summaries, citation/answer-intel index reads — zero callers.)
  getCompetitorPageSnapshots: async () =>
    readStore<CompetitorPageSnapshot>("competitor-page-snapshots"),
  getCompetitorPageEvidence: async () =>
    readStore<CompetitorPageEvidence>("competitor-page-evidence"),
  getSourcePatternEvidence: async () =>
    readStore<SourcePatternEvidence>("source-pattern-evidence"),

  // Phase 7 — scan findings via repository
  getScanFindings: async () => getFindings(),

  // Phase 1a — operator loop stores
  getRecommendationResponses: async () =>
    readStore<RecommendationResponse>("recommendation-responses"),
  getUrlChangeOutcomes: async () =>
    readStore<UrlChangeOutcome>("url-change-outcomes"),

  // Sprint 6A.1 Phase 12 — specific edits read path.
  // .data/recommended-edits.json — replace-by-id semantics from
  // `runProviderAndPersist`. Local-mode reads through readDotDataJson;
  // empty array when missing.
  getRecommendedEdits: async () =>
    (await readDotDataJson<RecommendedEditRow[]>("recommended-edits")) ?? [],

  // Phase 3.5E — hero-surface data (local mode reads same files canonical-store
  // reads at module init; arrays are already hot in memory, so these re-reads
  // return the same cached values without extra disk hits).
  // Emergency P0 (2026-05-12) — file backend ignores the promptId option
  // because the array is already hot in process; tenant-repo applies the
  // filter at the boundary. Supabase backend pushes it down to the query.
  getPromptAnswerObservations: async () =>
    readStore<PromptAnswerObservation>("prompt-answer-observations"),
  getDailyMetricSnapshots: async () =>
    readStore<DailyMetricSnapshot>("daily-metric-snapshots"),
  getTrackedEntities: async () =>
    readStore<TrackedEntity>("tracked-entities"),
  getTrackedPrompts: async () =>
    readStore<TrackedPrompt>("tracked-prompts"),

  // Sprint 7 Phase 7.5a (2026-04-25) — tenant-bound facade.
  forTenant(tenantId: string) {
    return buildTenantRepo(fileBackend, tenantId);
  },
};
