import { results, changelogEntries, opportunities } from "@/lib/seed-data.server";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import type { OutcomeEventType } from "@/domains/attribution/events";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { candidateLinks, eventDecisions } from "@/domains/attribution/store";
import { buildJudgment } from "@/domains/attribution/judgment";
import { PLATFORM_LABELS, METRIC_TYPE_LABELS } from "@/lib/constants";
import {
  InlineReviewQueue,
  type ReviewQueueItem,
  type ResolvedItem,
} from "./review-queue-client";

const EVENT_TYPE_LABELS: Record<OutcomeEventType, string> = {
  first_appearance: "Showed up",
  visibility_regained: "Came back",
  mention_surge: "Mentions spiked",
};

const EVENT_TYPE_COLORS: Record<OutcomeEventType, string> = {
  first_appearance: "text-status-success",
  visibility_regained: "text-accent-primary",
  mention_surge: "text-status-warning",
};

export default function ReviewPage() {
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

    items.push({
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
    });
  }

  items.sort((a, b) => b.reviewCount - a.reviewCount);

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

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h2 className="text-[16px] font-semibold tracking-tight">Review</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          For each move, make the call. What caused it?
        </p>
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
        }}
      />
    </div>
  );
}
