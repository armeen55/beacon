import type { OutcomeEvent } from "./events";
import type { CandidateLink, ChangeVerdict, ChangeVerdictData } from "./types";
import type { CandidateResult } from "./candidates";
import type { TriageSummary } from "./triage";
import type { ChangelogEntry } from "@/domains/changelog/types";

export type EventResolutionStatus =
  | "attributed"
  | "auto_resolved"
  | "no_cause"
  | "pending"
  | "no_candidates";

export type ResolvedEvent = {
  event: OutcomeEvent;
  status: EventResolutionStatus;
  primary_change_id: string | null;
  contributing_change_ids: string[];
  candidate_count: number;
};

export type ChangeLearning = {
  change_id: string;
  events_attributed: number;
  event_types: string[];
  topics: string[];
  earliest_event_date: string;
  latest_event_date: string;
};

/**
 * Compute resolution status for each event from existing CandidateLinks
 * and triage results. No new persistence — CandidateLinks ARE the persistence.
 */
export function resolveEvents(
  events: OutcomeEvent[],
  candidateLinks: CandidateLink[],
  triageResults: Map<string, TriageSummary>,
  candidateCounts: Map<string, number>
): ResolvedEvent[] {
  return events.map((event) => {
    const resultId = event.anchor_result_id;

    const links = candidateLinks.filter((cl) => cl.result_id === resultId);
    const confirmed = links.filter((cl) => cl.status === "confirmed");
    const rejected = links.filter((cl) => cl.status === "rejected");

    const triage = triageResults.get(resultId);
    const candCount = candidateCounts.get(resultId) ?? 0;

    if (candCount === 0) {
      return {
        event,
        status: "no_candidates" as const,
        primary_change_id: null,
        contributing_change_ids: [],
        candidate_count: 0,
      };
    }

    if (confirmed.length > 0) {
      return {
        event,
        status: "attributed" as const,
        primary_change_id: confirmed[0].change_id,
        contributing_change_ids: confirmed.slice(1).map((c) => c.change_id),
        candidate_count: candCount,
      };
    }

    if (triage?.autoResolved && triage.primary) {
      return {
        event,
        status: "auto_resolved" as const,
        primary_change_id: triage.primary.change.id,
        contributing_change_ids: triage.contributing.map((c) => c.change.id),
        candidate_count: candCount,
      };
    }

    if (rejected.length > 0 && rejected.length >= candCount) {
      return {
        event,
        status: "no_cause" as const,
        primary_change_id: null,
        contributing_change_ids: [],
        candidate_count: candCount,
      };
    }

    return {
      event,
      status: "pending" as const,
      primary_change_id: null,
      contributing_change_ids: [],
      candidate_count: candCount,
    };
  });
}

/**
 * Compute per-change learning from resolved events.
 * Answers "what worked?" by aggregating attribution evidence across events.
 */
export function computeChangeLearning(
  resolved: ResolvedEvent[]
): ChangeLearning[] {
  const changeMap = new Map<
    string,
    { events: ResolvedEvent[]; types: Set<string>; topics: Set<string> }
  >();

  for (const r of resolved) {
    if (r.status !== "attributed" && r.status !== "auto_resolved") continue;

    const changeIds = [
      r.primary_change_id,
      ...r.contributing_change_ids,
    ].filter((id): id is string => id !== null);

    for (const changeId of changeIds) {
      let entry = changeMap.get(changeId);
      if (!entry) {
        entry = { events: [], types: new Set(), topics: new Set() };
        changeMap.set(changeId, entry);
      }
      entry.events.push(r);
      entry.types.add(r.event.type);
      entry.topics.add(r.event.topic);
    }
  }

  const learnings: ChangeLearning[] = [];
  for (const [changeId, data] of changeMap) {
    const dates = data.events
      .map((e) => e.event.trigger_date)
      .sort();

    learnings.push({
      change_id: changeId,
      events_attributed: data.events.length,
      event_types: [...data.types],
      topics: [...data.topics],
      earliest_event_date: dates[0],
      latest_event_date: dates[dates.length - 1],
    });
  }

  return learnings.sort((a, b) => b.events_attributed - a.events_attributed);
}

/**
 * Compute event-aware change verdicts. When a change has been confirmed
 * as the primary cause of outcome events, that IS evidence of impact —
 * regardless of whether the raw result has a delta field.
 */
export function computeEventAwareChangeVerdict(
  change: ChangelogEntry,
  learning: ChangeLearning[]
): ChangeVerdictData {
  const entry = learning.find((l) => l.change_id === change.id);

  if (!entry) {
    return {
      verdict: "pending",
      attributions: [],
      summary: "No event evidence yet",
    };
  }

  const n = entry.events_attributed;
  const types = entry.event_types.map((t) => t.replace(/_/g, " ")).join(", ");

  let verdict: ChangeVerdict;
  let summary: string;

  if (n >= 3) {
    verdict = "validated";
    summary = `Confirmed across ${n} events (${types})`;
  } else if (n >= 1) {
    verdict = "partial";
    summary = `Confirmed for ${n} event${n !== 1 ? "s" : ""} (${types})`;
  } else {
    verdict = "inconclusive";
    summary = "Insufficient event evidence";
  }

  return { verdict, attributions: [], summary };
}

export type EventIntelligenceSummary = {
  total_events: number;
  attributed: number;
  auto_resolved: number;
  no_cause: number;
  pending: number;
  no_candidates: number;
  by_type: Record<string, { total: number; resolved: number }>;
  resolution_rate: number;
  changes_with_evidence: number;
  top_changes: ChangeLearning[];
};

/**
 * Compute a full event intelligence summary for diagnostics and dashboard.
 */
export function computeEventIntelligence(
  resolved: ResolvedEvent[]
): EventIntelligenceSummary {
  const total = resolved.length;
  let attributed = 0;
  let autoResolved = 0;
  let noCause = 0;
  let pending = 0;
  let noCandidates = 0;

  const byType = new Map<string, { total: number; resolved: number }>();

  for (const r of resolved) {
    const typeEntry = byType.get(r.event.type) ?? { total: 0, resolved: 0 };
    typeEntry.total++;

    switch (r.status) {
      case "attributed":
        attributed++;
        typeEntry.resolved++;
        break;
      case "auto_resolved":
        autoResolved++;
        typeEntry.resolved++;
        break;
      case "no_cause":
        noCause++;
        typeEntry.resolved++;
        break;
      case "pending":
        pending++;
        break;
      case "no_candidates":
        noCandidates++;
        break;
    }

    byType.set(r.event.type, typeEntry);
  }

  const learning = computeChangeLearning(resolved);
  const resolvedCount = attributed + autoResolved + noCause;

  return {
    total_events: total,
    attributed,
    auto_resolved: autoResolved,
    no_cause: noCause,
    pending,
    no_candidates: noCandidates,
    by_type: Object.fromEntries(byType),
    resolution_rate: total > 0 ? Math.round((resolvedCount / total) * 100) : 0,
    changes_with_evidence: learning.length,
    top_changes: learning.slice(0, 10),
  };
}
