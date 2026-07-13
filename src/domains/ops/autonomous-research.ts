import "server-only";

import type { TopicMentionsRunResult } from "@/domains/ai-visibility/run-topic-mentions";
import type { NativeTeardownRunSummary } from "@/domains/demand-graph/native-teardown-runner";
import type { PrepareMovesSummary } from "@/domains/demand-graph/prepare-today-moves";
import type { QuestionUniverseRebuildResult } from "@/domains/research/question-universe-loader";
import type { ClaimGraphRebuildResult } from "@/domains/provenance/claim-graph-loader";
import type { PageRankRebuildResult } from "@/domains/linkgraph/internal-pagerank-loader";
import type { DisplacementCheckSummary } from "@/domains/serp/displacement-check";
import type { EnrichmentRunResult } from "@/domains/serp/research-enrichment-producer";
import type { ResearchPackLite } from "@/domains/serp/research-enrichment";
import type { KeywordGapRunResult } from "@/domains/serp/keyword-gap-producer";
import type { StealLaneRunSummary } from "@/domains/serp/serp-steal-lane";
import type {
  WarmRunReceipt,
  WarmRunSummary,
  WarmStepReceipt,
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
  outcomes: [],
};

export type AutonomousResearchDeps = {
  refreshGraph: (tenantId: string, now: Date) => Promise<void>;
  auditCompetitors: (tenantId: string) => Promise<{ audited: number; targets: number; cached: number }>;
  mineCompetitorKeywords: (tenantId: string) => Promise<KeywordGapRunResult>;
  buildResearchPacks: (tenantId: string) => Promise<ResearchPackLite[]>;
  enrichResearch: (packs: ResearchPackLite[]) => Promise<EnrichmentRunResult>;
  pollAiTopics: (tenantId: string) => Promise<TopicMentionsRunResult>;
  rebuildQuestions: (tenantId: string) => Promise<QuestionUniverseRebuildResult>;
  rebuildClaims: (tenantId: string) => Promise<ClaimGraphRebuildResult>;
  rebuildInternalAuthority: (tenantId: string) => Promise<PageRankRebuildResult>;
  checkDisplacement: (tenantId: string, now: Date) => Promise<DisplacementCheckSummary>;
  runStealLane: (tenantId: string, now: Date) => Promise<StealLaneRunSummary>;
  runNativeTeardown: (tenantId: string) => Promise<NativeTeardownRunSummary>;
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
  prepareMoves: async (tenantId, now) => {
    const { prepareTodayMovesForTenant } = await import("@/domains/demand-graph/prepare-today-moves");
    return await prepareTodayMovesForTenant(tenantId, { maxN: 10, maxUsd: 0.15, now: () => now });
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
 * Failures are isolated and recorded; publishing is never called.
 */
export async function runAutonomousResearchForTenant(
  tenantId: string,
  now: Date = new Date(),
  depsOverride: Partial<AutonomousResearchDeps> = {},
): Promise<WarmRunReceipt> {
  const deps = { ...defaultDeps, ...depsOverride };
  const startedAt = Date.now();
  const steps: WarmStepReceipt[] = [];

  const graph = await runStep("seed-demand-graph", undefined, () => deps.refreshGraph(tenantId, now));
  steps.push(graph.receipt);

  const competitors = await runStep("competitor-teardown", { audited: 0, targets: 0, cached: 0 }, () =>
    deps.auditCompetitors(tenantId));
  steps.push(competitors.receipt);

  const keywordGaps = await runStep<KeywordGapRunResult | null>("competitor-keyword-mining", null, () =>
    deps.mineCompetitorKeywords(tenantId));
  steps.push(keywordGaps.receipt);

  const packs = await runStep("research-pack-selection", [] as ResearchPackLite[], () =>
    deps.buildResearchPacks(tenantId));
  steps.push(packs.receipt);
  const enrichment = await runStep<EnrichmentRunResult | null>("keyword-serp-enrichment", null, () =>
    deps.enrichResearch(packs.value));
  steps.push(enrichment.receipt);

  const topics = await runStep<TopicMentionsRunResult | null>("ai-citation-fanout", null, () =>
    deps.pollAiTopics(tenantId));
  steps.push(topics.receipt);
  const questions = await runStep<QuestionUniverseRebuildResult | null>("question-universe", null, () =>
    deps.rebuildQuestions(tenantId));
  steps.push(questions.receipt);
  const claims = await runStep<ClaimGraphRebuildResult | null>("factual-claim-graph", null, () =>
    deps.rebuildClaims(tenantId));
  steps.push(claims.receipt);
  const authority = await runStep<PageRankRebuildResult | null>("internal-authority-map", null, () =>
    deps.rebuildInternalAuthority(tenantId));
  steps.push(authority.receipt);
  const displacement = await runStep("loss-reflex", EMPTY_DISPLACEMENT, () =>
    deps.checkDisplacement(tenantId, now));
  steps.push(displacement.receipt);
  const steal = await runStep("serp-steal", EMPTY_STEAL, () => deps.runStealLane(tenantId, now));
  steps.push(steal.receipt);
  const native = await runStep("native-citation-teardown", EMPTY_NATIVE, () => deps.runNativeTeardown(tenantId));
  steps.push(native.receipt);

  let prepared = EMPTY_PREPARE;
  const finish = await runStep<WarmRunReceipt | null>("fuse-rank-prepare-surfaces", null, () =>
    deps.finishSurfaces(tenantId, now, {
      displacement: displacement.value,
      steal: steal.value,
      native: native.value,
      prepare: async (id, at) => {
        prepared = await deps.prepareMoves(id, at);
        return prepared;
      },
    }));
  steps.push(finish.receipt);
  if (finish.value) {
    steps.push(
      ...finish.value.steps.filter((step) =>
        !["displacement-check", "serp-steal-lane", "native-teardown"].includes(step.name)),
    );
  }

  const summary: WarmRunSummary = {
    competitorPagesAnalyzed: competitors.value.targets,
    competitorPagesRefreshed: Math.max(0, competitors.value.audited - competitors.value.cached),
    competitorsMined: keywordGaps.value?.competitors.length ?? 0,
    keywordGapsFound: keywordGaps.value?.gapsFound ?? 0,
    cloneBriefsBuilt: keywordGaps.value?.cloneBriefs.length ?? 0,
    keywordTermsPlanned: enrichment.value?.plan.volumeTerms.length ?? 0,
    serpPatternsWritten: enrichment.value?.patternsWritten ?? 0,
    aiTopicsPolled: topics.value?.topics.length ?? 0,
    aiCitationRecords: topics.value?.records ?? 0,
    questionsRanked: questions.value?.rows ?? 0,
    uncoveredQuestions: questions.value?.uncovered ?? 0,
    claimsChecked: claims.value?.claims ?? 0,
    conflictingClaims: claims.value?.conflicting ?? 0,
    pagesMapped: authority.value?.pages ?? 0,
    orphanPagesFound: authority.value?.orphaned ?? 0,
    beatenKeywords: steal.value.beatenKeywordsFound,
    stealBriefsBuilt: steal.value.briefsBuilt,
    nativePromptsAnalyzed: native.value.promptsAnalyzed,
    citedPagesAnalyzed: native.value.torndownPages,
    movesPrepared: prepared.prepared,
    readyToReview: prepared.readyToReview,
    draftsRegenerated: prepared.regenerated,
    spendUsd: Number((
      (enrichment.value?.spentUsd ?? 0) +
      (keywordGaps.value?.spentUsd ?? 0) +
      (topics.value?.costUsd ?? 0) +
      displacement.value.costUsd +
      steal.value.liveCostUsd +
      prepared.llmCostUsd +
      prepared.serpCostUsd
    ).toFixed(3)),
  };

  return {
    tenant_id: tenantId,
    date: now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    ran_at: now.toISOString(),
    ok: steps.every((step) => step.ok),
    totalMs: Date.now() - startedAt,
    steps,
    trigger: "visit",
    summary,
  };
}
