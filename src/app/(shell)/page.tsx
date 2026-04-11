import {
  results,
  changelogEntries,
  opportunities,
  competitors,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { allPages } from "@/domains/pages/page-store";
import { pageSnapshots } from "@/domains/pages/snapshot-store";
import { guardrailAlerts } from "@/domains/pages/guardrail-store";
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
import { TodayClient, type TodayQueueItem } from "./today-client";
import { updateIssueStatus, verifyAndUpdateIssue } from "./pages/issue-actions";
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
import { respondToRecommendation } from "./recommendation-actions";
import {
  getActiveExperiments,
  updateExperimentCitations,
  persistExperiments,
  getExperimentByRecId,
} from "@/domains/product/experiment-store";
import {
  startExperimentAction,
  updateExperimentAction,
} from "./experiment-actions";
import {
  backfillFromExistingData,
  computeOutcomeSummary,
  persistOutcomes,
  outcomeRecords,
} from "@/domains/product/outcome-store";
import { computeCitationDecay, getDecayAlerts, summarizeDecay } from "@/domains/attribution/citation-decay";
import { extractEntities } from "@/domains/entity/entity-extract";
import { detectDiscrepancies } from "@/domains/entity/discrepancy-detect";
import { computeGeoCoverage, summarizeGeoCoverage } from "@/domains/geo/coverage";
import { getActivePrompts, promptLibrary } from "@/domains/prompts/prompt-library";
import { computeJourneyCoverage } from "@/domains/prompts/journey-coverage";
import { JOURNEY_STAGE_LABELS } from "@/domains/prompts/journey-stages";
import { analyzeAllExtractability } from "@/domains/pages/extractability";
import { computeSnippetIntelligence } from "@/domains/competitors/snippet-intel";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import { primaryVisibilityRunForResults } from "@/domains/observations/visibility-context";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { buildTodayCompetitorLine } from "@/domains/competitors/today-competitor-line";
import { PLATFORM_LABELS, type Platform } from "@/lib/constants";
import Link from "next/link";

export default function TodayPage() {
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

  const visibilitySummary = {
    totalCitations,
    totalMentions,
    platformBreakdown,
    dateRange: earliestDate && latestDate ? { from: earliestDate, to: latestDate } : null,
    latestImportDate: latestDate,
    trendPct,
    resultCount: results.length,
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
      meta: "Attribution bookkeeping · heuristic",
      href: "/review",
      dot: "bg-muted-foreground",
      detail:
        "Review the suggested cause and lock it if it matches what you know.",
    });
  }
  if (undecidedCount - easyCalls > 0) {
    items.push({
      id: "review-remaining",
      group: "review",
      label: `${undecidedCount - easyCalls} more visibility shifts in Review`,
      meta: "Attribution bookkeeping · needs decision",
      href: "/review",
      dot: "bg-status-warning",
      detail:
        "Each row is a hypothesis queue from imported snapshots, not confirmed outcomes.",
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

  const allRecommendations = computeRecommendations({
    impactRows,
    patterns,
    briefs: playbookBriefs,
    pageSnapshots,
    citationCountMap: citMap,
    citationIndex: citationEvidenceIndex,
    allPages,
    decayResults,
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

  const { primaryAction, secondary } = rankAndSelect({
    recommendations,
    impactRows,
    patterns,
    briefPatternCounts,
    patternTrackRecords: trackRecord.patternRecords,
  });

  function recHref(r: { type: string; targetPageUrl: string | null; sourceChangeId: string | null }): string {
    if (r.targetPageUrl) return pagesHref(r.targetPageUrl);
    if (r.sourceChangeId) return `/changes/${r.sourceChangeId}`;
    if (r.type === "competitive_displacement" || r.type === "topic_cluster_gap") return "/competitors";
    return "/pages";
  }

  // ── Outcome store: idempotent backfill from existing data ──
  const backfillResult = backfillFromExistingData({
    responses: recommendationResponses.map((r) => ({
      recId: r.recId,
      status: r.status,
      respondedAt: r.respondedAt,
    })),
    experiments: getActiveExperiments().map((e) => ({
      id: e.id,
      recId: e.recId,
      status: e.status,
      targetPageUrl: e.targetPageUrl,
      baselineCitations: e.baselineCitations,
      latestCitations: e.latestCitations,
      startedAt: e.startedAt,
    })),
    scorecardVerdicts: scorecardRows
      .filter((r) => r.verdict !== "pending" && r.verdict !== "too_early")
      .map((r) => ({
        changeId: r.change.id,
        verdict: r.verdict,
        assetName: r.change.asset_name,
        topic: r.topics[0] ?? null,
        url: null,
      })),
  });
  if (backfillResult.added > 0) {
    persistOutcomes().catch(() => {});
  }
  const outcomeSummary = outcomeRecords.length > 0 ? computeOutcomeSummary() : null;

  const trackRecordSummary =
    trackRecord.totalActedOn > 0 || trackRecord.totalExplicitAccepted > 0 || (outcomeSummary && outcomeSummary.total > 0)
      ? {
          totalActedOn: trackRecord.totalActedOn,
          totalValidated: trackRecord.totalValidated,
          overallSuccessRate: trackRecord.overallSuccessRate,
          totalExplicitAccepted: trackRecord.totalExplicitAccepted,
          totalExplicitDismissed: trackRecord.totalExplicitDismissed,
          outcomeTotal: outcomeSummary?.total ?? 0,
          outcomePositiveRate: outcomeSummary?.positive_rate ?? null,
          outcomeAvgDelta: outcomeSummary?.avg_citation_delta ?? null,
        }
      : null;

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

  // ── Experiments: auto-update citation outcomes ──
  const activeExperiments = getActiveExperiments();
  let experimentsChanged = false;
  for (const exp of activeExperiments) {
    if (!exp.targetPageUrl) continue;
    const normUrl = exp.targetPageUrl.replace(/\/+$/, "").toLowerCase();
    const currentCit = citMap.get(normUrl) ?? 0;
    if (currentCit !== exp.latestCitations) {
      updateExperimentCitations(exp.id, currentCit);
      experimentsChanged = true;
    }
  }
  if (experimentsChanged) {
    persistExperiments().catch(() => {});
  }

  const serializedExperiments = activeExperiments.map((exp) => {
    const daysSinceStart = Math.floor(
      (new Date().getTime() - new Date(exp.startedAt).getTime()) / 86_400_000,
    );
    const citDelta = exp.baselineCitations !== null && exp.latestCitations !== null
      ? exp.latestCitations - exp.baselineCitations
      : null;
    return {
      id: exp.id,
      recId: exp.recId,
      headline: exp.headline,
      recType: exp.recType,
      targetPagePath: exp.targetPagePath,
      watchAfter: exp.watchAfter,
      operatorNote: exp.operatorNote,
      startedAt: exp.startedAt,
      status: exp.status,
      daysSinceStart,
      baselineCitations: exp.baselineCitations,
      latestCitations: exp.latestCitations,
      citDelta,
    };
  });

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
      }
    : null;

  const topRecs = secondary.slice(0, 4).map((r) => ({
    id: r.id,
    type: r.type,
    headline: r.headline,
    rationale: r.rationale,
    sourceEvidence: r.sourceEvidence,
    confidence: r.confidence,
    sourceChangeId: r.sourceChangeId,
    href: recHref(r),
    responseStatus: getResponse(r.id)?.status ?? null,
    confidenceReason: buildConfidenceReason(r),
  }));

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
      href: "/review",
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
      href: "/diagnostics",
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
      href: "/diagnostics",
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
      href: "/diagnostics",
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
        href: "/diagnostics",
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

  return (
    <div className="max-w-3xl">
      <TodayClient
        summary={summary}
        visibilitySummary={visibilitySummary}
        items={enrichedItems}
        impactSignals={actionableImpact}
        recommendedMoves={topRecs}
        primaryAction={serializedPrimary}
        trackRecord={trackRecordSummary}
        onUpdateIssue={
          updateIssueStatus as (
            issueId: string,
            status: string,
            meta?: { pageUrl?: string; pagePath?: string }
          ) => Promise<{ success: boolean }>
        }
        onVerifyIssue={verifyAndUpdateIssue}
        onRespondToRec={respondToRecommendation}
        experiments={serializedExperiments}
        onStartExperiment={startExperimentAction}
        onUpdateExperiment={updateExperimentAction}
      />

      {enrichedItems.length === 0 && (
        <p className="text-[11px] text-muted-foreground mt-4">
          Full sample history lives under{" "}
          <Link href="/results" className="text-accent-primary hover:underline">
            History
          </Link>
          ; analyst tools under{" "}
          <Link
            href="/diagnostics"
            className="text-accent-primary hover:underline"
          >
            Diagnostics
          </Link>
          .
        </p>
      )}
    </div>
  );
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
