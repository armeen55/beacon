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
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getGuardrailAlerts } from "@/domains/pages/guardrail-store";
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
import {
  getActiveExperiments,
  getExperimentByRecId,
} from "@/domains/product/experiment-store";
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
import {
  getPendingFindings,
  getResolvedFindingsCount,
  getAcceptedFindings,
} from "@/domains/scanning/findings-store";
// buildCompetitorRank / classifyCompetitorType moved to post-import milestone sync (Phase 1C-3)
import { getBusinessConfig } from "@/lib/business-config";
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
import { computeMemoryInsights } from "@/domains/attribution/memory";
import { dailyMetricSnapshots } from "@/storage/canonical-store";
import { getCompetitorMonitoringState } from "@/domains/competitor-monitoring/store";
import { generateCompetitorAlerts } from "@/domains/competitor-monitoring/detect-changes";


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

  const pageSnapshots = getPageSnapshots();
  const guardrailAlerts = getGuardrailAlerts();

  const pendingFindings = getPendingFindings();
  const resolvedFindingsCount = getResolvedFindingsCount();

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

  const activeExperimentRecIdSet = new Set(
    getActiveExperiments().map((e) => e.recId),
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
  const replicationPromisingCards = buildPromisingReplicationCards(
    getActiveExperiments(),
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

  // ── Morning brief (Phase 1D) + Attribution Memory (Phase 3) ──
  // Use visibilitySummary.totalCitations (from results array) to match scoreboard
  const memoryInsights = computeMemoryInsights({
    changes: changelogEntries,
    snapshots: dailyMetricSnapshots,
  });
  // ── Competitor monitoring alerts (Phase 5) ──
  const competitorMonState = getCompetitorMonitoringState();
  const competitorAlerts = generateCompetitorAlerts(competitorMonState.recentChanges);

  const morningBrief: MorningBriefData = buildMorningBrief({
    primaryAction,
    secondaryActions,
    answerIntelligence: answerIntelligenceIndex,
    citationIndex: citationEvidenceIndex,
    trendPct: visibilitySummary.trendPct,
    totalOwnedCitations: visibilitySummary.totalCitations,
    latestDataDate: visibilitySummary.dateRange?.to ?? null,
    memoryInsights,
    competitorAlerts,
    competitorSnapshots: competitorMonState.snapshots,
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
        hasExperiment: !!getExperimentByRecId(primaryAction.id),
        targetPageUrl: primaryAction.targetPageUrl,
        targetPagePath: primaryAction.targetPagePath,
        baselineCitations: primaryAction.targetPageUrl
          ? (citMap.get(primaryAction.targetPageUrl.replace(/\/+$/, "").toLowerCase()) ?? 0)
          : null,
        sourceChangeId: primaryAction.sourceChangeId,
        lineageBullets: primaryLineage,
        answerContext: primaryAction.answerContext ?? null,
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
        hasExperiment: !!getExperimentByRecId(secondaryRec.id),
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
        }),
        answerContext: secondaryRec.answerContext ?? null,
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
  const acceptedAwaitingPromotionCount = getAcceptedFindings().filter(
    (f) => f.promotionStatus === "none",
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

  return {
    isDemoMode,
    scanPhaseFailed,
    summary,
    primaryAction: serializedPrimary,
    secondaryAction: serializedSecondary,
    morningBrief,
    scoreboard,
    pendingFindings: serializedPendingFindings,
    shouldTriggerScan: scanOverdue,
    proofContext,
    localAttentionStrip,
  };
}


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
