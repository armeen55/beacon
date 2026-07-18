import "server-only";

import type { TopicMentionsRunResult } from "@/domains/ai-visibility/run-topic-mentions";
import type { EnginePollResult } from "@/domains/ai-visibility/run-engine-poll";
import type { NativeTeardownRunSummary } from "@/domains/demand-graph/native-teardown-runner";
import type { PrepareMovesSummary } from "@/domains/demand-graph/prepare-today-moves";
import type { QuestionUniverseRebuildResult } from "@/domains/research/question-universe-loader";
import type { CitationIntelligenceRefreshResult } from "@/domains/ai-visibility/citation-intelligence-snapshot";
import type { ClaimGraphRebuildResult } from "@/domains/provenance/claim-graph-loader";
import type { PageRankRebuildResult } from "@/domains/linkgraph/internal-pagerank-loader";
import type { DisplacementCheckSummary } from "@/domains/serp/displacement-check";
import type { EnrichmentRunResult } from "@/domains/serp/research-enrichment-producer";
import type { ResearchPackLite } from "@/domains/serp/research-enrichment";
import type { KeywordGapRunResult } from "@/domains/serp/keyword-gap-producer";
import type { StealLaneRunSummary } from "@/domains/serp/serp-steal-lane";
import type { FinalKeywordDemandResult } from "@/domains/serp/final-keyword-demand";
import type { PrepareSummary as PrepareNewPagesSummary } from "@/domains/serp/prepare-create-page-verdicts";
import type {
  WarmRunReceipt,
  WarmRunSummary,
  WarmStepReceipt,
  AutonomousPipelineStage,
} from "./warm-receipt-store";

const STEP_TIMEOUT_MS = 120_000;
const EMPTY_DISPLACEMENT: DisplacementCheckSummary = {
  checked: 0,
  cached: 0,
  skippedRecent: 0,
  skippedNoBudget: 0,
  costUsd: 0,
  verdicts: [],
};
const EMPTY_STEAL: StealLaneRunSummary = {
  beatenKeywordsFound: 0,
  storedSerpHits: 0,
  livePullsUsed: 0,
  liveCostUsd: 0,
  briefsBuilt: 0,
  teardownsTorndown: 0,
  briefs: [],
};
const EMPTY_NATIVE: NativeTeardownRunSummary = {
  promptsAnalyzed: 0,
  torndownPages: 0,
  fromCache: 0,
  verdicts: [],
  results: [],
};
const EMPTY_FINAL_KEYWORDS: FinalKeywordDemandResult = {
  status: "error",
  candidates: 0,
  missing: 0,
  checked: 0,
  withVolume: 0,
  costUsd: 0,
  topicSeedsChecked: 0,
  relatedKeywordsChecked: 0,
};
const EMPTY_PREPARE: PrepareMovesSummary = {
  considered: 0,
  prepared: 0,
  readyToReview: 0,
  draftReady: 0,
  cached: 0,
  failed: 0,
  regenerated: 0,
  stoppedForBudget: false,
  llmCostUsd: 0,
  winnabilityHeld: 0,
  serpCostUsd: 0,
  serpQueriesChecked: 0,
  serpWinnerPagesAnalyzed: 0,
  serpWinnerPagesFromCache: 0,
  outcomes: [],
};
const EMPTY_NEW_PAGES: PrepareNewPagesSummary = {
  validated: 0,
  cached: 0,
  skipped: 0,
  briefs: 0,
  costUsd: 0,
  briefCostUsd: 0,
  capped: false,
  winnabilityCostUsd: 0,
  skippedQualityGate: [],
  skippedOwnedByRegistry: [],
};

export type AutonomousResearchDeps = {
  /** Publish a usable ranking from already-cached evidence before any long or
   * paid research. Deep research may enrich and replace it later. */
  publishUsableSurfaces: (tenantId: string) => Promise<void>;
  prepareTopFive: (tenantId: string, now: Date) => Promise<PrepareMovesSummary>;
  refreshGraph: (tenantId: string, now: Date) => Promise<void>;
  auditCompetitors: (tenantId: string) => Promise<{ audited: number; targets: number; cached: number }>;
  mineCompetitorKeywords: (tenantId: string) => Promise<KeywordGapRunResult>;
  buildResearchPacks: (tenantId: string) => Promise<ResearchPackLite[]>;
  enrichResearch: (packs: ResearchPackLite[]) => Promise<EnrichmentRunResult>;
  pollAiEngines: (tenantId: string) => Promise<EnginePollResult>;
  pollAiTopics: (tenantId: string) => Promise<TopicMentionsRunResult>;
  rebuildQuestions: (tenantId: string) => Promise<QuestionUniverseRebuildResult>;
  rebuildClaims: (tenantId: string) => Promise<ClaimGraphRebuildResult>;
  rebuildInternalAuthority: (tenantId: string) => Promise<PageRankRebuildResult>;
  refreshCitationIntelligence: (tenantId: string, now: Date) => Promise<CitationIntelligenceRefreshResult>;
  checkDisplacement: (tenantId: string, now: Date) => Promise<DisplacementCheckSummary>;
  runStealLane: (tenantId: string, now: Date) => Promise<StealLaneRunSummary>;
  runNativeTeardown: (tenantId: string) => Promise<NativeTeardownRunSummary>;
  completeFinalKeywordDemand: (tenantId: string) => Promise<FinalKeywordDemandResult>;
  prepareNewPages: (tenantId: string) => Promise<PrepareNewPagesSummary>;
  prepareMoves: (tenantId: string, now: Date) => Promise<PrepareMovesSummary>;
  finishSurfaces: (
    tenantId: string,
    now: Date,
    acquired: {
      displacement: DisplacementCheckSummary;
      steal: StealLaneRunSummary;
      native: NativeTeardownRunSummary;
      prepare: (tenantId: string, now: Date) => Promise<PrepareMovesSummary>;
    },
  ) => Promise<WarmRunReceipt>;
};

async function defaultRefreshGraph(tenantId: string, now: Date): Promise<void> {
  const [{ loadDemandGraphForTenant }, { writeGraphSnapshot }] = await Promise.all([
    import("@/domains/demand-graph/load-graph"),
    import("@/domains/demand-graph/graph-snapshot-store"),
  ]);
  const graph = await loadDemandGraphForTenant(tenantId, now);
  await writeGraphSnapshot(graph, now.toISOString(), tenantId);
}

async function defaultBuildResearchPacks(tenantId: string): Promise<ResearchPackLite[]> {
  const { buildTodayMovesData } = await import("@/app/(shell)/today-moves-data");
  const data = await buildTodayMovesData(tenantId, { limit: 5 });
  return data.moves
    .filter((move) => move.researchPack != null)
    .slice(0, 5)
    .map((move) => ({
      url: move.targetUrl,
      primaryIntent: move.researchPack!.primaryIntent,
      own: move.researchPack!.own,
      sibling: move.researchPack!.sibling,
    }));
}

const defaultDeps: AutonomousResearchDeps = {
  publishUsableSurfaces: async (tenantId) => {
    const { refreshCustomerSurface } = await import("@/app/(shell)/customer-surface-refresh");
    await refreshCustomerSurface(tenantId);
  },
  prepareTopFive: async (tenantId, now) => {
    const [{ prepareTodayMovesForTenant }, { readChangesSurface }] = await Promise.all([
      import("@/domains/demand-graph/prepare-today-moves"),
      import("@/app/(shell)/changes-surface-store"),
    ]);
    const rankedEntries = (await readChangesSurface(tenantId).catch(() => null))?.view.rankedPreparationEntries ?? [];
    return prepareTodayMovesForTenant(tenantId, {
      maxN: 5,
      maxUsd: 0.15,
      now: () => now,
      rankedEntries,
    });
  },
  refreshGraph: defaultRefreshGraph,
  auditCompetitors: async (tenantId) => {
    const { auditTopCompetitorsForTenant } = await import("@/domains/demand-graph/competitor-page-audit");
    const result = await auditTopCompetitorsForTenant({ tenantId, limit: 12 });
    return { audited: result.audited.length, targets: result.targets, cached: result.cached };
  },
  mineCompetitorKeywords: async (tenantId) => {
    const { produceKeywordGaps } = await import("@/domains/serp/keyword-gap-producer");
    return await produceKeywordGaps(tenantId);
  },
  buildResearchPacks: defaultBuildResearchPacks,
  enrichResearch: async (packs) => {
    const { enrichResearchPacks } = await import("@/domains/serp/research-enrichment-producer");
    return await enrichResearchPacks(packs);
  },
  pollAiEngines: async (tenantId) => {
    const { runEnginePollForTenant } = await import("@/domains/ai-visibility/run-engine-poll");
    return await runEnginePollForTenant(tenantId);
  },
  pollAiTopics: async (tenantId) => {
    const { runTopicMentionsForTenant } = await import("@/domains/ai-visibility/run-topic-mentions");
    return await runTopicMentionsForTenant(tenantId);
  },
  rebuildQuestions: async (tenantId) => {
    const { rebuildQuestionUniverseForTenant } = await import("@/domains/research/question-universe-loader");
    return await rebuildQuestionUniverseForTenant(tenantId);
  },
  rebuildClaims: async (tenantId) => {
    const { rebuildClaimGraphForTenant } = await import("@/domains/provenance/claim-graph-loader");
    return await rebuildClaimGraphForTenant(tenantId);
  },
  rebuildInternalAuthority: async (tenantId) => {
    const { rebuildInternalPageRankForTenant } = await import("@/domains/linkgraph/internal-pagerank-loader");
    return await rebuildInternalPageRankForTenant(tenantId);
  },
  refreshCitationIntelligence: async (tenantId, now) => {
    const { refreshCitationIntelligenceForTenant } = await import("@/domains/ai-visibility/citation-intelligence-snapshot");
    return await refreshCitationIntelligenceForTenant(tenantId, now);
  },
  checkDisplacement: async (tenantId, now) => {
    const { runDisplacementCheckForTenant } = await import("@/domains/serp/displacement-check");
    return await runDisplacementCheckForTenant(tenantId, { maxChecks: 3, now: () => now });
  },
  runStealLane: async (tenantId, now) => {
    const { runStealLaneForTenant } = await import("@/domains/serp/serp-steal-lane");
    return await runStealLaneForTenant(tenantId, { maxKeywords: 10, maxLiveSerpPulls: 5, now: () => now });
  },
  runNativeTeardown: async (tenantId) => {
    const { runNativeTeardownForTenant } = await import("@/domains/demand-graph/native-teardown-runner");
    return await runNativeTeardownForTenant(tenantId, { maxPrompts: 10 });
  },
  completeFinalKeywordDemand: async (tenantId) => {
    const { completeFinalKeywordDemandForTenant } = await import("@/domains/serp/final-keyword-demand");
    return await completeFinalKeywordDemandForTenant(tenantId, { maxQueries: 25 });
  },
  prepareNewPages: async (tenantId) => {
    const { prepareCreatePageVerdicts } = await import("@/domains/serp/prepare-create-page-verdicts");
    return await prepareCreatePageVerdicts(tenantId, {
      maxValidations: 5,
      maxBriefs: 5,
      skipExistingBrief: true,
    });
  },
  prepareMoves: async (tenantId, now) => {
    const [{ prepareTodayMovesForTenant }, { readChangesSurface }] = await Promise.all([
      import("@/domains/demand-graph/prepare-today-moves"),
      import("@/app/(shell)/changes-surface-store"),
    ]);
    const rankedEntries = (await readChangesSurface(tenantId).catch(() => null))
      ?.view.rankedPreparationEntries ?? [];
    return await prepareTodayMovesForTenant(tenantId, {
      maxN: 5,
      maxUsd: 0.15,
      now: () => now,
      rankedEntries,
    });
  },
  finishSurfaces: async (tenantId, now, acquired) => {
    const { warmTenantCaches } = await import("./warm-caches");
    return await warmTenantCaches(tenantId, now, {
      runDisplacementChecks: async () => acquired.displacement,
      runStealLane: async () => acquired.steal,
      runNativeTeardown: async () => acquired.native,
      isPrepareAheadEnabled: async () => true,
      runPrepareAhead: acquired.prepare,
    });
  },
};

export const AUTONOMOUS_PIPELINE_STAGES: readonly AutonomousPipelineStage[] = [
  "baseline", "graph", "competitors", "keywords", "ai", "knowledge", "opportunities", "finalize",
];

type AutonomousRunConfig = {
  resume?: WarmRunReceipt | null;
  onCheckpoint?: (receipt: WarmRunReceipt) => Promise<void>;
};

function emptySummary(): WarmRunSummary {
  return {
    dataForSeoStatus: "disabled", competitorPagesAnalyzed: 0, competitorPagesRefreshed: 0,
    competitorsMined: 0, keywordGapsFound: 0, cloneBriefsBuilt: 0, keywordTermsPlanned: 0,
    serpPatternsWritten: 0, aiTopicsPolled: 0, aiCitationRecords: 0, aiEnginePrompts: 0,
    aiEnginesChecked: 0, aiObservationsWritten: 0, aiCitationGaps: 0, questionsRanked: 0,
    uncoveredQuestions: 0, claimsChecked: 0, conflictingClaims: 0, pagesMapped: 0,
    orphanPagesFound: 0, beatenKeywords: 0, stealBriefsBuilt: 0, nativePromptsAnalyzed: 0,
    citedPagesAnalyzed: 0, movesPrepared: 0, readyToReview: 0, draftsRegenerated: 0, spendUsd: 0,
  };
}

async function runStep<T>(
  name: string,
  fallback: T,
  run: () => Promise<T>,
): Promise<{ receipt: WarmStepReceipt; value: T }> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} exceeded 120 seconds`)), STEP_TIMEOUT_MS);
      }),
    ]);
    return { receipt: { name, ok: true, ms: Date.now() - startedAt }, value };
  } catch (error) {
    return {
      receipt: {
        name,
        ok: false,
        ms: Date.now() - startedAt,
        note: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      },
      value: fallback,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One bounded, tenant-explicit research-before-ranking pass. All paid producers
 * retain their own cache, dry-run, ledger and global/monthly budget guards.
 * Failures are recorded at a durable stage boundary and stop dependent work.
 * A later visit resumes from the first unfinished stage.
 */
export async function runAutonomousResearchForTenant(
  tenantId: string,
  now: Date = new Date(),
  depsOverride: Partial<AutonomousResearchDeps> = {},
  config: AutonomousRunConfig = {},
): Promise<WarmRunReceipt> {
  const deps = { ...defaultDeps, ...depsOverride };
  const startedAt = Date.now();
  const steps: WarmStepReceipt[] = [];
  const date = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const resumed = config.resume?.date === date && config.resume.pipeline?.version === 1 ? config.resume : null;
  const completed = new Set<AutonomousPipelineStage>(resumed?.pipeline?.completedStages ?? []);
  const summary: WarmRunSummary = { ...emptySummary(), ...(resumed?.summary ?? {}) };
  let lastReceipt: WarmRunReceipt | null = null;

  const checkpoint = async (stage: AutonomousPipelineStage, receipts: WarmStepReceipt[]) => {
    steps.push(...receipts);
    const stageOk = receipts.every((receipt) => receipt.ok);
    if (stageOk) completed.add(stage);
    const nextStage = AUTONOMOUS_PIPELINE_STAGES.find((candidate) => !completed.has(candidate)) ?? null;
    lastReceipt = {
      tenant_id: tenantId,
      date,
      ran_at: now.toISOString(),
      ok: nextStage == null,
      totalMs: Date.now() - startedAt,
      steps: [...steps],
      trigger: "visit",
      summary: { ...summary },
      pipeline: {
        version: 1,
        completedStages: AUTONOMOUS_PIPELINE_STAGES.filter((candidate) => completed.has(candidate)),
        nextStage,
        updatedAt: new Date().toISOString(),
      },
    };
    if (config.onCheckpoint) await config.onCheckpoint(lastReceipt);
    return stageOk;
  };

  let displacement = EMPTY_DISPLACEMENT;
  let steal = EMPTY_STEAL;
  let native = EMPTY_NATIVE;
  let opportunitiesRanNow = false;

  if (!completed.has("baseline")) {
    const usable = await runStep("publish-usable-surfaces", undefined, () => deps.publishUsableSurfaces(tenantId));
    const prepared = await runStep("prepare-top-five", EMPTY_PREPARE, () => deps.prepareTopFive(tenantId, now));
    const republished = await runStep("publish-prepared-top-five", undefined, () => deps.publishUsableSurfaces(tenantId));
    summary.movesPrepared = prepared.value.prepared;
    summary.readyToReview = prepared.value.readyToReview;
    summary.draftsRegenerated = prepared.value.regenerated;
    summary.finalSerpQueriesChecked = prepared.value.serpQueriesChecked ?? 0;
    summary.finalSerpWinnersAnalyzed = prepared.value.serpWinnerPagesAnalyzed ?? 0;
    summary.spendUsd = Number((summary.spendUsd + prepared.value.llmCostUsd + prepared.value.serpCostUsd).toFixed(3));
    if (!(await checkpoint("baseline", [usable.receipt, prepared.receipt, republished.receipt]))) return lastReceipt!;
  }

  if (!completed.has("graph")) {
    const graph = await runStep("seed-demand-graph", undefined, () => deps.refreshGraph(tenantId, now));
    if (!(await checkpoint("graph", [graph.receipt]))) return lastReceipt!;
  }

  if (!completed.has("competitors")) {
    const competitors = await runStep("competitor-teardown", { audited: 0, targets: 0, cached: 0 }, () => deps.auditCompetitors(tenantId));
    summary.competitorPagesAnalyzed = competitors.value.targets;
    summary.competitorPagesRefreshed = Math.max(0, competitors.value.audited - competitors.value.cached);
    if (!(await checkpoint("competitors", [competitors.receipt]))) return lastReceipt!;
  }

  if (!completed.has("keywords")) {
    const keywordGaps = await runStep<KeywordGapRunResult | null>("competitor-keyword-mining", null, () => deps.mineCompetitorKeywords(tenantId));
    const packs = await runStep("research-pack-selection", [] as ResearchPackLite[], () => deps.buildResearchPacks(tenantId));
    const enrichment = await runStep<EnrichmentRunResult | null>("keyword-serp-enrichment", null, () => deps.enrichResearch(packs.value));
    summary.competitorsMined = keywordGaps.value?.competitors.length ?? 0;
    summary.keywordGapsFound = keywordGaps.value?.gapsFound ?? 0;
    summary.cloneBriefsBuilt = keywordGaps.value?.cloneBriefs.length ?? 0;
    summary.pageKeywordsChecked = keywordGaps.value?.pageKeywordsFound ?? 0;
    summary.relatedKeywordsChecked = keywordGaps.value?.relatedKeywordsFound ?? 0;
    summary.keywordTermsPlanned = enrichment.value?.plan.volumeTerms.length ?? 0;
    summary.serpPatternsWritten = enrichment.value?.patternsWritten ?? 0;
    summary.dataForSeoStatus = enrichment.value?.configured !== true || keywordGaps.value?.status === "disabled"
      ? "disabled"
      : enrichment.value.mode === "dry_run" || keywordGaps.value?.status === "dry_run" ? "dry_run" : "live";
    summary.spendUsd = Number((summary.spendUsd + (keywordGaps.value?.spentUsd ?? 0) + (enrichment.value?.spentUsd ?? 0)).toFixed(3));
    if (!(await checkpoint("keywords", [keywordGaps.receipt, packs.receipt, enrichment.receipt]))) return lastReceipt!;
  }

  if (!completed.has("ai")) {
    const enginePoll = await runStep<EnginePollResult | null>("multi-engine-aeo-poll", null, () => deps.pollAiEngines(tenantId));
    const topics = await runStep<TopicMentionsRunResult | null>("ai-citation-fanout", null, () => deps.pollAiTopics(tenantId));
    summary.aiEnginePollStatus = enginePoll.value?.status ?? "not_run";
    summary.aiTopicsPolled = topics.value?.topics.length ?? 0;
    summary.aiCitationRecords = topics.value?.records ?? 0;
    summary.aiEnginePrompts = enginePoll.value?.promptsRequested ?? 0;
    summary.aiEnginesChecked = enginePoll.value?.enginesChecked.length ?? 0;
    summary.aiObservationsWritten = enginePoll.value?.observationsWritten ?? 0;
    summary.aiCitationGaps = enginePoll.value?.gaps ?? 0;
    summary.spendUsd = Number((summary.spendUsd + (topics.value?.costUsd ?? 0) + (enginePoll.value?.engines.reduce((sum, engine) => sum + engine.costUsd, 0) ?? 0)).toFixed(3));
    if (!(await checkpoint("ai", [enginePoll.receipt, topics.receipt]))) return lastReceipt!;
  }

  if (!completed.has("knowledge")) {
    // These four reads derive independent, $0 snapshots from already-stored
    // evidence. Run them together so adding citation learning does not extend
    // the operator's background wait by the sum of four database scans.
    const [questions, claims, authority, citationIntel] = await Promise.all([
      runStep<QuestionUniverseRebuildResult | null>("question-universe", null, () => deps.rebuildQuestions(tenantId)),
      runStep<ClaimGraphRebuildResult | null>("factual-claim-graph", null, () => deps.rebuildClaims(tenantId)),
      runStep<PageRankRebuildResult | null>("internal-authority-map", null, () => deps.rebuildInternalAuthority(tenantId)),
      runStep<CitationIntelligenceRefreshResult | null>("citation-intelligence", null, () => deps.refreshCitationIntelligence(tenantId, now)),
    ]);
    summary.questionsRanked = questions.value?.rows ?? 0;
    summary.uncoveredQuestions = questions.value?.uncovered ?? 0;
    summary.claimsChecked = claims.value?.claims ?? 0;
    summary.conflictingClaims = claims.value?.conflicting ?? 0;
    summary.pagesMapped = authority.value?.pages ?? 0;
    summary.orphanPagesFound = authority.value?.orphaned ?? 0;
    summary.citationPatternsMined = citationIntel.value?.patternsMined ?? 0;
    summary.answerDriftEvents = citationIntel.value?.driftEvents ?? 0;
    summary.secondOrderDomains = citationIntel.value?.secondOrderDomains ?? 0;
    if (!(await checkpoint("knowledge", [questions.receipt, claims.receipt, authority.receipt, citationIntel.receipt]))) return lastReceipt!;
  }

  if (!completed.has("opportunities")) {
    const lossRun = await runStep("loss-reflex", EMPTY_DISPLACEMENT, () => deps.checkDisplacement(tenantId, now));
    const stealRun = await runStep("serp-steal", EMPTY_STEAL, () => deps.runStealLane(tenantId, now));
    const nativeRun = await runStep("native-citation-teardown", EMPTY_NATIVE, () => deps.runNativeTeardown(tenantId));
    const finalKeywords = await runStep("final-keyword-demand", EMPTY_FINAL_KEYWORDS, () => deps.completeFinalKeywordDemand(tenantId));
    const newPages = await runStep("prepare-new-pages", EMPTY_NEW_PAGES, () => deps.prepareNewPages(tenantId));
    displacement = lossRun.value;
    steal = stealRun.value;
    native = nativeRun.value;
    opportunitiesRanNow = true;
    summary.beatenKeywords = steal.beatenKeywordsFound;
    summary.stealBriefsBuilt = steal.briefsBuilt;
    summary.nativePromptsAnalyzed = native.promptsAnalyzed;
    summary.citedPagesAnalyzed = native.torndownPages;
    summary.finalKeywordTermsChecked = finalKeywords.value.checked;
    summary.relatedKeywordsChecked = (summary.relatedKeywordsChecked ?? 0) + (finalKeywords.value.relatedKeywordsChecked ?? 0);
    summary.newPageBriefsPrepared = newPages.value.briefs;
    summary.spendUsd = Number((summary.spendUsd + displacement.costUsd + steal.liveCostUsd + finalKeywords.value.costUsd + newPages.value.costUsd + newPages.value.briefCostUsd + newPages.value.winnabilityCostUsd).toFixed(3));
    if (!(await checkpoint("opportunities", [lossRun.receipt, stealRun.receipt, nativeRun.receipt, finalKeywords.receipt, newPages.receipt]))) return lastReceipt!;
  }

  if (!completed.has("finalize")) {
    const resumeReceipts: WarmStepReceipt[] = [];
    if (!opportunitiesRanNow) {
      const lossRun = await runStep("resume-loss-reflex", EMPTY_DISPLACEMENT, () => deps.checkDisplacement(tenantId, now));
      const stealRun = await runStep("resume-serp-steal", EMPTY_STEAL, () => deps.runStealLane(tenantId, now));
      const nativeRun = await runStep("resume-native-citation-teardown", EMPTY_NATIVE, () => deps.runNativeTeardown(tenantId));
      displacement = lossRun.value;
      steal = stealRun.value;
      native = nativeRun.value;
      resumeReceipts.push(lossRun.receipt, stealRun.receipt, nativeRun.receipt);
    }
    let prepared = EMPTY_PREPARE;
    const finish = await runStep<WarmRunReceipt | null>("fuse-rank-prepare-surfaces", null, () =>
      deps.finishSurfaces(tenantId, now, {
        displacement,
        steal,
        native,
        prepare: async (id, at) => {
          prepared = await deps.prepareMoves(id, at);
          return prepared;
        },
      }));
    summary.movesPrepared = Math.max(summary.movesPrepared, prepared.prepared);
    summary.readyToReview = Math.max(summary.readyToReview, prepared.readyToReview);
    summary.draftsRegenerated += prepared.regenerated;
    summary.finalSerpQueriesChecked = prepared.serpQueriesChecked ?? summary.finalSerpQueriesChecked;
    summary.finalSerpWinnersAnalyzed = prepared.serpWinnerPagesAnalyzed ?? summary.finalSerpWinnersAnalyzed;
    summary.spendUsd = Number((summary.spendUsd + prepared.llmCostUsd + prepared.serpCostUsd).toFixed(3));
    if (!(await checkpoint("finalize", [...resumeReceipts, finish.receipt]))) return lastReceipt!;
  }

  return lastReceipt ?? {
    tenant_id: tenantId, date, ran_at: now.toISOString(), ok: true, totalMs: Date.now() - startedAt,
    steps, trigger: "visit", summary,
    pipeline: { version: 1, completedStages: [...AUTONOMOUS_PIPELINE_STAGES], nextStage: null, updatedAt: new Date().toISOString() },
  };
}
