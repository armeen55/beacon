/**
 * Today route (/) — server-side data prep for `TodayClient`.
 * Read-only on render (Track 1C). Phase 4-8 extraction from `page.tsx`.
 */

import {
  results,
  changelogEntries,
  opportunities,
  competitors,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { allPages } from "@/domains/pages/page-store";
import { readStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  pageIssues,
  rolloutExecutions,
  patternEvidence as persistedPatternEvidence,
} from "@/domains/pages/issues";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import {
  planWaves,
  rolloutWaves as persistedWaves,
  computeWaveProgress,
  deriveWaveStatus,
} from "@/domains/pages/wave-planner";
import { stripSiteOrigin, getSiteConfig } from "@/lib/site-config";
import { buildTodaySummary, type TodayNextMove } from "@/lib/today-summary";
import { computeRecommendations } from "@/domains/product/recommendation-engine";
import { rankAndSelect } from "@/domains/product/priority-engine";
import { computeTrackRecord } from "@/domains/product/recommendation-tracker";
import {
  isRecSuppressed,
  getResponse,
  recommendationResponses,
} from "@/domains/product/recommendation-response-store";
// Phase 4 (2026-04-19): experiment-store deleted. url-change-outcomes is now
// the single source of truth for tracking. See getWatchingUrlOutcomes().
// outcome-store backfill/persist moved to post-import (Phase 1C-1)
import { computeCitationDecay, getDecayAlerts } from "@/domains/attribution/citation-decay";
import { extractEntities } from "@/domains/entity/entity-extract";
import { detectDiscrepancies } from "@/domains/entity/discrepancy-detect";
import { computeGeoCoverage } from "@/domains/geo/coverage";
import { getActivePrompts, promptLibrary } from "@/domains/prompts/prompt-library";
import { computeJourneyCoverage } from "@/domains/prompts/journey-coverage";
import { JOURNEY_STAGE_LABELS } from "@/domains/prompts/journey-stages";
import { analyzeAllExtractability } from "@/domains/pages/extractability";
import { computeSnippetIntelligence } from "@/domains/competitors/snippet-intel";
import {
  latestWebsiteCrawlRun,
  listObservationRuns,
  getObservationRun,
} from "@/domains/observations/read";
import { primaryVisibilityRunForResults } from "@/domains/observations/visibility-context";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { buildTodayCompetitorLine } from "@/domains/competitors/today-competitor-line";
import { PLATFORM_LABELS, type Platform } from "@/lib/constants";
import { getScanSettings, isScanOverdue } from "@/domains/scanning/scan-settings";
import { readScanState } from "@/domains/scanning/scan-state";
import { FINDING_PRIORITY_ORDER } from "@/domains/scanning/types";
// buildCompetitorRank / classifyCompetitorType moved to post-import milestone sync (Phase 1C-3)
import { getBusinessConfig, getSectionAnalyzerConfig, getFaqTemplates } from "@/lib/business-config";
import { getLocalPresenceSnapshot, buildTodayLocalAttention } from "@/lib/local-presence";
import {
  computeLocalOperatorSurface,
  loadLocalOperatorImport,
} from "@/domains/local-operator/surface";
import {
  buildReplicationCards,
  buildPromisingReplicationCards,
} from "@/domains/product/replication-engine";
import type { TodayProofContext } from "@/lib/today-proof-context";
import {
  serializeFindingForToday,
  recommendationLineageBullets,
} from "@/lib/today-proof-serialize";
import {
  getMilestoneState,
  pickTodayMilestoneTeaser,
} from "@/domains/milestones";
import { answerIntelligenceIndex } from "@/domains/answer-intelligence/store";
import { buildMorningBrief, type MorningBriefData } from "@/domains/product/morning-brief";
import { buildQueryKeywordIndex, type QueryKeywordIndex } from "@/domains/answer-intelligence/query-index";
// 2026-04-20: MemoryInsight (topic-level attribution) removed in favor of
// url-change-outcomes (URL-level Z-score). See win-card logic below.
import { dailyMetricSnapshots } from "@/storage/canonical-store";
// url-brain-recommender removed 2026-04-18 (Phase 7 cleanup) \u2014 was producing
// vague "Investigate h1 regression" shrug cards with low-sample pattern math
// (often 2-of-3 cases). Being replaced by data-grounded keyword-gap scanner +
// LLM-as-judge ablation (see docs/IDEAS_PARKING_LOT.md for ablation roadmap).
import { urlChangeOutcomes } from "@/domains/attribution/url-change-outcome";
import type { UrlChangePattern } from "@/domains/learning/change-patterns";
import { buildSchemaParityActions } from "@/domains/actions/schema-parity-actions";
import { getCompetitorMonitoringState } from "@/domains/competitor-monitoring/store";
import { generateCompetitorAlerts } from "@/domains/competitor-monitoring/detect-changes";
import {
  computeVisibilityTimeSeries,
  computeVisibilityTimeSeriesByPlatform,
  computeLeaderboard,
  computeCompetitorSeries,
  type VisibilityMetric,
  type VisibilityPoint,
  type EntityVisibility,
} from "@/domains/product/visibility-score";


import type { ComponentProps } from "react";
import { TodayClient, type TodayQueueItem } from "./today-client";

export type TodayPageData = Omit<
  ComponentProps<typeof TodayClient>,
  | "onRespondToRec"
  | "onStartExperiment"
>;

export async function loadTodayPageData(): Promise<TodayPageData> {
  // Same signal as shell `isDemoMode` (Phase 2A): no import runs ⇒ sample seed data, not operator briefing.
  const isDemoMode = !hasActiveExperiment();

  // Overdue signal for client-side scan trigger (Phase 1A-5); scan never runs during this render.
  const scanSettings = getScanSettings();
  const lastCrawlRun = latestWebsiteCrawlRun();
  const scanOverdue = isScanOverdue(lastCrawlRun?.completed_at ?? null, scanSettings);

  const repo = getRepository();
  const pageSnapshots = await repo.getPageSnapshots();
  const guardrailAlerts = await repo.getGuardrailAlerts();

  const allScanFindings = await repo.getScanFindings();
  const pendingFindings = allScanFindings
    .filter((f) => f.status === "pending")
    .sort((a, b) => {
      const po =
        (FINDING_PRIORITY_ORDER[a.priority] ?? 3) -
        (FINDING_PRIORITY_ORDER[b.priority] ?? 3);
      if (po !== 0) return po;
      return b.priorityScore - a.priorityScore;
    });
  const resolvedFindingsCount = allScanFindings.filter(
    (f) => f.status !== "pending",
  ).length;

  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const decidedEventIds = new Set(eventDecisions.map((d) => d.event_id));
  const scorecardRows = computeScorecard(
    changelogEntries,
    results,
    opportunities,
    eventDecisions
  );

  const impactRows = enrichWithImpact(scorecardRows);
  const IMPACT_VERDICT_PRIORITY: Record<string, number> = {
    validated: 0,
    negative: 1,
    partial: 2,
    inconclusive: 3,
    no_impact: 4,
    too_early: 5,
    pending: 6,
  };
  const IMPACT_CONF_PRIORITY: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  // ── Visibility summary from results ──
  const dates = results.map((r) => r.snapshot_date).sort();
  const latestDate = dates[dates.length - 1] ?? null;
  const earliestDate = dates[0] ?? null;

  const totalCitations = results.reduce((s, r) => s + r.citation_count, 0);
  const totalMentions = results.reduce((s, r) => s + r.mention_count, 0);

  const platformCounts = new Map<string, { citations: number; mentions: number }>();
  for (const r of results) {
    if (r.platform === "all") continue;
    const p = platformCounts.get(r.platform) ?? { citations: 0, mentions: 0 };
    p.citations += r.citation_count;
    p.mentions += r.mention_count;
    platformCounts.set(r.platform, p);
  }
  const platformBreakdown = [...platformCounts.entries()]
    .map(([platform, counts]) => ({
      platform,
      label: PLATFORM_LABELS[platform as Platform] ?? platform,
      citations: counts.citations,
      mentions: counts.mentions,
    }))
    .sort((a, b) => b.citations - a.citations || b.mentions - a.mentions);

  const midDate = earliestDate && latestDate
    ? new Date(
        (new Date(earliestDate).getTime() + new Date(latestDate).getTime()) / 2
      ).toISOString().slice(0, 10)
    : null;

  let trendPct: number | null = null;
  if (midDate && results.length > 20) {
    const firstHalf = results.filter((r) => r.snapshot_date <= midDate);
    const secondHalf = results.filter((r) => r.snapshot_date > midDate);
    const firstCit = firstHalf.reduce((s, r) => s + r.citation_count, 0);
    const secondCit = secondHalf.reduce((s, r) => s + r.citation_count, 0);
    if (firstCit > 0) {
      trendPct = Math.round(((secondCit - firstCit) / firstCit) * 100);
    }
  }

  // ── Week-over-week deltas ──
  let weekOverWeekCitations: number | null = null;
  let weekOverWeekMentions: number | null = null;
  if (latestDate) {
    const latestMs = new Date(latestDate).getTime();
    const thisWeek = results.filter((r) => {
      const d = new Date(r.snapshot_date).getTime();
      return d > latestMs - 7 * 86_400_000;
    });
    const lastWeek = results.filter((r) => {
      const d = new Date(r.snapshot_date).getTime();
      return d > latestMs - 14 * 86_400_000 && d <= latestMs - 7 * 86_400_000;
    });
    if (lastWeek.length > 0) {
      const twCit = thisWeek.reduce((s, r) => s + r.citation_count, 0);
      const lwCit = lastWeek.reduce((s, r) => s + r.citation_count, 0);
      if (lwCit > 0) {
        weekOverWeekCitations = Math.round(((twCit - lwCit) / lwCit) * 100);
      }
      const twMen = thisWeek.reduce((s, r) => s + r.mention_count, 0);
      const lwMen = lastWeek.reduce((s, r) => s + r.mention_count, 0);
      if (lwMen > 0) {
        weekOverWeekMentions = Math.round(((twMen - lwMen) / lwMen) * 100);
      }
    }
  }

  const visibilitySummary = {
    totalCitations,
    totalMentions,
    platformBreakdown,
    dateRange: earliestDate && latestDate ? { from: earliestDate, to: latestDate } : null,
    latestImportDate: latestDate,
    trendPct,
    resultCount: results.length,
    weekOverWeekCitations,
    weekOverWeekMentions,
  };

  const actionableImpact = impactRows
    .filter(
      (r) =>
        r.verdict !== "too_early" &&
        r.verdict !== "pending" &&
        r.totalEventsLinked > 0,
    )
    .sort(
      (a, b) =>
        (IMPACT_VERDICT_PRIORITY[a.verdict] ?? 9) -
          (IMPACT_VERDICT_PRIORITY[b.verdict] ?? 9) ||
        (IMPACT_CONF_PRIORITY[a.impact.confidence] ?? 9) -
          (IMPACT_CONF_PRIORITY[b.impact.confidence] ?? 9) ||
        (b.topScore ?? 0) - (a.topScore ?? 0),
    )
    .slice(0, 3)
    .map((r) => ({
      changeId: r.change.id,
      assetName: r.change.asset_name,
      verdict: r.verdict,
      confidence: r.impact.confidence,
      direction: r.impact.direction,
      nextAction: r.impact.nextAction,
      topScore: r.topScore,
      totalEvents: r.totalEventsLinked,
      platforms: r.platforms,
      href: `/changes/${r.change.id}`,
    }));

  let easyCalls = 0;
  let undecidedCount = 0;
  for (const event of events) {
    if (decidedEventIds.has(event.id)) continue;
    const result = results.find((r) => r.id === event.anchor_result_id);
    if (!result) continue;
    const candidates = discoverCandidates(result, changelogEntries, opportunities);
    if (candidates.length === 0) continue;
    const triage = triageCandidates(candidates);
    if (triage.autoResolved || triage.needsReview.length === 0) continue;
    undecidedCount++;
    const actionable = [
      ...(triage.primary ? [triage.primary] : []),
      ...triage.contributing,
      ...triage.needsReview,
    ].sort((a, b) => b.score - a.score);
    const top = actionable[0];
    const second = actionable.length > 1 ? actionable[1] : null;
    const gap = second ? Math.round(top.score - second.score) : top.score;
    if ((triage.primary && gap >= 10) || (!triage.primary && gap >= 15))
      easyCalls++;
  }

  const warningAlerts = guardrailAlerts.filter(
    (a) =>
      a.severity === "warning" ||
      a.severity === "critical" ||
      a.severity === "regression"
  );

  const activeCrawl = latestWebsiteCrawlRun();
  const activeCrawlId = activeCrawl?.run_id ?? null;

  const citationIndex2 = citationEvidenceIndex as {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
    }[];
    by_topic: { topic: string }[];
  } | null;

  const citMap = new Map<string, number>();
  if (citationIndex2) {
    for (const r of citationIndex2.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  const patterns = minePatterns(
    pageSnapshots,
    citMap,
    scorecardRows,
    rolloutExecutions,
    persistedPatternEvidence
  );
  const playbookBriefs = generateBriefs(pageSnapshots, citMap, patterns);
  const topBriefs = playbookBriefs
    .filter((b) => b.type === "growth")
    .slice(0, 2);

  const newIssues = pageIssues.filter((i) => i.status === "new");
  const shippedIssues = pageIssues.filter((i) => i.status === "shipped");
  const handedOffIssues = pageIssues.filter(
    (i) => i.status === "handed_off" || i.status === "in_progress"
  );
  const verifiedIssues = pageIssues.filter((i) => i.status === "verified");

  const urlToPageId = new Map<string, string>();
  for (const p of allPages) {
    urlToPageId.set(p.url.replace(/\/+$/, "").toLowerCase(), p.id);
  }

  function pagesHref(pageUrl: string, briefId?: string): string {
    const pageId = urlToPageId.get(pageUrl.replace(/\/+$/, "").toLowerCase());
    if (!pageId) return "/pages";
    return briefId ? `/pages?p=${pageId}&b=${briefId}` : `/pages?p=${pageId}`;
  }

  type PlainGroup = "fix_this" | "in_progress" | "wins";
  function toPlainGroup(g: string): PlainGroup {
    if (g === "fix" || g === "ship" || g === "frontier" || g === "review")
      return "fix_this";
    if (g === "verify" || g === "waiting") return "in_progress";
    return "wins";
  }

  const items: TodayQueueItem[] = [];

  for (const a of warningAlerts) {
    const matchingIssue = newIssues.find((i) => i.pageUrl === a.url);
    const runId = a.observation_run_id ?? activeCrawlId;
    items.push({
      id: `alert-${a.category}-${a.url}`,
      group: "fix",
      label: a.message
        .replace(/citations/g, "tracked mentions")
        .replace(/no FAQ or schema/g, "missing Q&A content"),
      meta: runId
        ? "Found during crawl"
        : "Found during crawl (older scan, no run ID)",
      href: pagesHref(a.url),
      dot: "bg-status-danger",
      detail: a.detail
        .replace(/citation/gi, "tracked mention")
        .replace(/FAQ/g, "Q&A")
        .replace(/schema/g, "structured data")
        .replace(/structural/gi, "page"),
      issueId: matchingIssue?.issueId,
      issueStatus: matchingIssue?.status ?? "new",
      pageUrl: a.url,
      pagePath: stripSiteOrigin(a.url),
      observationRunId: runId,
      observationRunHref: runId
        ? `/observations/${encodeURIComponent(runId)}`
        : null,
    });
  }

  for (const issue of shippedIssues) {
    items.push({
      id: `verify-${issue.issueId}`,
      group: "verify",
      label: `Verify ship · ${issue.pagePath || "/"}`,
      meta: "Ship verification pending",
      href: pagesHref(issue.pageUrl),
      dot: "bg-accent-primary",
      detail:
        issue.verifyResult?.summary ??
        "Re-fetch the page and compare to the expected fix checklist.",
      issueId: issue.issueId,
      issueStatus: issue.status,
      pageUrl: issue.pageUrl,
      pagePath: issue.pagePath,
    });
  }

  if (easyCalls > 0) {
    items.push({
      id: "review-easy",
      group: "review",
      label: `${easyCalls} Review item${easyCalls !== 1 ? "s" : ""} with wider score gap`,
      meta: "Why did visibility change? · attribution",
      href: "/changes?tab=attribution",
      dot: "bg-muted-foreground",
      detail:
        "Review the suggested cause and lock it if it matches what you know. This is about why visibility shifted, not what changed on your site.",
    });
  }
  if (undecidedCount - easyCalls > 0) {
    items.push({
      id: "review-remaining",
      group: "review",
      label: `${undecidedCount - easyCalls} more visibility shifts in Review`,
      meta: "Why did visibility change? · needs decision",
      href: "/changes?tab=attribution",
      dot: "bg-status-warning",
      detail:
        "Each row links a visibility shift to a possible cause. Lock the best match when you know what happened.",
    });
  }

  for (const pb of topBriefs) {
    const rolloutIssue = pageIssues.find(
      (i) =>
        i.issueId ===
        `rollout-${pb.id}-${(pb.pageUrl.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/").replace(/\//g, "-").replace(/^-/, "")}`
    );
    const rs = rolloutIssue?.status;
    if (rs === "verified" || rs === "dismissed") continue;

    const group =
      rs === "shipped"
        ? ("verify" as const)
        : rs === "handed_off" || rs === "in_progress"
          ? ("waiting" as const)
          : ("ship" as const);
    const dot =
      rs === "shipped"
        ? "bg-accent-primary"
        : rs === "handed_off" || rs === "in_progress"
          ? "bg-status-warning"
          : "bg-muted-foreground";
    const meta =
      rs === "shipped"
        ? "Awaiting ship verification"
        : rs === "handed_off"
          ? `Handed off · ${pb.patternName}`
          : `Pattern gap · ${pb.patternName}`;

    items.push({
      id: `brief-${pb.id}`,
      group,
      label: pb.title,
      meta,
      href: pagesHref(pb.pageUrl, pb.id),
      dot,
      detail: pb.rationale,
      issueId: rolloutIssue?.issueId,
      issueStatus: rs ?? undefined,
      pageUrl: pb.pageUrl,
      pagePath: pb.pagePath,
    });
  }

  // ── Citation decay: detect declining pages ──
  const { siteDomain } = getSiteConfig();
  const decayResults = computeCitationDecay(siteDomain);
  const decayAlerts = getDecayAlerts(decayResults);
  const geoForLocal = computeGeoCoverage(
    allPages,
    citationEvidenceIndex?.by_page_and_topic ?? [],
    getActivePrompts(),
  );
  const topLocalGap = geoForLocal.gaps[0] ?? null;
  const meaningfulDecayCount = decayAlerts.filter(
    (d) => d.status === "meaningful_decline",
  ).length;
  const localOperatorSurface = computeLocalOperatorSurface({
    business: getBusinessConfig(),
    importRow: loadLocalOperatorImport(),
    geoGap: topLocalGap
      ? {
          city: topLocalGap.city,
          competitor_pages: topLocalGap.competitor_pages,
          owned_pages: topLocalGap.owned_pages,
        }
      : null,
    meaningfulDecayCount,
  });

  const changePatterns = readStore<import("@/domains/learning/change-patterns").ChangePattern>("change-patterns");
  const changeOutcomes = readStore<import("@/domains/attribution/change-outcome").ChangeOutcome>("change-outcomes");
  // Phase 4 (2026-04-19): "active experiments" concept removed. Scanner watches
  // every URL change automatically via url-watcher; no opt-in required. The
  // gap-scanner still wants to avoid recommending on URLs where we're already
  // watching \u2014 feed it the current watchlist from url-change-outcomes.
  const { getWatchingUrlOutcomes } = await import("@/domains/attribution/url-change-outcome");
  const activeExperimentUrls = new Set(
    getWatchingUrlOutcomes().map((o) => o.url.replace(/\/+$/, "").toLowerCase()),
  );
  // Build query keyword index from fan-out data — unlocks 5,289 real search
  // queries for keyword optimization recs AND morning brief step generation.
  const { promptAnswerObservations } = await import("@/storage/canonical-store");
  const queryIndex = buildQueryKeywordIndex(citationEvidenceIndex, promptAnswerObservations);

  // Phase 7 Part 1b (2026-04-18): load answer-texts from disk so the
  // data-grounded keyword-gap scanner has the raw AI answer corpus to mine
  // for competitor-citing vs you-citing phrase deltas. Cheap read (~38 MB
  // hit once per render; cold-store internally caches).
  const { readAnswerTextsFromDisk } = await import("@/lib/persistence/cold-store");
  const answerTexts = readAnswerTextsFromDisk();

  // Brand aliases for the scanner. Mirrors the Visibility-chart alias logic.
  const scannerBusinessConfig = getBusinessConfig();
  const scannerBrandAliases = [
    scannerBusinessConfig.name,
    scannerBusinessConfig.name.split(" ")[0],
  ].filter((a, i, arr) => a && arr.indexOf(a) === i);

  // Phase 7 Part 1b-v2: dynamic competitor exclusion list. businessConfig
  // lists only the top 5 primaryCompetitors, but observation data surfaces
  // 30+ competitor brands. Use top-40 non-brand mentions to keep
  // competitor names out of concept extraction.
  const scannerBrandAliasesLC = new Set(
    scannerBrandAliases.map((s) => s.toLowerCase()),
  );
  const scannerMentionCounts = new Map<string, number>();
  for (const o of promptAnswerObservations) {
    for (const m of o.mentions ?? []) {
      if (!scannerBrandAliasesLC.has(m.toLowerCase())) {
        scannerMentionCounts.set(m, (scannerMentionCounts.get(m) ?? 0) + 1);
      }
    }
  }
  const scannerTopMentioned = [...scannerMentionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name]) => name);
  const scannerCompetitorExclusions = Array.from(
    new Set([
      ...((scannerBusinessConfig as unknown as { competitors?: string[] }).competitors ?? []),
      ...(scannerBusinessConfig.primaryCompetitors ?? []),
      ...scannerTopMentioned,
    ]),
  );

  // Known city/location labels for the city-filter. Expand beyond
  // businessConfig.locations to include commonly-co-occurring neighbors
  // that AI frequently mentions together.
  const scannerKnownLocations: string[] = [
    ...(scannerBusinessConfig.locations ?? []),
    "Atherton", "Menlo Park", "Palo Alto", "Los Altos", "Los Altos Hills",
    "Cupertino", "Saratoga", "Portola Valley", "Woodside", "Mountain View",
    "Emerald Hills", "Redwood City", "San Carlos", "Hillsborough",
    "Silicon Valley", "Bay Area", "San Francisco", "Peninsula",
    "California", "CA", "USA",
  ];

  const allRecommendations = computeRecommendations({
    impactRows,
    patterns,
    briefs: playbookBriefs,
    pageSnapshots,
    citationCountMap: citMap,
    citationIndex: citationEvidenceIndex,
    allPages,
    decayResults,
    answerIntelligence: answerIntelligenceIndex,
    changelogEntries,
    changePatterns,
    activeExperimentUrls,
    // 2026-04-20: changeOutcomes (topic-level) no longer used for prior-success
    // attribution. urlChangeOutcomes (URL-level Z-score) is the new source.
    urlChangeOutcomes,
    sectionAnalyzerConfig: getSectionAnalyzerConfig(),
    queryIndex,
    observations: promptAnswerObservations,
    answerTexts,
    brandAliases: scannerBrandAliases,
    competitorExclusions: scannerCompetitorExclusions,
    knownLocations: scannerKnownLocations,
  });

  // Filter out dismissed / deferred-but-not-due recommendations
  const recommendations = allRecommendations.filter(
    (r) => !isRecSuppressed(r.id),
  );

  const briefPatternCounts = new Map<string, number>();
  for (const b of playbookBriefs) {
    briefPatternCounts.set(
      b.patternId,
      (briefPatternCounts.get(b.patternId) ?? 0) + 1,
    );
  }

  const trackRecord = computeTrackRecord({
    impactRows,
    patterns,
    responses: recommendationResponses,
    recommendations: allRecommendations,
  });

  // Phase 4 (2026-04-19): recIds-with-accepted-status now come from the
  // recommendation-response store directly (what the operator clicked "Apply
  // this" on), not from a separate experiment table.
  const activeExperimentRecIdSet = new Set(
    recommendationResponses
      .filter((r) => r.status === "accepted")
      .map((r) => r.recId),
  );
  const replicationImpactCards = buildReplicationCards({
    recommendations,
    impactRows,
    patterns,
    rolloutExecutions,
    pageIssues,
    activeExperimentRecIds: activeExperimentRecIdSet,
  });
  const replicationExcludeRecIds = new Set(
    replicationImpactCards.flatMap((c) => c.targets.map((t) => t.recId)),
  );
  // Phase 4 (2026-04-19): experiment-based promising seed removed. Replication
  // "promising" seeding is disabled for now; will be rebuilt on top of
  // url-change-outcomes `helping` verdicts in a later phase.
  const replicationPromisingCards = buildPromisingReplicationCards(
    [],
    allRecommendations,
    impactRows,
    patterns,
    rolloutExecutions,
    pageIssues,
    replicationExcludeRecIds,
  );
  const replicationWorkspaceCards = [
    ...replicationImpactCards,
    ...replicationPromisingCards,
  ];
  const replicationBeneficiaryPages = new Set<string>();
  for (const card of replicationWorkspaceCards) {
    for (const t of card.targets) {
      replicationBeneficiaryPages.add(
        t.targetPageUrl.replace(/\/+$/, "").toLowerCase(),
      );
    }
  }
  const replicationSummaryForToday =
    replicationBeneficiaryPages.size > 0
      ? { pageCount: replicationBeneficiaryPages.size }
      : null;

  const { primaryAction, secondary: secondaryActions } = rankAndSelect({
    recommendations,
    impactRows,
    patterns,
    briefPatternCounts,
    patternTrackRecords: trackRecord.patternRecords,
  });

  // 2026-04-20: topic-level MemoryInsight pipeline removed. Attribution now
  // lives entirely in url-change-outcomes (URL-level Z-score engine).

  // ── Competitor monitoring alerts (Phase 5) ──
  const competitorMonState = getCompetitorMonitoringState();
  const competitorAlerts = generateCompetitorAlerts(competitorMonState.recentChanges);

  // queryIndex already built above — used in both rec engine and morning brief.

  const morningBrief: MorningBriefData = buildMorningBrief({
    primaryAction,
    secondaryActions,
    answerIntelligence: answerIntelligenceIndex,
    citationIndex: citationEvidenceIndex,
    trendPct: visibilitySummary.trendPct,
    totalOwnedCitations: visibilitySummary.totalCitations,
    latestDataDate: visibilitySummary.dateRange?.to ?? null,
    memoryInsights: [],
    competitorAlerts,
    competitorSnapshots: competitorMonState.snapshots,
    faqTemplates: getFaqTemplates(),
    pageSnapshots,
    queryIndex,
  });

  function recHref(r: { type: string; targetPageUrl: string | null; sourceChangeId: string | null }): string {
    if (r.targetPageUrl) return pagesHref(r.targetPageUrl);
    if (r.sourceChangeId) return `/changes/${r.sourceChangeId}`;
    if (r.type === "competitive_displacement" || r.type === "topic_cluster_gap") return "/competitors";
    return "/pages";
  }

  // Outcome backfill moved to post-import (Phase 1C-1) — Today render is now read-only
  // for the outcome store. See src/domains/product/outcome-backfill.ts.

  function buildConfidenceReason(rec: typeof primaryAction): string {
    if (!rec) return "";
    const parts: string[] = [];
    if (rec.confidence === "high") {
      if (rec.sourceChangeId) parts.push("validated source change");
      if (rec.citationOpportunity >= 50) parts.push(`${rec.citationOpportunity} existing citations`);
      if (!parts.length) parts.push("strong evidence match");
    } else if (rec.confidence === "medium") {
      if (rec.sourceChangeId) parts.push("partial source evidence");
      if (rec.citationOpportunity >= 10) parts.push(`${rec.citationOpportunity} citations`);
      if (!parts.length) parts.push("moderate evidence");
    } else {
      parts.push("early signal");
    }
    const patternTr = rec.patternId ? trackRecord.patternRecords.find((p) => p.patternId === rec.patternId) : null;
    if (patternTr && patternTr.actedOn >= 2) {
      parts.push(`${Math.round(patternTr.successRate * 100)}% pattern success rate`);
    }
    return parts.join(" · ");
  }

  function buildWatchAfter(rec: typeof primaryAction): string {
    if (!rec) return "";
    // Dynamic timing from engine_timing when available
    const timing = rec.engineTiming;
    if (timing && timing.length > 0) {
      const sorted = timing.sort(
        (a: { medianDays: number }, b: { medianDays: number }) => a.medianDays - b.medianDays,
      );
      const allSame = sorted.every(
        (t: { medianDays: number }) => t.medianDays === sorted[0].medianDays,
      );
      if (allSame && sorted.length > 1) {
        // All platforms show same timing — present as range using earliest/latest from pattern data
        const earliest = Math.min(
          ...sorted.map((t: { medianDays: number }) => Math.max(t.medianDays - 14, 7)),
        );
        const latest = Math.max(
          ...sorted.map((t: { medianDays: number }) => t.medianDays + 5),
        );
        return `Expected signal: ${earliest}–${latest} days depending on platform (${sorted[0].sampleCount} observations).`;
      }
      const parts = sorted.map(
        (t: { platform: string; medianDays: number; sampleCount: number }) =>
          `${t.platform}: ~${t.medianDays}d`,
      );
      return `Expected signal: ${parts.join(", ")}. Monitor after acting.`;
    }
    if (rec.type === "investigate") return "Watch for further visibility changes on the affected topics. If decline stabilizes, the cause may be external.";
    if (rec.type === "strengthen") return "After updating the changelog entry, check if attribution events auto-resolve.";
    if (rec.type === "strengthen_structure") return "After adding structure, monitor citation counts for this page over 1-2 import cycles.";
    if (rec.type === "improve_internal_links") return "After adding links, watch for citation count changes and crawl coverage in the next import.";
    if (rec.type === "refresh_content") return "After deepening content, monitor whether citation count or mention count increases in future imports.";
    if (rec.type === "competitive_displacement") return "After strengthening your content for this topic, watch for citation share shift vs competitors in future imports.";
    if (rec.type === "cross_page_pattern") return "After applying this pattern, monitor the target page for citation count changes. The source pattern took effect within 1-2 import cycles.";
    if (rec.type === "topic_cluster_gap") return "After creating the new content, watch for the topic to appear in your citation evidence for the new page type.";
    if (rec.type === "refresh_stale_citation") return "After refreshing content, monitor citation counts over the next 1-2 import cycles for recovery.";
    return "After acting, import fresh data and check whether Beacon detects a positive visibility change for the target page.";
  }

  const dataFreshness = visibilitySummary.dateRange
    ? `Based on data through ${visibilitySummary.dateRange.to}`
    : null;

  // Experiment citation sync moved to post-import (Phase 1C-2) — Today render is now read-only
  // for the experiment store. See src/domains/product/experiment-citation-sync.ts.

  const primaryLineage = primaryAction
    ? recommendationLineageBullets({
        sourceEvidence: primaryAction.sourceEvidence,
        type: primaryAction.type,
        sourceChangeId: primaryAction.sourceChangeId,
        dataFreshness,
        priorSuccess: primaryAction.priorSuccess ?? null,
        expectedMetric: primaryAction.expectedMetric ?? null,
      })
    : [];

  const serializedPrimary = primaryAction
    ? {
        id: primaryAction.id,
        headline: primaryAction.headline,
        rationale: primaryAction.rationale,
        expectedOutcome: primaryAction.expectedOutcome,
        sourceEvidence: primaryAction.sourceEvidence,
        priorityScore: primaryAction.priorityScore,
        bucket: primaryAction.bucket as "critical" | "high_leverage" | "opportunistic",
        type: primaryAction.type,
        confidence: primaryAction.confidence,
        href: recHref(primaryAction),
        responseStatus: getResponse(primaryAction.id)?.status ?? null,
        confidenceReason: buildConfidenceReason(primaryAction),
        watchAfter: buildWatchAfter(primaryAction),
        dataFreshness,
        hasExperiment: false, // Phase 4: experiment store removed; field kept for client-side type compat.
        targetPageUrl: primaryAction.targetPageUrl,
        targetPagePath: primaryAction.targetPagePath,
        baselineCitations: primaryAction.targetPageUrl
          ? (citMap.get(primaryAction.targetPageUrl.replace(/\/+$/, "").toLowerCase()) ?? 0)
          : null,
        sourceChangeId: primaryAction.sourceChangeId,
        lineageBullets: primaryLineage,
        answerContext: primaryAction.answerContext ?? null,
        specificMove: primaryAction.specificMove ?? null,
        actionClass: primaryAction.actionClass ?? null,
        targetSection: primaryAction.targetSection ?? null,
        priorSuccess: primaryAction.priorSuccess ?? null,
        engineTiming: primaryAction.engineTiming ?? null,
        expectedMetric: primaryAction.expectedMetric ?? null,
      }
    : null;

  // Serialize secondary action (next best recommendation after primary)
  const secondaryRec = secondaryActions.filter((r) => !isRecSuppressed(r.id))[0] ?? null;
  const serializedSecondary = secondaryRec
    ? {
        id: secondaryRec.id,
        headline: secondaryRec.headline,
        rationale: secondaryRec.rationale,
        expectedOutcome: secondaryRec.expectedOutcome,
        sourceEvidence: secondaryRec.sourceEvidence,
        priorityScore: secondaryRec.priorityScore,
        bucket: secondaryRec.bucket as "critical" | "high_leverage" | "opportunistic",
        type: secondaryRec.type,
        confidence: secondaryRec.confidence,
        href: recHref(secondaryRec),
        responseStatus: getResponse(secondaryRec.id)?.status ?? null,
        confidenceReason: buildConfidenceReason(secondaryRec),
        watchAfter: buildWatchAfter(secondaryRec),
        dataFreshness,
        hasExperiment: false, // Phase 4: experiment store removed; field kept for client-side type compat.
        targetPageUrl: secondaryRec.targetPageUrl,
        targetPagePath: secondaryRec.targetPagePath,
        baselineCitations: secondaryRec.targetPageUrl
          ? (citMap.get(secondaryRec.targetPageUrl.replace(/\/+$/, "").toLowerCase()) ?? 0)
          : null,
        sourceChangeId: secondaryRec.sourceChangeId,
        lineageBullets: recommendationLineageBullets({
          sourceEvidence: secondaryRec.sourceEvidence,
          type: secondaryRec.type,
          sourceChangeId: secondaryRec.sourceChangeId,
          dataFreshness,
          priorSuccess: secondaryRec.priorSuccess ?? null,
          expectedMetric: secondaryRec.expectedMetric ?? null,
        }),
        answerContext: secondaryRec.answerContext ?? null,
        specificMove: secondaryRec.specificMove ?? null,
        actionClass: secondaryRec.actionClass ?? null,
        targetSection: secondaryRec.targetSection ?? null,
        priorSuccess: secondaryRec.priorSuccess ?? null,
        engineTiming: secondaryRec.engineTiming ?? null,
        expectedMetric: secondaryRec.expectedMetric ?? null,
      }
    : null;

  // Scoreboard data for command center
  const citedPageCount = citationIndex2
    ? new Set(
        citationIndex2.by_page_and_topic
          .filter((r) => r.is_owned && r.total_citations > 0)
          .map((r) => r.page_url),
      ).size
    : 0;

  const answerIntelProof = answerIntelligenceIndex
    ? buildAnswerIntelligenceProofContext(answerIntelligenceIndex)
    : null;

  const scoreboard = {
    totalCitations: visibilitySummary.totalCitations,
    totalMentions: visibilitySummary.totalMentions,
    trendPct: visibilitySummary.trendPct,
    platformBreakdown: visibilitySummary.platformBreakdown,
    citedPageCount,
    resultCount: visibilitySummary.resultCount,
    dateRange: visibilitySummary.dateRange,
    mentionRate: answerIntelProof?.overallMentionRate ?? null,
    decliningTopicCount: answerIntelProof?.decliningTopics.length ?? 0,
    risingTopicCount: answerIntelProof?.risingTopics.length ?? 0,
    weekOverWeekCitations: visibilitySummary.weekOverWeekCitations,
    weekOverWeekMentions: visibilitySummary.weekOverWeekMentions,
  };

  // FAQ schema coverage metric
  const pagesWithFaq = pageSnapshots.filter((s) => s.faqs.length > 0);
  const pagesWithFaqAndSchema = pagesWithFaq.filter((s) =>
    s.schema_types.some((t) => t.toLowerCase().includes("faq")),
  );
  const faqSchemaCoverage = pagesWithFaq.length > 0
    ? { covered: pagesWithFaqAndSchema.length, total: pagesWithFaq.length }
    : null;

  // Platform distribution for Today context strip
  // Normalizes raw citations into percentages across the 3 major AI platforms
  const platformDistribution = (() => {
    const total = visibilitySummary.platformBreakdown.reduce(
      (s, p) => s + p.citations,
      0,
    );
    if (total === 0) return null;
    const buckets = { google_aio: 0, chatgpt: 0, perplexity: 0, other: 0 };
    for (const p of visibilitySummary.platformBreakdown) {
      if (p.platform === "google_aio") buckets.google_aio += p.citations;
      else if (p.platform === "chatgpt") buckets.chatgpt += p.citations;
      else if (p.platform === "perplexity") buckets.perplexity += p.citations;
      else buckets.other += p.citations;
    }
    const pct = (n: number) => Math.round((n / total) * 100);
    const result = {
      google_aio: pct(buckets.google_aio),
      chatgpt: pct(buckets.chatgpt),
      perplexity: pct(buckets.perplexity),
      total,
    };
    return result;
  })();

  // Platform concentration risk: single platform > 85%
  const concentratedPlatform = platformDistribution
    ? (platformDistribution.google_aio > 85 ? "google_aio" as const
      : platformDistribution.chatgpt > 85 ? "chatgpt" as const
      : platformDistribution.perplexity > 85 ? "perplexity" as const
      : null)
    : null;

  const proposedWaves = planWaves(
    playbookBriefs,
    pageIssues,
    rolloutExecutions,
    persistedWaves
  );

  for (const w of persistedWaves) {
    if (w.status === "dismissed" || w.status === "completed") continue;
    const derived = deriveWaveStatus(w, pageIssues);
    const group =
      derived === "proposed"
        ? ("ship" as const)
        : derived === "partially_shipped" || derived === "shipped"
          ? ("verify" as const)
          : derived === "partially_verified"
            ? ("verify" as const)
            : ("waiting" as const);
    const dot =
      derived === "proposed"
        ? "bg-muted-foreground"
        : derived.includes("verified") || derived.includes("shipped")
          ? "bg-accent-primary"
          : "bg-status-warning";
    const progress = computeWaveProgress(w, pageIssues);
    items.push({
      id: `wave-${w.rolloutWaveId}`,
      group,
      label: w.title,
      meta: `Rollout plan · ${progress.verified}/${progress.totalPages} verified`,
      href: "/pages",
      dot,
      detail: w.rationale,
    });
  }

  for (const w of proposedWaves.slice(0, 1)) {
    if (persistedWaves.some((pw) => pw.rolloutWaveId === w.rolloutWaveId))
      continue;
    items.push({
      id: `wave-${w.rolloutWaveId}`,
      group: "ship",
      label: w.title,
      meta: `Rollout plan proposed · ${w.targetPages.length} pages`,
      href: "/pages",
      dot: "bg-muted-foreground",
      detail: w.rationale,
    });
  }

  for (const issue of handedOffIssues) {
    items.push({
      id: `waiting-${issue.issueId}`,
      group: "waiting",
      label: issue.pagePath || "/",
      meta: issue.handedOffAt
        ? `Handed off ${formatTimeAgo(new Date(issue.handedOffAt))}`
        : "Handed off",
      href: pagesHref(issue.pageUrl),
      dot: "bg-muted-foreground/40",
      detail:
        "When the fix ships, mark shipped and run verification from Pages.",
      issueId: issue.issueId,
      issueStatus: issue.status,
      pageUrl: issue.pageUrl,
      pagePath: issue.pagePath,
    });
  }

  const enrichedItems = items.map((item) => ({
    ...item,
    plainGroup: toPlainGroup(item.group),
  }));

  const verifiedFixes = verifiedIssues
    .filter((i) => i.verifiedAt)
    .sort(
      (a, b) =>
        new Date(b.verifiedAt!).getTime() - new Date(a.verifiedAt!).getTime()
    )
    .slice(0, 5)
    .map((i) => ({
      issueId: i.issueId,
      pagePath: i.pagePath || "/",
      href: pagesHref(i.pageUrl),
      verifiedAt: i.verifiedAt!,
      summary: i.verifyResult?.summary ?? "Verified",
      verificationObservationRunId: i.verificationObservationRunId ?? null,
      verificationBaselineObservationRunId:
        i.verificationBaselineObservationRunId ?? null,
      verificationBindingLegacy: !i.verificationObservationRunId,
    }));

  const citIdx = citationEvidenceIndex;
  const primaryVis = primaryVisibilityRunForResults(results);
  const competitorUniverse = loadCompetitorUniverseRuntime();
  const competitorLine = buildTodayCompetitorLine({
    universe: competitorUniverse,
    citationIndex: citIdx,
    primaryVisibilityRun: primaryVis,
    importCompetitorDomains: competitors.map((c) => c.domain),
  });

  const nextCandidates: (TodayNextMove | null)[] = [];

  if (warningAlerts.length > 0) {
    const first = warningAlerts[0];
    nextCandidates.push({
      title: `Clear ${warningAlerts.length} observed page issue${warningAlerts.length !== 1 ? "s" : ""}`,
      href: pagesHref(first.url),
      evidence:
        "Found during the latest crawl. Open in Pages to see what was detected.",
      observationRunId: first.observation_run_id ?? activeCrawlId,
      evidenceScope: "crawl",
    });
  }
  if (shippedIssues.length > 0) {
    const s = shippedIssues[0];
    nextCandidates.push({
      title: "Run ship verification on staged fixes",
      href: pagesHref(s.pageUrl),
      evidence:
        "This change was marked as shipped. Verify it by fetching the live page to confirm the fix is in production.",
      observationRunId: activeCrawlId,
      evidenceScope: "mixed",
    });
  }
  if (newIssues.length > 0) {
    nextCandidates.push({
      title: `Triage ${newIssues.length} open page issue${newIssues.length !== 1 ? "s" : ""}`,
      href: "/pages",
      evidence:
        "Issues mix crawl-backed guardrails with playbook inference — each row labels observed vs inferred.",
      observationRunId: activeCrawlId,
      evidenceScope: "mixed",
    });
  }
  if (undecidedCount > 0) {
    nextCandidates.push({
      title: "Work the Review queue (hypothesis locks)",
      href: "/changes?tab=attribution",
      evidence:
        "Imported visibility shifts with unreviewed attribution. Lock a cause when you know what happened.",
      observationRunId: null,
      evidenceScope: "review_heuristic",
    });
  }
  if (decayAlerts.length > 0) {
    const meaningful = decayAlerts.filter((d) => d.status === "meaningful_decline").length;
    nextCandidates.push({
      title: `${decayAlerts.length} page${decayAlerts.length !== 1 ? "s" : ""} with declining citations${meaningful > 0 ? ` (${meaningful} significant)` : ""}`,
      href: "/pages",
      evidence:
        "Citations to this page are declining compared to earlier data. Check if content is outdated or structure has changed.",
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Representation discrepancy check (quiet — only notable) ──
  const entityIdx = extractEntities(pageSnapshots);
  const discrepancyReport = detectDiscrepancies(entityIdx);
  const notableDisc = discrepancyReport.discrepancies.filter((d) => d.severity === "notable");
  if (notableDisc.length > 0) {
    nextCandidates.push({
      title: `${notableDisc.length} possible representation ${notableDisc.length === 1 ? "discrepancy" : "discrepancies"} in AI answers`,
      href: "/settings/health",
      evidence:
        "Detected from structural comparison of AI answer content against your owned page data. Conservative signals only — review in Diagnostics.",
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Geographic coverage insight ──
  const geoCoverage = computeGeoCoverage(
    allPages,
    citationEvidenceIndex?.by_page_and_topic ?? [],
    getActivePrompts(),
  );
  if (geoCoverage.gaps.length > 0) {
    const topGap = geoCoverage.gaps[0];
    nextCandidates.push({
      title: `${geoCoverage.gaps.length} local market${geoCoverage.gaps.length !== 1 ? "s" : ""} with competitor presence and limited owned visibility`,
      href: "/settings/health",
      evidence:
        `Strongest gap: ${topGap.city} (${topGap.competitor_pages} competitor pages, ${topGap.owned_pages} owned). Based on page registry data.`,
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Journey stage insight ──
  const journeyCoverage = computeJourneyCoverage(promptLibrary);
  if (journeyCoverage.absent_stages.length > 0 && journeyCoverage.total_active >= 10) {
    nextCandidates.push({
      title: `No prompt coverage in ${journeyCoverage.absent_stages.map((s) => JOURNEY_STAGE_LABELS[s]).join(", ")} stage${journeyCoverage.absent_stages.length !== 1 ? "s" : ""}`,
      href: "/settings/health",
      evidence:
        `${journeyCoverage.total_active} active prompts across ${journeyCoverage.stages.filter((s) => s.active_prompt_count > 0).length} stages. Keyword-based classification.`,
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Snippet intelligence — high-priority extractability gap ──
  if (citationEvidenceIndex) {
    const extractResults = analyzeAllExtractability(pageSnapshots, citMap);
    const snippetIntel = computeSnippetIntelligence({
      ownedExtractability: extractResults,
      citationIndex: citationEvidenceIndex,
      snapshots: pageSnapshots,
      ownedDomain: siteDomain,
    });
    const highPriority = snippetIntel.signals.filter((s) => s.priority === "high");
    if (highPriority.length > 0) {
      nextCandidates.push({
        title: `${highPriority.length} high-priority extractability ${highPriority.length === 1 ? "gap" : "gaps"} on cited pages`,
        href: "/settings/health",
        evidence:
          `${highPriority[0].summary}. Based on structural analysis of ${snippetIntel.total_owned_pages_analyzed} cited pages.`,
        observationRunId: null,
        evidenceScope: "mixed",
      });
    }
  }

  nextCandidates.push(null);

  const summary = buildTodaySummary({
    verifiedFixes,
    nextMoveCandidates: nextCandidates,
    competitorLine,
    primaryVisibilityRun: primaryVis,
  });

  const lastCrawlForProof = summary.crawl.activeObservationRun;
  const crawlCompletedAt = lastCrawlForProof?.completed_at ?? null;
  const crawlAgeDaysForProof = crawlCompletedAt
    ? Math.floor((Date.now() - new Date(crawlCompletedAt).getTime()) / 86_400_000)
    : null;
  const crawlStaleForProof =
    crawlAgeDaysForProof !== null && crawlAgeDaysForProof > 14;
  const visibilityPartialSample =
    !!primaryVis?.is_synthetic_wrapper ||
    (!!crawlCompletedAt && !primaryVis?.citation_index_built_at);

  const crawlRunId = lastCrawlForProof?.run_id ?? null;
  const visibilityRunId = primaryVis?.run_id ?? null;
  const crawlHrefResolved =
    crawlRunId && getObservationRun(crawlRunId)
      ? summary.crawl.activeObservationHref
      : null;
  const visibilityHrefResolved =
    visibilityRunId && getObservationRun(visibilityRunId)
      ? summary.visibility.activeObservationHref
      : null;

  const proofContext: TodayProofContext = {
    crawlRunId,
    crawlCompletedAt,
    crawlHref: crawlHrefResolved,
    visibilityRunId,
    visibilityCompletedAt: primaryVis?.completed_at ?? null,
    visibilityHref: visibilityHrefResolved,
    citationIndexBuiltAt: primaryVis?.citation_index_built_at ?? null,
    visibilitySynthetic: !!primaryVis?.is_synthetic_wrapper,
    visibilitySource: primaryVis?.source ?? null,
    resultsRowCount: results.length,
    resultsThrough: visibilitySummary.dateRange?.to ?? null,
    visibilityStaleVsCrawl: summary.visibility.staleVsCrawl,
    visibilityStaleNote: summary.visibility.staleNote,
    crawlAgeDays: crawlAgeDaysForProof,
    crawlStale: crawlStaleForProof,
    visibilityPartialSample,
    answerIntelligence: answerIntelProof,
  };

  const observationRunIds = new Set(
    listObservationRuns().map((r) => r.run_id),
  );
  const serializedPendingFindings = pendingFindings.map((f) =>
    serializeFindingForToday(f, observationRunIds),
  );
  const acceptedAwaitingPromotionCount = allScanFindings.filter(
    (f) => f.status === "accepted" && f.promotionStatus === "none",
  ).length;

  // Milestone sync moved to post-import (Phase 1C-3) — Today render reads only.
  // New milestone events are written to state.events during import, so
  // pickTodayMilestoneTeaser can find them from persisted state.
  const milestoneState = getMilestoneState();
  const milestoneTeaserRaw = pickTodayMilestoneTeaser(milestoneState, []);
  const milestoneTeaser = milestoneTeaserRaw
    ? {
        title: milestoneTeaserRaw.title,
        subtitle: milestoneTeaserRaw.subtitle,
        proofSummary: milestoneTeaserRaw.proofSummary,
        achievedAt: milestoneTeaserRaw.achievedAt,
        magnitude: milestoneTeaserRaw.magnitude,
      }
    : null;

  const localAttentionStrip = isDemoMode
    ? null
    : buildTodayLocalAttention(getLocalPresenceSnapshot());

  const scanState = readScanState();
  const scanPhaseFailed = scanState?.phase === "failed";

  // Phase 4 (2026-04-19): experimentProof removed. It was a "show the newest
  // promising experiment" card that depended on the experiments table. The
  // hurting-verdict action cards on Today now carry the same signal in a more
  // honest form (actual Z-score verdict, not "operator-started experiment").
  const experimentProof = null;

  // Brain-driven action stack removed 2026-04-18 (Phase 7 cleanup).
  // Was producing "Investigate h1 regression" shrug cards with 2-of-3 sample
  // size pattern math. Ablation + data-grounded gap scanner coming (see
  // docs/IDEAS_PARKING_LOT.md).
  //
  // For NOW the Today action stack sources from two feeds only:
  //   1. Schema-parity actions (Phase 1 work, genuinely useful \u2014 kept)
  //   2. Legacy recommendation-engine top picks (serializedPrimary, serializedSecondary)
  //      \u2014 with the bigram Frankenstein already removed at the engine level
  //      so whatever remains is structural/investigative recs, no H2 garbage.
  //
  // The new data-grounded scanner will slot in here once Part 1b lands.
  const urlChangePatterns = readStore<UrlChangePattern>("url-change-patterns");
  void urlChangePatterns; // Reserved for Phase 7 Part 3 composite ranking

  const schemaParityActions = buildSchemaParityActions({
    findings: pendingFindings,
    citationsByUrl: citMap,
    maxActions: 1,
  });

  // Phase 7 Part 1b (2026-04-18): data-grounded gap-scanner recs flow through
  // the normal rec-engine \u2192 rankAndSelect pipeline. Once the scanner's
  // experiment-URL filter was fixed (match path-only, not full URL), gap recs
  // correctly top-rank and land as serializedPrimary / serializedSecondary.
  // Schema-parity actions still get the primary slot when present.
  //
  // Phase 7 Part 1c (2026-04-19): surface URL-level "hurting" verdicts from the
  // Z-score engine directly on Today as critical action cards. This is the first
  // cut of the experiments\u2192verdicts convergence. Previously these verdicts
  // lived only in url-change-outcomes.json with no UI surface; a -27 z-score
  // on /custom-home-builder-bay-area (the money page) was invisible to the user.
  //
  // Dedup: one card per URL (worst Z-score wins). Priority: 80+|z| so they beat
  // most engine recs but stay below near-impossible scores.
  // Phase 7 Part 1d (2026-04-19): hurting cards now carry the full story \u2014
  // named the change that caused it, how long it's been hurting, whether the
  // Z-score is worsening. Joined from imported-changes + url-change-outcomes
  // `transitions` counter.
  type HurtingRow = {
    url: string;
    changeId: string;
    z: number;
    deltaPct: number;
    confidence: "low" | "medium" | "high";
    baselineDaysUsed: number;
    postDaysUsed: number;
    recordedAt: string;
    transitions: number;
  };
  // Only surface URLs whose LATEST verdict is still "hurting" (2026-04-19
  // correctness fix). A page that was hurting and has since recovered \u2014
  // flipping to `helping` on a later outcome \u2014 shouldn't still show as a
  // FIX NOW card. First pass: find each URL's most recent outcome and whether
  // it's currently hurting.
  const latestVerdictByUrl = new Map<string, { verdict: string; updatedAt: string }>();
  for (const o of urlChangeOutcomes) {
    const existing = latestVerdictByUrl.get(o.url);
    if (!existing || o.updated_at > existing.updatedAt) {
      latestVerdictByUrl.set(o.url, { verdict: o.verdict, updatedAt: o.updated_at });
    }
  }
  const hurtingByUrl = new Map<string, HurtingRow>();
  for (const o of urlChangeOutcomes) {
    if (o.verdict !== "hurting") continue;
    const latest = latestVerdictByUrl.get(o.url);
    if (latest?.verdict !== "hurting") continue; // recovered \u2014 skip
    const z = o.landing_z ?? 0;
    const existing = hurtingByUrl.get(o.url);
    if (!existing || Math.abs(z) > Math.abs(existing.z)) {
      hurtingByUrl.set(o.url, {
        url: o.url,
        changeId: o.change_id,
        z,
        deltaPct: o.delta_pct ?? 0,
        confidence: (o.confidence as "low" | "medium" | "high") ?? "low",
        baselineDaysUsed: o.baseline_days_used,
        postDaysUsed: o.post_days_used,
        recordedAt: o.recorded_at,
        transitions: o.transitions,
      });
    }
  }
  const changeByIdForHurt = new Map(changelogEntries.map((c) => [c.id, c]));
  const fmtDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return "recently"; }
  };
  const hurtingActions: import("@/components/today/action-card").ActionCardAction[] =
    Array.from(hurtingByUrl.values()).map((h) => {
      const absZ = Math.abs(h.z);
      const pctStr = h.deltaPct < 0
        ? `${Math.abs(h.deltaPct * 100).toFixed(0)}% fewer citations`
        : "a citation decline";
      const change = changeByIdForHurt.get(h.changeId);
      const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
      const changeDesc = change?.change_description?.trim()
        ?? change?.asset_name?.trim()
        ?? null;
      const daysSinceRecorded = Math.max(
        0,
        Math.floor((Date.now() - new Date(h.recordedAt).getTime()) / 86_400_000),
      );
      const trendSuffix = h.transitions > 1 ? " \u00b7 worsening" : "";
      const headline = changeDate
        ? `${h.url} regressed after your ${changeDate} change`
        : `${h.url} is losing AI visibility`;
      const rationaleLead = changeDesc && changeDate
        ? `On ${changeDate}, ${changeDesc}. Since then`
        : changeDate
          ? `Since your ${changeDate} change`
          : "Since the latest detected change";
      const rationale = `${rationaleLead}, this page is getting ${pctStr} (Z-score ${h.z.toFixed(1)}, ${h.confidence} confidence). Hurting for ${daysSinceRecorded}d${trendSuffix}. Review the change \u2014 revert, iterate, or confirm it's platform noise.`;
      return {
        id: `hurt-${h.changeId}-${h.url}`,
        headline,
        rationale,
        expectedOutcome: "Restore or improve citation count to baseline.",
        sourceEvidence: `${h.baselineDaysUsed}d baseline \u2192 ${h.postDaysUsed}d post-change`,
        priorityScore: 80 + Math.min(absZ, 30),
        bucket: "critical",
        type: "hurting_verdict",
        confidence: h.confidence,
        href: `/changes/${h.changeId}`,
        responseStatus: null,
        targetPageUrl: h.url,
        targetPagePath: h.url,
        baselineCitations: citMap.get(h.url.replace(/\/+$/, "").toLowerCase()) ?? null,
        sourceChangeId: h.changeId,
      };
    });
  // Sort hurting cards by severity (most negative Z first).
  hurtingActions.sort((a, b) => b.priorityScore - a.priorityScore);

  // Acknowledgment filter: if the user clicked "Acknowledge" on a hurting card,
  // suppress it until the verdict changes (different z-score triggers a new
  // card id, which won't have a dismissed status). Reuses the existing
  // recommendation-response store \u2014 no new data plumbing.
  const acknowledgedHurtingCardIds = new Set(
    recommendationResponses
      .filter((r) => r.status === "dismissed" && r.recId.startsWith("hurt-"))
      .map((r) => r.recId),
  );
  const visibleHurtingActions = hurtingActions.filter(
    (a) => !acknowledgedHurtingCardIds.has(a.id),
  );

  // ── Winning action card: sourced from URL-level Z-score engine only.
  //
  // 2026-04-20 architectural rewrite: deleted the topic-level MemoryInsight
  // path that was producing false causal claims (e.g. crediting a trivial
  // "Removed duplicate FAQPage JSON-LD" sitewide cleanup for a +65% lift
  // that was actually driven by competitor decline). Topic-level attribution
  // conflates "change happened in topic X" with "topic X's trajectory was
  // caused by the change." Dead architecture.
  //
  // New source: url-change-outcomes.json, which runs per-URL Z-score analysis
  // with real pre/post windows. A URL earns a `helping` verdict only when its
  // own citation series rises significantly post-change. Topic is metadata,
  // not a causal primitive.
  //
  // Additional guards beyond the Z-score:
  //   1. TEMPLATE-EDIT DEDUP: if the same change_description appears on
  //      \u22653 pages within a week, it's a sitewide template edit, not a
  //      per-page causal move. Drop all pages that inherited that description.
  //   2. ACKNOWLEDGED SUPPRESSION: "Acknowledge" click on a previous win card
  //      hides until verdict transitions.

  // Template-edit dedup: find change_descriptions that appear on 3+ pages.
  const changeDescToChangeIds = new Map<string, Set<string>>();
  for (const c of changelogEntries) {
    const desc = (c.change_description || "").trim().toLowerCase();
    if (!desc || desc.length < 10) continue;
    if (!changeDescToChangeIds.has(desc)) changeDescToChangeIds.set(desc, new Set());
    changeDescToChangeIds.get(desc)!.add(c.id);
  }
  const templateEditChangeIds = new Set<string>();
  for (const ids of changeDescToChangeIds.values()) {
    if (ids.size >= 3) {
      for (const id of ids) templateEditChangeIds.add(id);
    }
  }

  // Build the winning-URL list from url-change-outcomes. One row per URL; take
  // the most recent `helping` verdict for each URL, rank by |delta_pct|.
  type HelpingRow = {
    url: string;
    changeId: string;
    deltaPct: number;
    landingZ: number;
    confidence: "low" | "medium" | "high";
    baselineDaysUsed: number;
    postDaysUsed: number;
    updatedAt: string;
    landingDayN: number | null;
  };
  const helpingByUrl = new Map<string, HelpingRow>();
  for (const o of urlChangeOutcomes) {
    if (o.verdict !== "helping") continue;
    if (templateEditChangeIds.has(o.change_id)) continue; // sitewide edits excluded
    const existing = helpingByUrl.get(o.url);
    if (!existing || o.updated_at > existing.updatedAt) {
      helpingByUrl.set(o.url, {
        url: o.url,
        changeId: o.change_id,
        deltaPct: o.delta_pct ?? 0,
        landingZ: o.landing_z ?? 0,
        confidence: (o.confidence as "low" | "medium" | "high") ?? "low",
        baselineDaysUsed: o.baseline_days_used,
        postDaysUsed: o.post_days_used,
        updatedAt: o.updated_at,
        landingDayN: o.landing_day_n,
      });
    }
  }
  // Only show URLs where the latest verdict is still `helping` (avoids
  // showing a historical helping that has since reverted to `hurting` or
  // `nothing_yet`).
  const visibleHelping = Array.from(helpingByUrl.values()).filter((h) => {
    const latest = latestVerdictByUrl.get(h.url);
    return latest?.verdict === "helping";
  });
  // Rank by delta magnitude (biggest effect first).
  visibleHelping.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const winningActions: import("@/components/today/action-card").ActionCardAction[] = [];
  // Take at most the top 2 winning URLs.
  const topHelpingUrls = visibleHelping.slice(0, 2);
  for (const h of topHelpingUrls) {
    const winCardId = `win-${h.changeId}-${h.url}`;
    const acknowledgedWin = recommendationResponses.some(
      (r) => r.recId === winCardId && r.status === "dismissed",
    );
    if (acknowledgedWin) continue;
    const change = changeByIdForHurt.get(h.changeId);
    const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
    const changeDesc = change?.change_description?.trim()
      ?? change?.asset_name?.trim()
      ?? null;
    const deltaPctAbs = Math.abs(h.deltaPct * 100);
    const pctStr = h.deltaPct > 0
      ? `up ${deltaPctAbs.toFixed(0)}%`
      : `${deltaPctAbs.toFixed(0)}% shift`;
    const landedSuffix = h.landingDayN !== null && h.landingDayN > 0
      ? ` (landed ${h.landingDayN}d after change)`
      : "";
    const headline = changeDate
      ? `${h.url} is winning after your ${changeDate} change`
      : `${h.url} is winning (URL-level Z-score)`;
    const rationaleLead = changeDesc && changeDate
      ? `On ${changeDate}, ${changeDesc}. Since then, this page's citations are ${pctStr}`
      : `Since your latest change, this page's citations are ${pctStr}`;
    const rationale = `${rationaleLead} (Z-score ${h.landingZ.toFixed(1)}, ${h.confidence} confidence${landedSuffix}). Attribution is URL-level \u2014 this page's own citations rose, not a topic-wide trend.`;
    winningActions.push({
      id: winCardId,
      headline,
      rationale,
      expectedOutcome: "Consider similar pages where this pattern could repeat.",
      sourceEvidence: `${h.baselineDaysUsed}d baseline \u2192 ${h.postDaysUsed}d post-change`,
      priorityScore: 75 - winningActions.length, // first wins slightly higher
      bucket: "high_leverage",
      type: "helping_verdict",
      confidence: h.confidence,
      href: `/changes/${h.changeId}`,
      responseStatus: null,
      targetPageUrl: h.url,
      targetPagePath: h.url,
      baselineCitations: citMap.get(h.url.replace(/\/+$/, "").toLowerCase()) ?? null,
      sourceChangeId: h.changeId,
    });
  }

  const assembled: import("@/components/today/action-card").ActionCardAction[] = [
    ...visibleHurtingActions,
    ...winningActions,
    ...schemaParityActions,
    ...(serializedPrimary ? [serializedPrimary] : []),
    ...(serializedSecondary ? [serializedSecondary] : []),
  ];
  const capped = assembled.slice(0, 4);

  // Prefer brain-driven actions on Today. Legacy flow remains only as safety
  // fallback if both brain and schema-parity produced nothing.
  const todayPrimary = capped[0] ?? serializedPrimary;
  const todaySecondary = capped[1] ?? serializedSecondary;
  const todayMoreActions = capped.slice(2);

  // ─────────────────────────────────────────────────────────────────────
  // Visibility Score chart + leaderboard (Day 6 visual rebuild, 2026-04-17)
  //
  // Profound-style dashboard: daily mention/citation/composite score for the
  // tenant + a top-5 competitor leaderboard. Pre-computes ALL three metric
  // series so the chart toggle is instant client-side. Pre-computes both
  // current (last 14d) AND previous (14d before that) windows so the
  // "Previous period" overlay is also zero-latency.
  //
  // Data source: the `promptAnswerObservations` canonical store already
  // imported above (line 522 ish) for the query-index build. We reuse it
  // here to avoid a second pass over the same file.
  // ─────────────────────────────────────────────────────────────────────
  const businessConfig = getBusinessConfig();
  const brandAliases = [
    businessConfig.name,
    // Simple shortened alias — "Ritz Builders" → "Ritz"
    businessConfig.name.split(" ")[0],
  ].filter((a, i, arr) => a && arr.indexOf(a) === i);

  // Compute a FULL 60-day time series server-side. The chart then slices
  // client-side based on the user's selected time range (7/14/30/60d).
  // Leaderboard still uses a 14-day window with a 14-day previous window
  // for its delta column (unchanged).
  const today = new Date();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
    return isoDay(d);
  };
  const chartEndDate = isoDay(today);
  const chartStartDate = daysAgo(59); // inclusive \u2192 60 days
  const leaderEndDate = isoDay(today);
  const leaderStartDate = daysAgo(13);
  const leaderPrevEndDate = daysAgo(14);
  const leaderPrevStartDate = daysAgo(27);

  const METRICS: VisibilityMetric[] = ["composite", "mention_rate", "citation_rate"];

  // Tenant 60-day time series, all three metrics.
  const brandSeriesByMetric = {} as Record<VisibilityMetric, VisibilityPoint[]>;
  for (const m of METRICS) {
    brandSeriesByMetric[m] = computeVisibilityTimeSeries({
      observations: promptAnswerObservations,
      metric: m,
      brandAliases,
      startDate: chartStartDate,
      endDate: chartEndDate,
    });
  }

  // 2026-04-19: per-platform breakdown for the chart's "by platform" view.
  // Matches Profound's per-platform visibility column.
  const brandSeriesByPlatform = computeVisibilityTimeSeriesByPlatform({
    observations: promptAnswerObservations,
    brandAliases,
    startDate: chartStartDate,
    endDate: chartEndDate,
  });

  // Leaderboard: 14d window with 14d previous for delta.
  const leaderboardByMetric = {} as Record<VisibilityMetric, EntityVisibility[]>;
  for (const m of METRICS) {
    leaderboardByMetric[m] = computeLeaderboard({
      observations: promptAnswerObservations,
      brandAliases,
      startDate: leaderStartDate,
      endDate: leaderEndDate,
      prevStartDate: leaderPrevStartDate,
      prevEndDate: leaderPrevEndDate,
      metric: m,
      limit: 5,
    });
  }

  // Top competitors from the composite leaderboard (top 4 non-owned), with
  // their own 60-day time series so the "Compare competitors" toggle is
  // zero-latency.
  const topCompetitorNames = leaderboardByMetric.composite
    .filter((e) => !e.isOwned)
    .slice(0, 4)
    .map((e) => e.name);

  const competitorSeriesByMetric = {} as Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  for (const m of METRICS) {
    const series = computeCompetitorSeries({
      observations: promptAnswerObservations,
      brandAliases,
      competitorNames: topCompetitorNames,
      metric: m,
      startDate: chartStartDate,
      endDate: chartEndDate,
    });
    competitorSeriesByMetric[m] = series
      .filter((s) => !s.isOwned)
      .map((s) => ({ name: s.name, points: s.points }));
  }

  // Chart event overlay (2026-04-19): annotate each currently-hurting URL's
  // change date with a red dot + guideline, and each helping URL with a green
  // one. Makes the chart honest \u2014 "up 10.5%" with context.
  const chartEvents: Array<{ date: string; tone: "danger" | "success" | "neutral"; label: string }> = [];
  const eventDateKey = new Set<string>();
  for (const h of hurtingByUrl.values()) {
    const change = changeByIdForHurt.get(h.changeId);
    const date = change?.timestamp?.slice(0, 10);
    if (!date) continue;
    const key = `hurt:${date}`;
    if (eventDateKey.has(key)) continue;
    eventDateKey.add(key);
    chartEvents.push({
      date,
      tone: "danger",
      label: `${h.url} \u2014 ${Math.abs((h.deltaPct ?? 0) * 100).toFixed(0)}% drop after change on ${date}`,
    });
  }
  // Green dots for URLs currently in `helping` state (from Z-score engine).
  for (const [url, latest] of latestVerdictByUrl.entries()) {
    if (latest.verdict !== "helping") continue;
    // Find the most recent helping outcome row for this URL to get its change_id.
    let bestHelping: typeof urlChangeOutcomes[number] | null = null;
    for (const o of urlChangeOutcomes) {
      if (o.url !== url) continue;
      if (o.verdict !== "helping") continue;
      if (!bestHelping || o.updated_at > bestHelping.updated_at) bestHelping = o;
    }
    if (!bestHelping) continue;
    const change = changeByIdForHurt.get(bestHelping.change_id);
    const date = change?.timestamp?.slice(0, 10);
    if (!date) continue;
    const key = `help:${date}`;
    if (eventDateKey.has(key)) continue;
    eventDateKey.add(key);
    chartEvents.push({
      date,
      tone: "success",
      label: `${url} \u2014 winning after change on ${date}`,
    });
  }
  // 2026-04-20: removed MemoryInsight-derived bestImproving green dot \u2014 the
  // url-change-outcomes `helping` dots above already cover all legitimate
  // winning events at URL level with Z-score validation.

  const visibilityData = {
    brandName: brandAliases[0] ?? "You",
    brandSeriesByMetric,
    brandSeriesByPlatform,
    leaderboardByMetric,
    competitorSeriesByMetric,
    chartEvents,
  };

  return {
    isDemoMode,
    scanPhaseFailed,
    summary,
    primaryAction: todayPrimary,
    secondaryAction: todaySecondary,
    moreActions: todayMoreActions,
    morningBrief,
    scoreboard,
    pendingFindings: serializedPendingFindings,
    shouldTriggerScan: scanOverdue,
    proofContext,
    localAttentionStrip,
    experimentProof,
    faqSchemaCoverage,
    platformDistribution,
    concentratedPlatform,
    visibilityData,
    // 2026-04-20: URL-verdict proof for the "Latest signal" strip. Replaces
    // the topic-level MemoryInsight source that was producing false causal
    // claims. Null when no URL is currently in `helping` state with rising
    // citations.
    urlVerdictProof: topHelpingUrls[0]
      ? (() => {
          const h = topHelpingUrls[0];
          const change = changeByIdForHurt.get(h.changeId);
          const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
          const deltaPctAbs = Math.abs(h.deltaPct * 100);
          return {
            changeId: h.changeId,
            pagePath: h.url,
            changeDate: changeDate ?? null,
            citationDeltaPct: Math.round(h.deltaPct * 1000) / 10, // one decimal
            deltaLabel: `${h.deltaPct > 0 ? "+" : ""}${deltaPctAbs.toFixed(0)}%`,
          };
        })()
      : null,
  };
}


/**
 * Serialize a brain action into the shape the existing ActionCard component
 * already knows (`ActionCardAction`). No new UI types needed.
 *
 * Maps the brain's action kind → card bucket:
 *   reverse_hurter    → "critical"        (red frame, urgent)
 *   replicate_winner  → "high_leverage"   (amber frame, high value)
 *   start_experiment  → "opportunistic"   (neutral frame, exploratory)
 *   exploratory       → "opportunistic"   (neutral, explicitly exploratory)
 *
 * Confidence `exploratory` collapses to `low` so the existing ActionCard
 * confidence rendering doesn't need new enum values.
 */
// serializeBrainAction / buildBrainEvidence / buildBrainConfidenceReason
// removed 2026-04-18 (Phase 7 cleanup). These served the url-brain-recommender
// shrug-card pipeline which is now gone. ~140 lines of dead serialization
// helpers excised. Replacement pipeline (data-grounded scanner + LLM-as-judge
// ablation) will have its own serialization layer when built.

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildAnswerIntelligenceProofContext(
  ai: NonNullable<typeof answerIntelligenceIndex>,
): NonNullable<import("@/lib/today-proof-context").TodayProofContext["answerIntelligence"]> {
  const totalMentioned = ai.brand_positioning.reduce(
    (s, bp) => s + bp.mention_count,
    0,
  );
  const totalObs = ai.brand_positioning.reduce(
    (s, bp) => s + bp.total_observations,
    0,
  );
  const overallMentionRate =
    totalObs > 0 ? Math.round((totalMentioned / totalObs) * 1000) / 1000 : 0;

  const declining: string[] = [];
  const rising: string[] = [];
  for (const [topic, platforms] of Object.entries(
    ai.topic_platform_summary,
  )) {
    const dirs = Object.values(platforms).map((p) => p.trend_direction);
    if (dirs.filter((d) => d === "down").length > dirs.length / 2) {
      declining.push(topic);
    }
    if (dirs.filter((d) => d === "up").length > dirs.length / 2) {
      rising.push(topic);
    }
  }

  return {
    builtAt: ai.built_at,
    totalObservations: ai.total_observations,
    topicCount: ai.brand_positioning.length,
    overallMentionRate,
    decliningTopics: declining,
    risingTopics: rising,
  };
}
