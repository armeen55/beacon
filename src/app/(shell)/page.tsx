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
import { stripSiteOrigin } from "@/lib/site-config";
import { buildTodaySummary, type TodayNextMove } from "@/lib/today-summary";
import { computeRecommendations } from "@/domains/product/recommendation-engine";
import { rankAndSelect } from "@/domains/product/priority-engine";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import { primaryVisibilityRunForResults } from "@/domains/observations/visibility-context";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { buildTodayCompetitorLine } from "@/domains/competitors/today-competitor-line";
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
    .slice(0, 5)
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
        ? "Observed · guardrail (ObservationRun on file)"
        : "Observed · guardrail (run not stamped — legacy)",
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
        "Suggested links are not causal proof — lock a cause only if you agree with the match.",
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

  const recommendations = computeRecommendations({
    impactRows,
    patterns,
    briefs: playbookBriefs,
  });

  const briefPatternCounts = new Map<string, number>();
  for (const b of playbookBriefs) {
    briefPatternCounts.set(
      b.patternId,
      (briefPatternCounts.get(b.patternId) ?? 0) + 1,
    );
  }

  const { primaryAction, secondary } = rankAndSelect({
    recommendations,
    impactRows,
    patterns,
    briefPatternCounts,
  });

  function recHref(r: { type: string; targetPageUrl: string | null; sourceChangeId: string | null }): string {
    if (r.type === "replicate" && r.targetPageUrl) return pagesHref(r.targetPageUrl);
    if (r.sourceChangeId) return `/changes/${r.sourceChangeId}`;
    return "/pages";
  }

  const serializedPrimary = primaryAction
    ? {
        headline: primaryAction.headline,
        rationale: primaryAction.rationale,
        expectedOutcome: primaryAction.expectedOutcome,
        sourceEvidence: primaryAction.sourceEvidence,
        priorityScore: primaryAction.priorityScore,
        bucket: primaryAction.bucket as "critical" | "high_leverage" | "opportunistic",
        type: primaryAction.type,
        confidence: primaryAction.confidence,
        href: recHref(primaryAction),
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
        "When the fix ships, mark shipped and run verification from Website.",
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
        "Guardrail output from website crawl observation — not a ranking prediction.",
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
        "Ship verification runs a live HTML fetch and stamps a dedicated `website_verify` ObservationRun on the snapshot — not the same as the last bulk crawl.",
      observationRunId: activeCrawlId,
      evidenceScope: "mixed",
    });
  }
  if (newIssues.length > 0) {
    nextCandidates.push({
      title: `Triage ${newIssues.length} open Website issue${newIssues.length !== 1 ? "s" : ""}`,
      href: "/pages",
      evidence:
        "Issues mix crawl-backed guardrails with playbook inference — each Website row labels observed vs inferred.",
      observationRunId: activeCrawlId,
      evidenceScope: "mixed",
    });
  }
  if (undecidedCount > 0) {
    nextCandidates.push({
      title: "Work the Review queue (hypothesis locks)",
      href: "/review",
      evidence:
        "Review stores your best guess at cause for an imported visibility shift — not an ObservationRun and not causal proof.",
      observationRunId: null,
      evidenceScope: "review_heuristic",
    });
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
        items={enrichedItems}
        impactSignals={actionableImpact}
        recommendedMoves={topRecs}
        primaryAction={serializedPrimary}
        onUpdateIssue={
          updateIssueStatus as (
            issueId: string,
            status: string,
            meta?: { pageUrl?: string; pagePath?: string }
          ) => Promise<{ success: boolean }>
        }
        onVerifyIssue={verifyAndUpdateIssue}
      />

      {enrichedItems.length === 0 && (
        <p className="text-[11px] text-muted-foreground mt-4">
          Advanced sample history lives under{" "}
          <Link href="/results" className="text-accent-primary hover:underline">
            Sample history
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
