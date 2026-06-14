import {
  getResults,
  getChangelogEntries,
  getOpportunities,
} from "@/lib/seed-data.server";
import { discoverCandidates, warmPageRegistry } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import type { OutcomeEventType } from "@/domains/attribution/events";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { getCandidateLinks, getEventDecisions } from "@/domains/attribution/store";
import { buildJudgment } from "@/domains/attribution/judgment";
import { PLATFORM_LABELS, METRIC_TYPE_LABELS } from "@/lib/constants";
import {
  InlineReviewQueue,
  type ReviewQueueItem,
  type ResolvedItem,
  type Decisionability,
} from "./review-queue-client";
import { PageHeader } from "@/components/data/page-header";

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

function computeDecisionability(
  item: Omit<ReviewQueueItem, "decisionability" | "decisionabilityReason" | "scoreGap">
): { d: Decisionability; reason: string; gap: number } {
  const actionable = item.candidates.filter(
    (c) => c.triage === "primary" || c.triage === "needs_review" || c.triage === "contributing"
  );

  if (actionable.length === 0) {
    return { d: "ambiguous", reason: "No actionable candidates", gap: 0 };
  }

  const sorted = [...actionable].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted.length > 1 ? sorted[1] : null;
  const gap = second ? Math.round(top.score - second.score) : top.score;

  // Evidence tier quality
  const topTier = top.attribution.evidence_tier;
  const hasStrongEvidence = topTier === "exact" || topTier === "probable";

  // Topic match quality
  const topicStrong = top.attribution.matches.topic === "strong";

  // Has primary = system already has a clear pick
  if (item.hasPrimary) {
    if (gap >= 15 && hasStrongEvidence) {
      return { d: "easy_call", reason: "System primary + wider heuristic gap", gap };
    }
    if (gap >= 10) {
      return { d: "easy_call", reason: "System primary with a wider score gap", gap };
    }
    return { d: "good_candidate", reason: "System primary but close alternatives", gap };
  }

  if (gap >= 20 && hasStrongEvidence && topicStrong) {
    return { d: "easy_call", reason: "Wider gap with aligned heuristic signals", gap };
  }
  if (gap >= 15) {
    return { d: "easy_call", reason: `Leading candidate ahead by ~${gap} score points`, gap };
  }
  if (gap >= 8 && (hasStrongEvidence || topicStrong)) {
    return { d: "good_candidate", reason: "Moderate gap with some supporting signals", gap };
  }
  if (gap >= 5) {
    return { d: "good_candidate", reason: "Some separation between candidates", gap };
  }
  if (actionable.length === 1) {
    return { d: "good_candidate", reason: "Only one viable candidate", gap };
  }
  return { d: "ambiguous", reason: "Close scores, hard to differentiate", gap };
}

const DECISIONABILITY_ORDER: Record<Decisionability, number> = {
  easy_call: 0,
  good_candidate: 1,
  ambiguous: 2,
};

export default async function ReviewPage() {
  await warmPageRegistry();
  const [results, changelogEntries, opportunities, candidateLinks, eventDecisions] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getCandidateLinks(),
    getEventDecisions(),
  ]);
  const { attribution } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attribution);
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const decidedEventIds = new Set(eventDecisions.map((d) => d.event_id));

  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  const items: ReviewQueueItem[] = [];

  for (const event of events) {
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
      ...triage.contributing,
      ...triage.needsReview,
      ...triage.suppressed,
    ];

    const serializedCandidates = allTriaged.map((c) => ({
      change: {
        id: c.change.id,
        asset_name: c.change.asset_name,
        signal_type: c.change.signal_type,
        timestamp: c.change.timestamp,
        topic_targeted: c.change.topic_targeted,
        change_description: c.change.change_description,
      },
      attribution: c.attribution,
      score: c.score,
      triage: c.triage,
      triageReason: c.triageReason,
    }));

    const tlMap: Record<string, "causal" | "contributing" | "unrelated" | "unknown"> = {};

    const platformLabel = PLATFORM_LABELS[event.platform] ?? event.platform;

    const judgment = buildJudgment(
      event.topic,
      platformLabel,
      event.type,
      event.trigger_date,
      anchorResult.metric_value,
      anchorResult.delta_percentage,
      event.context.cited,
      event.context.mentions_before,
      event.context.mentions_after,
      event.context.gap_days,
      triage.primary,
      triage.needsReview,
      triage.contributing,
      triage.suppressed,
      candidates.length
    );

    const base = {
      eventId: event.id,
      anchorResultId: event.anchor_result_id,
      eventType: event.type,
      eventTypeLabel: EVENT_TYPE_LABELS[event.type],
      eventTypeColor: EVENT_TYPE_COLORS[event.type],
      platform: platformLabel,
      topic: event.topic,
      triggerDate: event.trigger_date,
      description: event.description,
      reviewCount: triage.needsReview.length,
      totalCandidates: candidates.length,
      hasPrimary: triage.primary !== null,
      candidates: serializedCandidates,
      truthLabelMap: tlMap,
      metricLabel: METRIC_TYPE_LABELS[anchorResult.metric_type],
      metricValue: anchorResult.metric_value,
      delta: anchorResult.delta_percentage,
      judgment,
    };

    const { d, reason, gap } = computeDecisionability(base);

    items.push({
      ...base,
      decisionability: d,
      decisionabilityReason: reason,
      scoreGap: gap,
    });
  }

  // Sort by decisionability (easy first), then by score gap descending
  items.sort((a, b) => {
    const dCmp =
      DECISIONABILITY_ORDER[a.decisionability] -
      DECISIONABILITY_ORDER[b.decisionability];
    if (dCmp !== 0) return dCmp;
    return b.scoreGap - a.scoreGap;
  });

  const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
  const intel = computeEventIntelligence(resolved);

  const resolvedItems: ResolvedItem[] = resolved
    .filter((r) => r.status === "attributed" || r.status === "auto_resolved")
    .map((r) => {
      const change = r.primary_change_id
        ? changelogEntries.find((c) => c.id === r.primary_change_id)
        : null;
      const decision = eventDecisions.find((d) => d.event_id === r.event.id);
      return {
        eventId: r.event.id,
        anchorResultId: r.event.anchor_result_id,
        eventTypeLabel: EVENT_TYPE_LABELS[r.event.type],
        eventTypeColor: EVENT_TYPE_COLORS[r.event.type],
        topic: r.event.topic,
        status: r.status,
        changeName: change?.asset_name ?? null,
        causeType: decision?.cause_type ?? null,
        operatorConfidence: decision?.operator_confidence ?? null,
      };
    });

  const decidedNoChangeItems: ResolvedItem[] = eventDecisions
    .filter((d) => d.cause_type !== "change")
    .filter((d) => !resolvedItems.some((r) => r.eventId === d.event_id))
    .map((d) => {
      const event = events.find((e) => e.id === d.event_id);
      return {
        eventId: d.event_id,
        anchorResultId: d.result_id,
        eventTypeLabel: event ? EVENT_TYPE_LABELS[event.type] : "—",
        eventTypeColor: event ? EVENT_TYPE_COLORS[event.type] : "",
        topic: event?.topic ?? "—",
        status: "decided",
        changeName: null,
        causeType: d.cause_type,
        operatorConfidence: d.operator_confidence,
      };
    });

  const allResolved = [...resolvedItems, ...decidedNoChangeItems];

  const noCandidateCount = resolved.filter(
    (r) => r.status === "pending" && !triageMap.has(r.event.anchor_result_id)
  ).length;

  const easyCallCount = items.filter((i) => i.decisionability === "easy_call").length;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Review"
        description="Why did your Google Search + AI visibility change? Lock a cause for each shift in clicks, impressions, and citations."
      />

      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">At a glance</p>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
          <span>
            <span className="font-bold tabular-nums">{items.length}</span>
            <span className="text-muted-foreground ml-1.5">awaiting decision</span>
          </span>
          {easyCallCount > 0 && (
            <span className="text-status-success font-medium tabular-nums">
              {easyCallCount} likely quick decision{easyCallCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className="text-muted-foreground text-[13px]">
            <span className="font-semibold text-foreground tabular-nums">{eventDecisions.length}</span> locked total
          </span>
        </div>
      </div>

      <InlineReviewQueue
        items={items}
        resolvedItems={allResolved}
        stats={{
          pending: items.length,
          noCandidates: noCandidateCount,
          confirmed: intel.attributed,
          autoResolved: intel.auto_resolved,
          decided: eventDecisions.length,
          easyCalls: easyCallCount,
        }}
      />
    </div>
  );
}
