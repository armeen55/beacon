import {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitorSnapshots,
} from "@/lib/seed-data.server";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Attribution, AttributionConfidence } from "@/domains/attribution/types";
import { getStallStatus } from "@/domains/briefs/stall";
import type { StallLevel } from "@/domains/briefs/stall";
import { getFreshnessStatus } from "@/domains/opportunities/freshness";
import { computeOpportunityScore } from "@/domains/opportunities/scoring";
import {
  computeAttribution,
  computeChangeVerdict,
  computeBriefVerdict,
} from "@/domains/attribution/compute";
import { getBriefProgress } from "@/domains/briefs/utils";
import { getBriefsForOpportunity } from "@/lib/lookups";
import { METRIC_DIRECTION } from "@/lib/constants";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { resolveEvents, computeChangeLearning } from "@/domains/attribution/event-resolution";
import { candidateLinks } from "@/domains/attribution/store";

// ── Types ──

export type TriageUrgency = "critical" | "high" | "medium";

export type TriageItem = {
  id: string;
  entityType: "opportunity" | "brief";
  entityId: string;
  title: string;
  urgency: TriageUrgency;
  reason: string;
  action: string;
  href: string;
};

export type InMotionItem = {
  id: string;
  entityType: "brief" | "opportunity";
  entityId: string;
  title: string;
  href: string;
  status: string;
  progress: { done: number; total: number; percentage: number } | null;
  daysActive: number;
};

export type WinItem = {
  id: string;
  result: Result;
  change: ChangelogEntry | null;
  attribution: Attribution | null;
  headline: string;
  platform: string;
  explanation: string;
  confidence: AttributionConfidence | null;
};

export type RiskItem = {
  id: string;
  entityType: "result" | "change";
  entityId: string;
  title: string;
  href: string;
  reason: string;
  delta: number | null;
};

export type WaitingItem = {
  id: string;
  entityType: "change" | "brief" | "opportunity";
  entityId: string;
  title: string;
  href: string;
  detail: string;
};

export type LoopStage = {
  label: string;
  count: number;
  isBottleneck: boolean;
};

export type LoopHealth = {
  stages: LoopStage[];
  bottleneck: string | null;
};

export type NarrativeBannerData = {
  text: string;
  variant: "default" | "success" | "warning";
};

// ── Helpers ──

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function isPositiveDelta(r: Result): boolean {
  if (r.delta == null) return false;
  const dir = METRIC_DIRECTION[r.metric_type];
  return dir === "lower_is_better" ? r.delta < 0 : r.delta > 0;
}

function isNegativeDelta(r: Result): boolean {
  if (r.delta == null) return false;
  return !isPositiveDelta(r) && r.delta !== 0;
}

function parseImpactWindowDays(window: string | null): number {
  if (!window) return 14;
  const m = window.match(/(\d+)[\s-]*(\d+)?\s*(day|week|month)/i);
  if (!m) return 14;
  const upper = m[2] ? parseInt(m[2]) : parseInt(m[1]);
  const unit = m[3].toLowerCase();
  if (unit.startsWith("day")) return upper;
  if (unit.startsWith("week")) return upper * 7;
  if (unit.startsWith("month")) return upper * 30;
  return 14;
}

const URGENCY_ORDER: Record<TriageUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

// ── Compute: Needs Attention ──

export function computeNeedsAttention(
  now: Date = new Date()
): TriageItem[] {
  const items: TriageItem[] = [];

  for (const opp of opportunities) {
    if (
      opp.current_status === "captured" ||
      opp.current_status === "closed" ||
      opp.current_status === "deferred"
    )
      continue;

    if (opp.current_status === "regressed") {
      items.push({
        id: `triage-opp-regressed-${opp.id}`,
        entityType: "opportunity",
        entityId: opp.id,
        title: opp.title,
        urgency: "critical",
        reason: "Previously captured position has been lost",
        action: "Investigate regression and consider re-executing",
        href: `/opportunities/${opp.id}`,
      });
      continue;
    }

    const freshness = getFreshnessStatus(opp, now);
    if (freshness.level === "abandoned") {
      items.push({
        id: `triage-opp-abandoned-${opp.id}`,
        entityType: "opportunity",
        entityId: opp.id,
        title: opp.title,
        urgency: "critical",
        reason: freshness.message,
        action: "Close or defer this opportunity",
        href: `/opportunities/${opp.id}`,
      });
      continue;
    }
    if (freshness.level === "stale") {
      items.push({
        id: `triage-opp-stale-${opp.id}`,
        entityType: "opportunity",
        entityId: opp.id,
        title: opp.title,
        urgency: "high",
        reason: freshness.message,
        action: "Review and take action or defer",
        href: `/opportunities/${opp.id}`,
      });
      continue;
    }

    if (opp.current_status === "executing") {
      const linkedBriefs = getBriefsForOpportunity(opp.id);
      const hasActive = linkedBriefs.some((b) => b.status === "in_progress");
      if (!hasActive) {
        items.push({
          id: `triage-opp-nobrief-${opp.id}`,
          entityType: "opportunity",
          entityId: opp.id,
          title: opp.title,
          urgency: "high",
          reason: "Marked as executing but no active briefs",
          action: "Start a brief or update the opportunity status",
          href: `/opportunities/${opp.id}`,
        });
      }
      continue;
    }

    if (
      (opp.current_status === "new" || opp.current_status === "queued") &&
      opp.linked_brief_ids.length === 0
    ) {
      const linkedBriefs = getBriefsForOpportunity(opp.id);
      if (linkedBriefs.length === 0) {
        const score = computeOpportunityScore(
          opp,
          [],
          competitorSnapshots
        );
        if (score.total >= 50 || opp.priority === "critical") {
          items.push({
            id: `triage-opp-unplanned-${opp.id}`,
            entityType: "opportunity",
            entityId: opp.id,
            title: opp.title,
            urgency: opp.priority === "critical" ? "high" : "medium",
            reason: "High-value opportunity with no execution plan",
            action: "Create a brief to start planning",
            href: `/opportunities/${opp.id}`,
          });
        }
      }
    }
  }

  for (const brief of briefs) {
    if (brief.status === "completed") continue;
    const stall = getStallStatus(brief, now);
    if (stall.level === "critical") {
      items.push({
        id: `triage-brief-critical-${brief.id}`,
        entityType: "brief",
        entityId: brief.id,
        title: brief.title,
        urgency: "critical",
        reason: stall.reason,
        action: stall.recommended_action ?? "Take action on this brief",
        href: `/briefs/${brief.id}`,
      });
    } else if (stall.level === "stalled") {
      items.push({
        id: `triage-brief-stalled-${brief.id}`,
        entityType: "brief",
        entityId: brief.id,
        title: brief.title,
        urgency: "high",
        reason: stall.reason,
        action: stall.recommended_action ?? "Review this brief",
        href: `/briefs/${brief.id}`,
      });
    }
  }

  items.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);

  return items.slice(0, 4);
}

// ── Compute: In Motion ──

export function computeInMotion(now: Date = new Date()): InMotionItem[] {
  const items: InMotionItem[] = [];

  for (const brief of briefs) {
    if (brief.status !== "in_progress") continue;
    const stall = getStallStatus(brief, now);
    if (stall.level === "critical" || stall.level === "stalled") continue;

    const progress = getBriefProgress(brief.checklist);
    const startDate = brief.started_at
      ? new Date(brief.started_at)
      : new Date(brief.created_at);
    const daysActive = daysBetween(startDate, now);

    items.push({
      id: `motion-brief-${brief.id}`,
      entityType: "brief",
      entityId: brief.id,
      title: brief.title,
      href: `/briefs/${brief.id}`,
      status: brief.status,
      progress: {
        done: progress.done,
        total: progress.total,
        percentage: progress.percentage,
      },
      daysActive,
    });
  }

  for (const opp of opportunities) {
    if (
      opp.current_status !== "executing" &&
      opp.current_status !== "validating"
    )
      continue;

    const startDate = opp.activated_at
      ? new Date(opp.activated_at)
      : new Date(opp.created_at);
    const daysActive = daysBetween(startDate, now);

    items.push({
      id: `motion-opp-${opp.id}`,
      entityType: "opportunity",
      entityId: opp.id,
      title: opp.title,
      href: `/opportunities/${opp.id}`,
      status: opp.current_status,
      progress: null,
      daysActive,
    });
  }

  return items;
}

// ── Compute: Wins ──

export function computeWins(): WinItem[] {
  const wins: WinItem[] = [];

  for (const result of results) {
    if (!isPositiveDelta(result)) continue;

    const linkedChanges = changelogEntries.filter((c) =>
      result.attributed_changelog_ids.includes(c.id)
    );
    const primaryChange = linkedChanges[0] ?? null;

    let attribution: Attribution | null = null;
    if (primaryChange) {
      attribution = computeAttribution(primaryChange, result, opportunities);
    }

    const metricLabel = result.metric_type
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const delta = result.delta_percentage ?? result.delta ?? 0;
    const sign = delta > 0 ? "+" : "";
    const headline = `${metricLabel} ${sign}${Math.abs(delta).toFixed(1)}%`;

    const platformLabel = result.platform
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const explanation = primaryChange
      ? `Likely caused by ${primaryChange.asset_name}`
      : "No attributed change";

    wins.push({
      id: `win-${result.id}`,
      result,
      change: primaryChange,
      attribution,
      headline,
      platform: platformLabel,
      explanation,
      confidence: attribution?.confidence ?? null,
    });
  }

  wins.sort(
    (a, b) =>
      Math.abs(b.result.delta_percentage ?? 0) -
      Math.abs(a.result.delta_percentage ?? 0)
  );

  return wins.slice(0, 3);
}

// ── Compute: Risks ──

export function computeRisks(now: Date = new Date()): RiskItem[] {
  const items: RiskItem[] = [];

  for (const result of results) {
    if (!isNegativeDelta(result)) continue;
    const metricLabel = result.metric_type
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    items.push({
      id: `risk-result-${result.id}`,
      entityType: "result",
      entityId: result.id,
      title: `${metricLabel} declined`,
      href: `/results/${result.id}`,
      reason: result.topic
        ? `${result.topic} on ${result.platform.replace(/_/g, " ")}`
        : result.platform.replace(/_/g, " "),
      delta: result.delta_percentage,
    });
  }

  for (const change of changelogEntries) {
    const windowDays = parseImpactWindowDays(change.expected_impact_window);
    const changeDate = new Date(change.timestamp);
    const windowEnd = new Date(
      changeDate.getTime() + windowDays * 24 * 60 * 60 * 1000
    );
    if (now <= windowEnd) continue;

    const hasResults = results.some((r) =>
      r.attributed_changelog_ids.includes(change.id)
    );
    if (hasResults) {
      const verdict = computeChangeVerdict(change, results, opportunities);
      if (verdict.verdict === "no_impact") {
        items.push({
          id: `risk-noimapct-${change.id}`,
          entityType: "change",
          entityId: change.id,
          title: change.asset_name,
          href: `/changes/${change.id}`,
          reason: "Results show no positive impact",
          delta: null,
        });
      }
    } else {
      items.push({
        id: `risk-noevidence-${change.id}`,
        entityType: "change",
        entityId: change.id,
        title: change.asset_name,
        href: `/changes/${change.id}`,
        reason: `Impact window expired — no results detected`,
        delta: null,
      });
    }
  }

  return items.slice(0, 5);
}

// ── Compute: Waiting for Evidence ──

export function computeWaitingForEvidence(
  now: Date = new Date()
): WaitingItem[] {
  const items: WaitingItem[] = [];

  for (const change of changelogEntries) {
    const windowDays = parseImpactWindowDays(change.expected_impact_window);
    const changeDate = new Date(change.timestamp);
    const windowEnd = new Date(
      changeDate.getTime() + windowDays * 24 * 60 * 60 * 1000
    );

    if (now > windowEnd) continue;

    const hasPositiveResult = results.some(
      (r) =>
        r.attributed_changelog_ids.includes(change.id) && isPositiveDelta(r)
    );
    if (hasPositiveResult) continue;

    const daysRemaining = daysBetween(now, windowEnd);
    items.push({
      id: `wait-change-${change.id}`,
      entityType: "change",
      entityId: change.id,
      title: change.asset_name,
      href: `/changes/${change.id}`,
      detail: `${daysRemaining}d remaining in impact window`,
    });
  }

  for (const brief of briefs) {
    if (brief.status !== "completed") continue;
    const pending = brief.expected_outcomes.filter(
      (o) => o.verdict === "pending"
    );
    if (pending.length === 0) continue;
    items.push({
      id: `wait-brief-${brief.id}`,
      entityType: "brief",
      entityId: brief.id,
      title: brief.title,
      href: `/briefs/${brief.id}`,
      detail: `${pending.length} prediction${pending.length !== 1 ? "s" : ""} awaiting results`,
    });
  }

  for (const opp of opportunities) {
    if (opp.current_status !== "validating") continue;
    items.push({
      id: `wait-opp-${opp.id}`,
      entityType: "opportunity",
      entityId: opp.id,
      title: opp.title,
      href: `/opportunities/${opp.id}`,
      detail: "Validating — checking results",
    });
  }

  return items;
}

// ── Compute: Loop Health ──

export function computeLoopHealth(now: Date = new Date()): LoopHealth {
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const discoverCount = opportunities.filter(
    (o) => o.current_status === "new" || o.current_status === "queued"
  ).length;

  const planCount = briefs.filter(
    (b) => b.status === "draft" || b.status === "approved"
  ).length;

  const executeCount = briefs.filter(
    (b) => b.status === "in_progress"
  ).length;

  const measureCount = results.filter(
    (r) => new Date(r.snapshot_date) >= twoWeeksAgo
  ).length;

  const { attribution: attrResults } = partitionResultsByMode(results);
  const evts = detectOutcomeEvents(attrResults);
  const trMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const ccMap = new Map<string, number>();
  for (const ev of evts) {
    const anchor = results.find((r) => r.id === ev.anchor_result_id);
    if (!anchor) continue;
    const cands = discoverCandidates(anchor, changelogEntries, opportunities);
    ccMap.set(ev.anchor_result_id, cands.length);
    trMap.set(ev.anchor_result_id, triageCandidates(cands));
  }
  const resolvedEvts = resolveEvents(evts, candidateLinks, trMap, ccMap);
  const changeLearning = computeChangeLearning(resolvedEvts);
  const eventLearnIds = new Set(changeLearning.map((cl) => cl.change_id));

  const learnCount = changelogEntries.filter((c) => {
    if (eventLearnIds.has(c.id)) return true;
    const v = computeChangeVerdict(c, results, opportunities);
    return v.verdict === "validated" || v.verdict === "partial";
  }).length;

  const stages: LoopStage[] = [
    { label: "Discover", count: discoverCount, isBottleneck: false },
    { label: "Plan", count: planCount, isBottleneck: false },
    { label: "Execute", count: executeCount, isBottleneck: false },
    { label: "Measure", count: measureCount, isBottleneck: false },
    { label: "Learn", count: learnCount, isBottleneck: false },
  ];

  let bottleneck: string | null = null;
  for (let i = 0; i < stages.length - 1; i++) {
    const upstream = stages[i].count;
    const downstream = stages[i + 1].count;
    if (upstream > 2 * downstream && downstream < 3) {
      stages[i + 1].isBottleneck = true;
      if (!bottleneck) bottleneck = stages[i + 1].label;
    }
  }

  return { stages, bottleneck };
}

// ── Compute: Narrative Banner ──

export function computeNarrativeBanner(
  now: Date = new Date()
): NarrativeBannerData {
  const attention = computeNeedsAttention(now);
  const wins = computeWins();
  const inMotion = computeInMotion(now);

  const parts: string[] = [];

  if (attention.length > 0) {
    const critical = attention.filter((i) => i.urgency === "critical").length;
    if (critical > 0) {
      parts.push(
        `${critical} critical item${critical !== 1 ? "s" : ""} need${critical === 1 ? "s" : ""} attention`
      );
    } else {
      parts.push(
        `${attention.length} item${attention.length !== 1 ? "s" : ""} need${attention.length === 1 ? "s" : ""} attention`
      );
    }
  }

  if (inMotion.length > 0) {
    const briefCount = inMotion.filter(
      (i) => i.entityType === "brief"
    ).length;
    if (briefCount > 0) {
      parts.push(
        `${briefCount} brief${briefCount !== 1 ? "s" : ""} in progress`
      );
    }
  }

  if (wins.length > 0) {
    parts.push(wins[0].headline);
  }

  const hasCritical = attention.some((i) => i.urgency === "critical");
  const variant: NarrativeBannerData["variant"] = hasCritical
    ? "warning"
    : wins.length > 0
      ? "success"
      : "default";

  return {
    text:
      parts.length > 0 ? parts.join(". ") + "." : "All systems operating normally.",
    variant,
  };
}
