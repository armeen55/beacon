import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import {
  changelogEntries,
  opportunities,
  results,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { ScorecardTable, type ChangeIntelEntry } from "./scorecard-client";
import { changeContracts } from "@/domains/changelog/change-contract";
import { ChangeContractUI } from "./change-contract-client";
import { createChangeContract, verifyChangeContract } from "./contract-actions";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  rolloutExecutions,
  pageIssues,
  patternEvidence as persistedPatternEvidence,
} from "@/domains/pages/issues";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import {
  computeTrackRecord,
  wasChangeRecommended,
  matchChangeToPattern,
} from "@/domains/product/recommendation-tracker";
import { getActiveExperiments } from "@/domains/product/experiment-store";
import {
  recommendationResponses,
  isRecSuppressed,
} from "@/domains/product/recommendation-response-store";
import { computeRecommendations } from "@/domains/product/recommendation-engine";
import { allPages } from "@/domains/pages/page-store";
import { getSiteConfig } from "@/lib/site-config";
import { buildCompetitorRank } from "@/lib/performance-timeseries";
import { classifyCompetitorType } from "@/domains/competitors/classify-type";
import { syncMilestonesFromWorkspace } from "@/domains/milestones";
import { computeGeoCoverage } from "@/domains/geo/coverage";
import { getActivePrompts } from "@/domains/prompts/prompt-library";
import { computeCitationDecay, getDecayAlerts } from "@/domains/attribution/citation-decay";
import { getBusinessConfig } from "@/lib/business-config";
import {
  computeLocalOperatorSurface,
  loadLocalOperatorImport,
} from "@/domains/local-operator/surface";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents, type OutcomeEventType } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { candidateLinks } from "@/domains/attribution/store";
import { buildJudgment } from "@/domains/attribution/judgment";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { PLATFORM_LABELS, METRIC_TYPE_LABELS } from "@/lib/constants";
import {
  InlineReviewQueue,
  type ReviewQueueItem,
  type ResolvedItem,
  type Decisionability,
} from "../review/review-queue-client";
import { ChangesTabShell } from "./changes-tab-shell";
import {
  buildReplicationCards,
  buildPromisingReplicationCards,
} from "@/domains/product/replication-engine";
import { serializeReplicationCards } from "@/domains/product/replication-serialize";
import { ReplicationCardsClient } from "@/components/replication/replication-cards-client";
import { respondToRecommendation } from "../recommendation-actions";
import { startExperimentAction } from "../experiment-actions";

export default async function ChangeScorecardPage() {
  const rawRows = computeScorecard(changelogEntries, results, opportunities, eventDecisions);
  const rows = enrichWithImpact(rawRows);

  rows.sort((a, b) => {
    if (a.operatorConfirmedCount !== b.operatorConfirmedCount)
      return b.operatorConfirmedCount - a.operatorConfirmedCount;
    return (b.topScore ?? -1) - (a.topScore ?? -1);
  });

  const allTopics = [
    ...new Set(rows.flatMap((r) => r.topics)),
  ].sort();
  const allPlatforms = [
    ...new Set(rows.flatMap((r) => r.platforms)),
  ].sort();

  const withEvents = rows.filter((r) => r.totalEventsLinked > 0).length;
  const operatorConfirmed = rows.filter((r) => r.operatorConfirmedCount > 0).length;
  const highConfidence = rows.filter((r) => r.impact.confidence === "high").length;

  // Recommendation intelligence: pattern mining + track record
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
  const pageSnapshots = getPageSnapshots();
  const patterns = minePatterns(
    pageSnapshots,
    citMap,
    rawRows,
    rolloutExecutions,
    persistedPatternEvidence,
  );
  const briefs = generateBriefs(pageSnapshots, citMap, patterns);
  const trackRecord = computeTrackRecord({ impactRows: rows, patterns });

  const { siteDomain } = getSiteConfig();
  const milestoneCompetitorRank = buildCompetitorRank(
    citationEvidenceIndex,
    siteDomain,
    classifyCompetitorType,
  );
  const { state: milestoneState } = await syncMilestonesFromWorkspace({
    results,
    citationIndex: citationEvidenceIndex,
    siteDomain,
    competitorRank: milestoneCompetitorRank,
  });
  const decayResultsChanges = computeCitationDecay(siteDomain);
  const allRecs = computeRecommendations({
    impactRows: rows,
    patterns,
    briefs,
    pageSnapshots,
    citationCountMap: citMap,
    citationIndex: citationEvidenceIndex,
    allPages,
    decayResults: decayResultsChanges,
  });
  const recommendationsFiltered = allRecs.filter((r) => !isRecSuppressed(r.id));

  const urlToPageIdChanges = new Map(
    allPages.map((p) => [p.url.replace(/\/+$/, "").toLowerCase(), p.id]),
  );
  function pagesHrefChange(pageUrl: string, briefId?: string): string {
    const pageId = urlToPageIdChanges.get(
      pageUrl.replace(/\/+$/, "").toLowerCase(),
    );
    if (!pageId) return "/pages";
    return briefId ? `/pages?p=${pageId}&b=${briefId}` : `/pages?p=${pageId}`;
  }

  const activeExperimentRecIdSetChanges = new Set(
    getActiveExperiments().map((e) => e.recId),
  );
  const repImpactCards = buildReplicationCards({
    recommendations: recommendationsFiltered,
    impactRows: rows,
    patterns,
    rolloutExecutions,
    pageIssues,
    activeExperimentRecIds: activeExperimentRecIdSetChanges,
  });
  const repExcludeRecIds = new Set(
    repImpactCards.flatMap((c) => c.targets.map((t) => t.recId)),
  );
  const repPromisingCards = buildPromisingReplicationCards(
    getActiveExperiments(),
    allRecs,
    rows,
    patterns,
    rolloutExecutions,
    pageIssues,
    repExcludeRecIds,
  );
  const repAllCards = [...repImpactCards, ...repPromisingCards];
  const serializedReplicationCards = serializeReplicationCards(
    repAllCards,
    allRecs,
    (u) => pagesHrefChange(u),
    citMap,
  );

  const decayAlertsChanges = getDecayAlerts(decayResultsChanges);
  const geoGapChanges = computeGeoCoverage(
    allPages,
    citationEvidenceIndex?.by_page_and_topic ?? [],
    getActivePrompts(),
  ).gaps[0];
  const localSurfaceChanges = computeLocalOperatorSurface({
    business: getBusinessConfig(),
    importRow: loadLocalOperatorImport(),
    geoGap: geoGapChanges
      ? {
          city: geoGapChanges.city,
          competitor_pages: geoGapChanges.competitor_pages,
          owned_pages: geoGapChanges.owned_pages,
        }
      : null,
    meaningfulDecayCount: decayAlertsChanges.filter(
      (d) => d.status === "meaningful_decline",
    ).length,
  });

  const replicateContent = (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Tier 1B replication: validated or high-confidence partial winners, plus promising
          experiments, become grouped targets. Observed rows are scorecard + citations; inferred
          rows are pattern and HTML similarity — not guaranteed outcomes.
        </p>
      </div>
      {serializedReplicationCards.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No replication queue right now — import fresh results and lock a few validated changes
          first.
        </p>
      ) : (
        <ReplicationCardsClient
          cards={serializedReplicationCards}
          variant="changes"
          respondToRecommendation={respondToRecommendation}
          startExperimentAction={startExperimentAction}
        />
      )}
    </div>
  );

  const briefCountByPattern = new Map<string, number>();
  for (const b of briefs) {
    briefCountByPattern.set(b.patternId, (briefCountByPattern.get(b.patternId) ?? 0) + 1);
  }

  const changeIntel: Record<string, ChangeIntelEntry> = {};
  let beaconRecommendedCount = 0;
  let totalReplicationTargets = 0;

  for (const row of rows) {
    const match = wasChangeRecommended(row.change.id, trackRecord);

    let replicationCount = 0;
    let patternName: string | undefined;
    if (
      (row.verdict === "validated" || row.verdict === "partial") &&
      row.impact.direction === "positive"
    ) {
      const matchedPattern = matchChangeToPattern(row.change, patterns);
      if (matchedPattern) {
        replicationCount = briefCountByPattern.get(matchedPattern.id) ?? 0;
        patternName = matchedPattern.name;
      }
    }

    if (match || replicationCount > 0) {
      const entry: ChangeIntelEntry = {
        beaconRecommended: !!match,
        replicationCount,
      };
      if (match) {
        entry.matchConfidence = match.matchConfidence;
        entry.patternName = match.patternId
          .replace("pattern-", "")
          .replace(/-/g, " ");
      }
      if (replicationCount > 0 && patternName) {
        entry.patternName = entry.patternName ?? patternName;
      }
      changeIntel[row.change.id] = entry;
      if (match) beaconRecommendedCount++;
      totalReplicationTargets += replicationCount;
    }
  }

  const sortedContracts = [...changeContracts].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );

  // ── Attribution (Review) computation ──
  const EVENT_TYPE_LABELS: Record<OutcomeEventType, string> = {
    first_appearance: "Showed up",
    visibility_regained: "Came back",
    mention_surge: "Mentions spiked",
    visibility_lost: "Dropped off",
    mention_decline: "Mentions fell",
  };
  const EVENT_TYPE_COLORS: Record<OutcomeEventType, string> = {
    first_appearance: "text-status-success",
    visibility_regained: "text-accent-primary",
    mention_surge: "text-status-warning",
    visibility_lost: "text-status-danger",
    mention_decline: "text-status-danger",
  };

  const { attribution: attrResults } = partitionResultsByMode(results);
  const attrEvents = detectOutcomeEvents(attrResults);
  const resultMap = new Map(results.map((r) => [r.id, r]));
  const decidedEventIds = new Set(eventDecisions.map((d) => d.event_id));

  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  const reviewItems: ReviewQueueItem[] = [];

  for (const event of attrEvents) {
    if (decidedEventIds.has(event.id)) continue;
    const anchorResult = resultMap.get(event.anchor_result_id);
    if (!anchorResult) continue;
    const candidates = discoverCandidates(anchorResult, changelogEntries, opportunities);
    candCountMap.set(event.anchor_result_id, candidates.length);
    if (candidates.length === 0) continue;
    const triage = triageCandidates(candidates);
    triageMap.set(event.anchor_result_id, triage);
    if (triage.autoResolved) continue;
    if (triage.needsReview.length === 0) continue;
    const allTriaged = [
      ...(triage.primary ? [triage.primary] : []),
      ...triage.contributing, ...triage.needsReview, ...triage.suppressed,
    ];
    const serializedCandidates = allTriaged.map((c) => ({
      change: { id: c.change.id, asset_name: c.change.asset_name, signal_type: c.change.signal_type, timestamp: c.change.timestamp, topic_targeted: c.change.topic_targeted, change_description: c.change.change_description },
      attribution: c.attribution, score: c.score, triage: c.triage, triageReason: c.triageReason,
    }));
    const platformLabel = PLATFORM_LABELS[event.platform] ?? event.platform;
    const judgment = buildJudgment(event.topic, platformLabel, event.type, event.trigger_date, anchorResult.metric_value, anchorResult.delta_percentage, event.context.cited, event.context.mentions_before, event.context.mentions_after, event.context.gap_days, triage.primary, triage.needsReview, triage.contributing, triage.suppressed, candidates.length);
    const base = {
      eventId: event.id, anchorResultId: event.anchor_result_id, eventType: event.type,
      eventTypeLabel: EVENT_TYPE_LABELS[event.type], eventTypeColor: EVENT_TYPE_COLORS[event.type],
      platform: platformLabel, topic: event.topic, triggerDate: event.trigger_date,
      description: event.description, reviewCount: triage.needsReview.length,
      totalCandidates: candidates.length, hasPrimary: triage.primary !== null,
      candidates: serializedCandidates, truthLabelMap: {} as Record<string, "causal" | "contributing" | "unrelated" | "unknown">,
      metricLabel: METRIC_TYPE_LABELS[anchorResult.metric_type], metricValue: anchorResult.metric_value,
      delta: anchorResult.delta_percentage, judgment,
    };
    const actionable = base.candidates.filter((c) => c.triage === "primary" || c.triage === "needs_review" || c.triage === "contributing");
    let d: Decisionability = "ambiguous";
    let reason = "Close scores";
    let gap = 0;
    if (actionable.length > 0) {
      const sorted = [...actionable].sort((a, b) => b.score - a.score);
      gap = sorted.length > 1 ? Math.round(sorted[0].score - sorted[1].score) : sorted[0].score;
      const topTier = sorted[0].attribution.evidence_tier;
      const hasStrong = topTier === "exact" || topTier === "probable";
      if (base.hasPrimary && gap >= 10) { d = "easy_call"; reason = "Clear primary candidate"; }
      else if (gap >= 15) { d = "easy_call"; reason = `Leading by ~${gap} pts`; }
      else if (gap >= 5 || actionable.length === 1) { d = "good_candidate"; reason = hasStrong ? "Strong evidence" : "Some separation"; }
    }
    reviewItems.push({ ...base, decisionability: d, decisionabilityReason: reason, scoreGap: gap });
  }
  reviewItems.sort((a, b) => {
    const order: Record<Decisionability, number> = { easy_call: 0, good_candidate: 1, ambiguous: 2 };
    return (order[a.decisionability] - order[b.decisionability]) || (b.scoreGap - a.scoreGap);
  });

  const resolved = resolveEvents(attrEvents, candidateLinks, triageMap, candCountMap);
  const intel = computeEventIntelligence(resolved);
  const resolvedItems: ResolvedItem[] = resolved
    .filter((r) => r.status === "attributed" || r.status === "auto_resolved")
    .map((r) => {
      const change = r.primary_change_id ? changelogEntries.find((c) => c.id === r.primary_change_id) : null;
      const decision = eventDecisions.find((d) => d.event_id === r.event.id);
      return { eventId: r.event.id, anchorResultId: r.event.anchor_result_id, eventTypeLabel: EVENT_TYPE_LABELS[r.event.type], eventTypeColor: EVENT_TYPE_COLORS[r.event.type], topic: r.event.topic, status: r.status, changeName: change?.asset_name ?? null, causeType: decision?.cause_type ?? null, operatorConfidence: decision?.operator_confidence ?? null };
    });
  const decidedNoChangeItems: ResolvedItem[] = eventDecisions
    .filter((dd) => dd.cause_type !== "change")
    .filter((dd) => !resolvedItems.some((r) => r.eventId === dd.event_id))
    .map((dd) => {
      const event = attrEvents.find((e) => e.id === dd.event_id);
      return { eventId: dd.event_id, anchorResultId: dd.result_id, eventTypeLabel: event ? EVENT_TYPE_LABELS[event.type] : "—", eventTypeColor: event ? EVENT_TYPE_COLORS[event.type] : "", topic: event?.topic ?? "—", status: "decided", changeName: null, causeType: dd.cause_type, operatorConfidence: dd.operator_confidence };
    });
  const allResolved = [...resolvedItems, ...decidedNoChangeItems];
  const easyCallCount = reviewItems.filter((i) => i.decisionability === "easy_call").length;
  const noCandidateCount = resolved.filter((r) => r.status === "pending" && !triageMap.has(r.event.anchor_result_id)).length;

  const attributionContent = (
    <div>
      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">At a glance</p>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
          <span><span className="font-bold tabular-nums">{reviewItems.length}</span><span className="text-muted-foreground ml-1.5">awaiting decision</span></span>
          {easyCallCount > 0 && <span className="text-status-success font-medium tabular-nums">{easyCallCount} likely quick decision{easyCallCount !== 1 ? "s" : ""}</span>}
          <span className="text-muted-foreground text-[13px]"><span className="font-semibold text-foreground tabular-nums">{eventDecisions.length}</span> locked total</span>
        </div>
      </div>
      <InlineReviewQueue
        items={reviewItems}
        resolvedItems={allResolved}
        stats={{ pending: reviewItems.length, noCandidates: noCandidateCount, confirmed: intel.attributed, autoResolved: intel.auto_resolved, decided: eventDecisions.length, easyCalls: easyCallCount }}
      />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Changes"
        description="What worked. What to scale. Why visibility moved."
      />

      <Suspense fallback={null}>
      <ChangesTabShell
        replicateContent={replicateContent}
        outcomesContent={
          <>
            {/* Impact snapshot — leads the page */}
      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">At a glance</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="font-bold tabular-nums">{rows.length}</span>
            <span className="text-muted-foreground ml-1.5">changes</span>
          </span>
          {withEvents > 0 && (
            <span>
              <span className="font-semibold tabular-nums">{withEvents}</span>
              <span className="text-muted-foreground ml-1.5">with visibility signal</span>
            </span>
          )}
          {highConfidence > 0 && (
            <span className="text-status-success font-semibold tabular-nums">
              {highConfidence} high-confidence impact
            </span>
          )}
          {operatorConfirmed > 0 && (
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{operatorConfirmed}</span> confirmed in Review
            </span>
          )}
          {beaconRecommendedCount > 0 && (
            <span className="text-accent-primary font-medium tabular-nums">
              {beaconRecommendedCount} Beacon-highlighted
            </span>
          )}
          {totalReplicationTargets > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {totalReplicationTargets} replication targets
            </span>
          )}
        </div>
        {localSurfaceChanges.changesOutcomesHook && (
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed border-l-2 border-accent-primary/30 pl-3">
            <span className="font-medium text-foreground">Local &amp; reviews: </span>
            {localSurfaceChanges.changesOutcomesHook.text}{" "}
            <Link
              href={localSurfaceChanges.changesOutcomesHook.href}
              className="text-accent-primary hover:underline font-medium"
            >
              Market →
            </Link>
          </p>
        )}
      </div>

      {milestoneState.events.length > 0 && (
        <div className="mb-6 rounded-lg border border-border/55 bg-surface-inset/20 px-4 py-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Milestones
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 mb-3 leading-relaxed">
            All-time highs and first-time outcomes from measured visibility. Each line is logged once when the bar moves — not on every page load.
          </p>
          <ul className="space-y-3">
            {milestoneState.events.slice(0, 20).map((e) => (
              <li
                key={e.id}
                className="text-[11px] border-l-2 border-accent-primary/20 pl-3"
              >
                <p className="font-semibold text-foreground">{e.title}</p>
                <p className="text-muted-foreground mt-0.5">{e.subtitle}</p>
                <p className="text-[10px] text-muted-foreground/90 mt-1 leading-relaxed">
                  {e.proofSummary}
                </p>
                <p className="text-[9px] text-muted-foreground mt-1 tabular-nums">
                  {new Date(e.achievedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ScorecardTable
        rows={rows}
        allTopics={allTopics}
        allPlatforms={allPlatforms}
        changeIntel={changeIntel}
      />

      {/* Experiments / watchlist */}
      {(() => {
        const experiments = getActiveExperiments().filter((e) => e.status !== "dropped");
        if (experiments.length === 0) return null;
        return (
          <div className="mt-8 border-t border-border/50 pt-6">
            <h2 className="text-sm font-semibold text-foreground mb-1">Active experiments</h2>
            <p className="text-[11px] text-muted-foreground mb-3">
              Recommendations you accepted and are tracking for citation impact.
            </p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/40 overflow-hidden">
              {experiments.map((exp) => {
                const days = Math.floor((Date.now() - new Date(exp.startedAt).getTime()) / 86_400_000);
                const delta = exp.baselineCitations !== null && exp.latestCitations !== null
                  ? exp.latestCitations - exp.baselineCitations
                  : null;
                return (
                  <div key={exp.id} className="px-4 py-3 hover:bg-surface-inset/20 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold truncate">{exp.headline}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Day {days + 1} · {exp.recType.replace(/_/g, " ")}
                          {exp.targetPagePath && <span className="ml-1 font-mono">{exp.targetPagePath}</span>}
                        </p>
                        {(exp.replicationSourceChangeId || exp.replicationPatternId) && (
                          <p className="text-[9px] text-muted-foreground/85 mt-1">
                            Replication lineage
                            {exp.replicationEvidenceTier && (
                              <span className="ml-1">· {exp.replicationEvidenceTier}</span>
                            )}
                            {exp.replicationSourceChangeId && (
                              <>
                                {" · "}
                                <Link
                                  href={`/changes/${encodeURIComponent(exp.replicationSourceChangeId)}`}
                                  className="text-accent-primary hover:underline font-medium"
                                >
                                  winner change
                                </Link>
                              </>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {delta !== null && (
                          <span className={`text-[11px] font-semibold tabular-nums ${delta > 0 ? "text-status-success" : delta < 0 ? "text-status-danger" : "text-muted-foreground"}`}>
                            {delta > 0 ? "+" : ""}{delta} cit
                          </span>
                        )}
                        <span className={`text-[9px] font-medium rounded-full px-2 py-0.5 border ${
                          exp.status === "promising" ? "text-status-success bg-status-success/10 border-status-success/30"
                          : exp.status === "negative" ? "text-status-danger bg-status-danger/10 border-status-danger/30"
                          : "text-muted-foreground bg-surface-inset/60 border-border/40"
                        }`}>
                          {exp.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Momentum / track record */}
      {trackRecord.totalActedOn > 0 && (
        <div className="mt-6 rounded-lg border border-border/40 px-4 py-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Momentum</p>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px]">
            <span><span className="font-bold text-foreground tabular-nums">{trackRecord.totalActedOn}</span> acted on</span>
            <span><span className="font-bold text-foreground tabular-nums">{trackRecord.totalValidated}</span> confirmed positive</span>
            {trackRecord.overallSuccessRate > 0 && (
              <span className="text-status-success font-semibold tabular-nums">{Math.round(trackRecord.overallSuccessRate * 100)}% success rate</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-10 border-t border-border/50 pt-8">
        <p className="text-xs font-medium text-muted-foreground mb-4">Records &amp; verification</p>
        <ChangeContractUI
          contracts={sortedContracts}
          onCreateContract={createChangeContract}
          onVerifyContract={verifyChangeContract}
        />
      </div>
          </>
        }
        attributionContent={attributionContent}
      />
      </Suspense>
    </div>
  );
}
