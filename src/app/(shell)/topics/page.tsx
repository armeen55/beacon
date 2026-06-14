import Link from "next/link";
import {
  getResults,
  getChangelogEntries,
  getOpportunities,
} from "@/lib/seed-data.server";
import { getEventDecisions } from "@/domains/attribution/store";
import {
  computeScorecard,
  type ScorecardRow,
  type TrustSource,
} from "@/domains/attribution/scorecard";
import { detectOutcomeEvents, type OutcomeEvent } from "@/domains/attribution/events";
import { discoverCandidates, warmPageRegistry } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { TopicsClient, type TopicRow, type TopicEvent, type TopicChange } from "./topics-client";
import type { CitationEvidenceIndex, PageSnapshot } from "@/domains/pages/types";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import { getRolloutExecutions, getPatternEvidence, getPageIssues } from "@/domains/pages/issues";
import { getRolloutWaves } from "@/domains/pages/wave-planner";
import { computeFrontiers, type FrontierOpportunity } from "@/domains/pages/frontier-planner";
import {
  compileFrontierAttack, getAttackPackages, getTrackedMissingPages,
  computePackageProgress, derivePackageStatus,
  type FrontierAttackPackage, type MissingPagePlan,
} from "@/domains/pages/frontier-compiler";
import { getCompetitorEvidence, SOURCE_TYPE_LABELS, type FrontierCompetitiveSummary } from "@/domains/pages/competitor-evidence";
import { computeAllAssetResponses, getAssetResponsesMap, ASSET_TYPE_LABELS, CONFIDENCE_LABELS, type AssetResponse } from "@/domains/pages/asset-response";
import { refreshCompetitorEvidence } from "./package-actions";
import { launchAttackPackage, updatePackageStatus, updateMissingPageStatus } from "./package-actions";
import { getSiteConfig } from "@/lib/site-config";
import { PageHeader } from "@/components/data/page-header";
import { EvidenceFreshnessBanner } from "@/components/shell/evidence-freshness-banner";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import { citationRollupVisibilityRun } from "@/domains/observations/visibility-read";
import { visibilitySampleStaleVsCrawl } from "@/domains/observations/staleness";
import { primaryVisibilityRunForResults } from "@/domains/observations/visibility-context";
import {
  loadCompetitorUniverseRuntime,
  competitorUniverseForGapLedger,
} from "@/domains/competitors/universe-read";

type TopicStatus = "breakthrough" | "building" | "unresolved" | "stalled";
type NextMove =
  | "review_easy_calls"
  | "review_unresolved"
  | "double_down"
  | "inspect_weak"
  | "push_supporting"
  | "too_early";

export default async function TopicsPage() {
  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
  const repo = getRepository().forTenant(await currentTenantId());
  const topicSnapshots = await repo.getPageSnapshots();
  await warmPageRegistry();
  const [results, changelogEntries, opportunities, eventDecisions, rolloutExecutions, patternEvidence, pageIssues, rolloutWaves, attackPackages, trackedMissingPages, citationEvidenceIndex] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getEventDecisions(),
    getRolloutExecutions(),
    getPatternEvidence(),
    getPageIssues(),
    getRolloutWaves(),
    getAttackPackages(),
    getTrackedMissingPages(),
    getCitationEvidenceIndex(),
  ]);
  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const rows = computeScorecard(
    changelogEntries,
    results,
    opportunities,
    eventDecisions
  );

  const decidedEventIds = new Set(eventDecisions.map((d) => d.event_id));

  // ── Group events by topic ──
  const eventsByTopic = new Map<string, OutcomeEvent[]>();
  for (const e of events) {
    if (!eventsByTopic.has(e.topic)) eventsByTopic.set(e.topic, []);
    eventsByTopic.get(e.topic)!.push(e);
  }

  // ── Group scorecard rows by topic ──
  const changesByTopic = new Map<string, ScorecardRow[]>();
  for (const row of rows) {
    for (const t of row.topics) {
      if (!changesByTopic.has(t)) changesByTopic.set(t, []);
      changesByTopic.get(t)!.push(row);
    }
  }

  // ── All unique topics ──
  const allTopics = new Set<string>();
  for (const t of eventsByTopic.keys()) allTopics.add(t);
  for (const t of changesByTopic.keys()) allTopics.add(t);

  // ── Build topic rows ──
  const topicRows: TopicRow[] = [];

  for (const topic of allTopics) {
    const topicEvents = eventsByTopic.get(topic) ?? [];
    const topicChanges = changesByTopic.get(topic) ?? [];

    // Dedup changes (same change can appear via multiple events)
    const uniqueChanges = [
      ...new Map(topicChanges.map((r) => [r.change.id, r])).values(),
    ];

    // ── Platform breakdown ──
    const platformCounts: Record<string, number> = {};
    for (const e of topicEvents) {
      platformCounts[e.platform] = (platformCounts[e.platform] ?? 0) + 1;
    }
    const platforms = Object.entries(platformCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p);

    // ── Decision stats ──
    const decidedCount = topicEvents.filter((e) =>
      decidedEventIds.has(e.id)
    ).length;
    const autoCount = topicEvents.filter((e) => {
      if (decidedEventIds.has(e.id)) return false;
      const r = results.find((r2) => r2.id === e.anchor_result_id);
      if (!r) return false;
      const c = discoverCandidates(r, changelogEntries, opportunities);
      if (c.length === 0) return false;
      return triageCandidates(c).autoResolved;
    }).length;
    const unresolvedEventCount = topicEvents.length - decidedCount - autoCount;

    // ── Easy calls for this topic ──
    let easyCallCount = 0;
    for (const event of topicEvents) {
      if (decidedEventIds.has(event.id)) continue;
      const r = results.find((r2) => r2.id === event.anchor_result_id);
      if (!r) continue;
      const candidates = discoverCandidates(r, changelogEntries, opportunities);
      if (candidates.length === 0) continue;
      const triage = triageCandidates(candidates);
      if (triage.autoResolved || triage.needsReview.length === 0) continue;
      const actionable = [
        ...(triage.primary ? [triage.primary] : []),
        ...triage.contributing,
        ...triage.needsReview,
      ].sort((a, b) => b.score - a.score);
      const gap =
        actionable.length > 1
          ? Math.round(actionable[0].score - actionable[1].score)
          : actionable[0].score;
      if ((triage.primary && gap >= 10) || (!triage.primary && gap >= 15))
        easyCallCount++;
    }

    // ── Change stats ──
    const validatedCount = uniqueChanges.filter(
      (r) => r.verdict === "validated"
    ).length;
    const partialCount = uniqueChanges.filter(
      (r) => r.verdict === "partial"
    ).length;
    const operatorConfirmedCount = uniqueChanges.filter(
      (r) => r.operatorConfirmedCount > 0
    ).length;
    const bestChange = uniqueChanges
      .filter((r) => r.verdict === "validated" || r.verdict === "partial")
      .sort(
        (a, b) =>
          b.operatorConfirmedCount - a.operatorConfirmedCount ||
          (b.topScore ?? 0) - (a.topScore ?? 0)
      )[0];

    // ── Best trust source ──
    const trustRank: Record<TrustSource, number> = {
      operator_confirmed: 0,
      auto_cleared: 1,
      system_primary: 2,
      contributing: 3,
      candidate: 4,
      operator_rejected: 5,
    };
    let bestTrust: TrustSource | null = null;
    for (const r of uniqueChanges) {
      if (
        r.topTrust &&
        (bestTrust === null || trustRank[r.topTrust] < trustRank[bestTrust])
      ) {
        bestTrust = r.topTrust;
      }
    }

    // ── Recent movement: most recent event ──
    const sortedEvents = [...topicEvents].sort(
      (a, b) =>
        new Date(b.trigger_date).getTime() - new Date(a.trigger_date).getTime()
    );
    const recentEvent = sortedEvents[0] ?? null;

    // ── Compute topic status ──
    let status: TopicStatus;
    if (
      validatedCount >= 2 ||
      (validatedCount >= 1 && operatorConfirmedCount >= 1)
    ) {
      status = "breakthrough";
    } else if (validatedCount >= 1 || partialCount >= 2) {
      status = "building";
    } else if (topicEvents.length > 0 && unresolvedEventCount > 0) {
      status = "unresolved";
    } else if (topicEvents.length === 0) {
      status = "stalled";
    } else {
      status = "building";
    }

    // ── Compute next move ──
    let nextMove: NextMove;
    let nextMoveDetail: string;

    if (easyCallCount > 0) {
      nextMove = "review_easy_calls";
      nextMoveDetail = `${easyCallCount} clear match${easyCallCount !== 1 ? "es" : ""} in Review`;
    } else if (unresolvedEventCount > 3) {
      nextMove = "review_unresolved";
      nextMoveDetail = `${unresolvedEventCount} shifts still need a Review decision`;
    } else if (
      status === "breakthrough" &&
      bestChange &&
      validatedCount >= 1
    ) {
      nextMove = "double_down";
      nextMoveDetail = `"${bestChange.change.asset_name}" shows a strong signal — consider doubling down`;
    } else if (
      uniqueChanges.length > 0 &&
      validatedCount === 0 &&
      partialCount === 0
    ) {
      nextMove = "inspect_weak";
      nextMoveDetail = `${uniqueChanges.length} linked edits but no strong signal in the data yet`;
    } else if (unresolvedEventCount > 0) {
      nextMove = "review_unresolved";
      nextMoveDetail = `${unresolvedEventCount} shift${unresolvedEventCount !== 1 ? "s" : ""} waiting in Review`;
    } else if (topicEvents.length === 0) {
      nextMove = "too_early";
      nextMoveDetail = "No visibility shifts in the data yet";
    } else if (status === "building" && bestChange) {
      nextMove = "push_supporting";
      nextMoveDetail = `Tie more evidence to "${bestChange.change.asset_name}" in Review`;
    } else {
      nextMove = "too_early";
      nextMoveDetail = "Waiting for more data";
    }

    // ── Serialize events for client ──
    const serializedEvents: TopicEvent[] = sortedEvents.slice(0, 6).map((e) => ({
      id: e.id,
      type: e.type,
      platform: e.platform,
      triggerDate: e.trigger_date,
      anchorResultId: e.anchor_result_id,
      description: e.description,
      isDecided: decidedEventIds.has(e.id),
    }));

    // ── Serialize changes for client ──
    const serializedChanges: TopicChange[] = uniqueChanges
      .sort(
        (a, b) =>
          b.operatorConfirmedCount - a.operatorConfirmedCount ||
          (b.topScore ?? 0) - (a.topScore ?? 0)
      )
      .slice(0, 5)
      .map((r) => ({
        id: r.change.id,
        name: r.change.asset_name,
        verdict: r.verdict,
        topScore: r.topScore,
        topTrust: r.topTrust,
        eventsLinked: r.totalEventsLinked,
        operatorConfirmed: r.operatorConfirmedCount > 0,
      }));

    topicRows.push({
      topic,
      status,
      platforms,
      totalEvents: topicEvents.length,
      decidedEvents: decidedCount,
      autoEvents: autoCount,
      unresolvedEvents: unresolvedEventCount,
      easyCalls: easyCallCount,
      totalChanges: uniqueChanges.length,
      validatedChanges: validatedCount,
      partialChanges: partialCount,
      operatorConfirmed: operatorConfirmedCount,
      bestChangeName: bestChange?.change.asset_name ?? null,
      bestChangeId: bestChange?.change.id ?? null,
      bestTrust,
      recentEventDate: recentEvent?.trigger_date ?? null,
      recentEventType: recentEvent?.type ?? null,
      nextMove,
      nextMoveDetail,
      events: serializedEvents,
      changes: serializedChanges,
    });
  }

  // Sort: breakthrough first, then building, unresolved, stalled
  const statusOrder: Record<TopicStatus, number> = {
    breakthrough: 0,
    building: 1,
    unresolved: 2,
    stalled: 3,
  };
  topicRows.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      b.totalEvents - a.totalEvents
  );

  const unresolvedTopicCount = topicRows.filter(
    (t) => t.status === "unresolved"
  ).length;
  const totalEasyCalls = topicRows.reduce((s, t) => s + t.easyCalls, 0);
  const ownedBrandShort = getSiteConfig().ownedBrandShort;

  const latestCrawlRun = await latestWebsiteCrawlRun();
  const primaryVisForGap = await primaryVisibilityRunForResults(results);
  const citationLedgerForGap = citationEvidenceIndex;
  const { stale: visibilityStaleVsCrawl } = visibilitySampleStaleVsCrawl(
    await citationRollupVisibilityRun(),
    latestCrawlRun?.completed_at ?? null
  );
  const competitorRuntimeForGap = await loadCompetitorUniverseRuntime();
  const cuLedger = competitorUniverseForGapLedger(competitorRuntimeForGap);
  const gapLedgerContext = {
    websiteCrawlRunId: latestCrawlRun?.run_id ?? null,
    citationIndexLoaded: Boolean(citationLedgerForGap?.by_topic?.length),
    visibilityObservationRunId: primaryVisForGap?.run_id ?? null,
    visibilitySampleStaleVsCrawl: visibilityStaleVsCrawl,
    competitorUniverse: {
      ...cuLedger,
      visibilityRunUniverse_pin_status:
        primaryVisForGap?.competitor_universe_pin_status ?? null,
      visibilityRunUniverse_version:
        primaryVisForGap?.competitor_universe_version ?? null,
      visibilityRunUniverse_fingerprint:
        primaryVisForGap?.competitor_universe_fingerprint ?? null,
    },
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Opportunities"
        description="Pick a topic to see where you can win next — from Google Search demand, page scans, and AI citations. Detail panels stay optional."
      />

      {/* Commit 2 (2026-04-24): evidence-freshness honesty banner. Topic
          rankings + frontier opportunities below are built from the frozen
          citation_evidence_index. Native-poll integration pending. */}
      <EvidenceFreshnessBanner
        builtAt={citationEvidenceIndex?.built_at ?? null}
        label="Topic rankings"
        className="mb-6"
      />

      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">At a glance</p>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
          <span>
            <span className="font-bold tabular-nums">{topicRows.length}</span>
            <span className="text-muted-foreground ml-1.5">topics</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums">{events.length}</span>
            <span className="text-muted-foreground ml-1.5">visibility shifts in data</span>
          </span>
          {unresolvedTopicCount > 0 && (
            <span className="text-status-warning font-medium tabular-nums">
              {unresolvedTopicCount} with open Review work
            </span>
          )}
          {totalEasyCalls > 0 && (
            <span className="text-accent-primary font-medium tabular-nums">
              {totalEasyCalls} likely quick win{totalEasyCalls !== 1 ? "s" : ""} in Review
            </span>
          )}
        </div>
        <details className="group/corpus mt-4 border-t border-border/40 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/corpus:rotate-90">▶</span>
            Workspace &amp; competitor list context
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            {gapLedgerContext.competitorUniverse?.origin === "empty_import_mode" &&
            (gapLedgerContext.competitorUniverse?.activeConfiguredCount ?? 0) === 0
              ? "No competitor list in `.data/competitor-universe.json` yet — competitive-pressure lines use the imported sample only until you configure one."
              : gapLedgerContext.competitorUniverse?.origin === "demo_defaults_explicit"
                ? `Using ${gapLedgerContext.competitorUniverse?.activeConfiguredCount ?? 0} demo competitor entries from the workspace file.`
                : `Using ${gapLedgerContext.competitorUniverse?.activeConfiguredCount ?? 0} competitor(s) from your workspace file for labeled pressure.`}
          </p>
        </details>
      </div>

      <TopicsClient
        ownedBrandShort={ownedBrandShort}
        rows={topicRows}
        gapLedgerContext={gapLedgerContext}
        frontiers={await (async () => {
        const ci = citationEvidenceIndex;
        const snaps = topicSnapshots;
        if (!ci) return [];
        const citMap = new Map<string, number>();
        for (const r of ci.by_page_and_topic) {
          if (!r.is_owned) continue;
          const key = r.page_url.replace(/\/+$/, "").toLowerCase();
          citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
        }
        const patterns = minePatterns(snaps, citMap, rows, rolloutExecutions, patternEvidence);
        const briefs = generateBriefs(snaps, citMap, patterns);
        const compEvidence = await getCompetitorEvidence(ci);
        const frontiers0 = computeFrontiers(ci, snaps, briefs, rolloutWaves, patterns, compEvidence);
        const persistedAR = await getAssetResponsesMap();
        const arByTopic = persistedAR.size > 0
          ? persistedAR
          : new Map(computeAllAssetResponses(compEvidence, frontiers0).map(a => [a.topic, a]));
        const frontiers = computeFrontiers(ci, snaps, briefs, rolloutWaves, patterns, compEvidence, arByTopic);
        return frontiers.map(f => {
          const ar = arByTopic.get(f.topic);
          const ce = compEvidence.get(f.topic);
          const persisted = attackPackages.find((p) => p.frontierOpportunityId === f.frontierOpportunityId);
          const pkg = persisted ?? compileFrontierAttack(f, snaps, briefs, rolloutWaves, patterns, ar);
          const progress = computePackageProgress(pkg, pageIssues, rolloutWaves, trackedMissingPages);
          const derivedStatus = derivePackageStatus(pkg, progress);
          const pkgMissing = trackedMissingPages.filter((m) => m.frontierAttackPackageId === pkg.frontierAttackPackageId);
          return {
            id: f.frontierOpportunityId,
            frontierKey: f.frontierKey,
            topic: f.topic,
            type: f.frontierType,
            title: f.title,
            status: f.status,
            ownedShare: f.ownedShare,
            ownedPages: f.ownedPageCount,
            ownedPagesWithFaq: f.ownedPagesWithFaq,
            competitorCitations: f.competitorCitations,
            citationOpportunity: f.citationOpportunity,
            structuralOpportunity: f.structuralOpportunity,
            recommendedMove: f.recommendedMoveType,
            rationale: f.rationale,
            priorityScore: f.priorityScore,
            linkedBriefCount: f.linkedBriefIds.length,
            linkedWaveCount: f.linkedWaveIds.length,
            competitive: ce ? {
              ownedShare: ce.ownedShare,
              totalExternal: ce.totalExternalCitations,
              dominantSourceType: ce.dominantSourceType,
              insight: ce.competitiveInsight,
              responseType: ce.responseType,
              responseRationale: ce.responseRationale,
              coverageGaps: ce.coverageGaps,
              topCompetitors: ce.topCompetitors.slice(0, 5).map((c) => ({
                domain: c.domain,
                citations: c.citationCount,
                sourceType: c.sourceType,
                structural: c.structuralSignals,
              })),
              sourcePatterns: ce.sourcePatterns.slice(0, 5).map((s) => ({
                type: s.sourceType,
                share: s.citationShare,
                count: s.citationCount,
                domains: s.domains.slice(0, 3),
              })),
            } : null,
            assetResponse: ar ? {
              recommendedAssetType: ar.recommendedAssetType,
              confidenceLabel: ar.confidenceLabel,
              rationale: ar.rationale,
              ownedEquivalentExists: ar.ownedEquivalentExists,
              ownedEquivalentPages: ar.ownedEquivalentPages,
              missingAssetSignals: ar.missingAssetSignals,
              supportingSourcePatterns: ar.supportingSourcePatterns,
            } : null,
            attackPackage: {
              id: pkg.frontierAttackPackageId,
              title: pkg.title,
              status: derivedStatus,
              moveType: pkg.recommendedMoveType,
              pagesToRepair: pkg.pagesToRepair.map(p => p.replace(/^https?:\/\/[^/]+/, "")),
              pagesToCreate: pkg.pagesToCreate,
              internalLinkTargets: pkg.internalLinkTargets,
              comparisonTargets: pkg.comparisonTargets,
              executionSteps: pkg.executionSteps,
              verificationPlan: pkg.verificationPlan,
              rationale: pkg.rationale,
              priorityScore: pkg.priorityScore,
              linkedBriefCount: pkg.linkedBriefIds.length,
              linkedWaveCount: pkg.linkedWaveIds.length,
              notes: pkg.notes,
              isPersisted: !!persisted,
              progress,
              missingPages: pkgMissing.map((m) => ({
                id: m.missingPagePlanId,
                title: m.title,
                pageType: m.pageType,
                status: m.status,
                components: m.suggestedComponents.length,
              })),
            },
          };
        });
      })()
      }
      onLaunchPackage={async (frontierKey: string) => {
        "use server";
        // INTENTIONAL EXCEPTION: fresh disk read — avoids stale module-cached snapshots/citation index.
        const { readDotDataJson: rd } = await import("@/lib/persistence/dotdata-json");
        const ci2 = await rd<CitationEvidenceIndex>("citation-evidence-index");
        const snaps2 = (await rd<PageSnapshot[]>("page-snapshots")) ?? [];
        if (!ci2) return { success: false, handoffText: "" };
        const citMap2 = new Map<string, number>();
        for (const r of ci2.by_page_and_topic) { if (r.is_owned) citMap2.set(r.page_url.replace(/\/+$/, "").toLowerCase(), (citMap2.get(r.page_url.replace(/\/+$/, "").toLowerCase()) ?? 0) + r.total_citations); }
        const { minePatterns: mp2, generateBriefs: gb2 } = await import("@/domains/pages/playbook");
        const { getRolloutExecutions: gre2, getPatternEvidence: gpe2 } = await import("@/domains/pages/issues");
        const [re2, pe2] = await Promise.all([gre2(), gpe2()]);
        const patterns2 = mp2(snaps2, citMap2, rows, re2, pe2);
        const briefs2 = gb2(snaps2, citMap2, patterns2);
        const frontiers2 = computeFrontiers(ci2, snaps2, briefs2, rolloutWaves, patterns2);
        const frontier = frontiers2.find((f) => f.frontierKey === frontierKey);
        if (!frontier) return { success: false, handoffText: "" };
        const { compileFrontierAttack: cfa } = await import("@/domains/pages/frontier-compiler");
        const pkg = cfa(frontier, snaps2, briefs2, rolloutWaves, patterns2);
        return launchAttackPackage(pkg, briefs2);
      }}
      onDismissPackage={async (packageId: string) => {
        "use server";
        return updatePackageStatus(packageId, "dismissed");
      }}
      onUpdateMissingPage={updateMissingPageStatus}
      onRefreshEvidence={refreshCompetitorEvidence}
      />
    </div>
  );
}
