/**
 * Outcome Watch — post-ship observation + result linkage for verified rollouts.
 *
 * Generates lightweight outcome observations by comparing current evidence
 * against the state at verification time. Connects rollouts to scorecard
 * and result movement using page path + topic overlap + timing windows.
 */

import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PatternEvidenceRecord, RolloutExecution } from "./issues";
import type { ScorecardRow } from "@/domains/attribution/scorecard";
import type { OutcomeEvent } from "@/domains/attribution/events";

// ── Time windows (days) ──

export const TOO_EARLY_DAYS = 7;
export const INCUBATING_DAYS = 21;
export const MATURE_DAYS = 42;

// ── Types ──

export type OutcomeAssessment =
  | "too_early"
  | "incubating"
  | "early_movement"
  | "likely_no_visible_effect_yet"
  | "mixed_signal"
  | "promising_but_ambiguous";

export type OutcomeObservation = {
  outcomeObservationId: string;
  issueId: string;
  rolloutExecutionId: string;
  sourcePatternId: string;
  targetPage: string;
  observedAt: string;
  daysSinceVerified: number;
  citationCount: number | null;
  citationDelta: number | null;
  scorecardSignals: string;
  resultSignals: string;
  outcomeAssessment: OutcomeAssessment;
  evidenceSummary: string;
  linkedResultIds: string[];
  notes: string | null;
};

let _state: OutcomeObservation[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await getRepository().getOutcomeObservations();
});

export const getOutcomeObservations = cache(
  async (): Promise<OutcomeObservation[]> => {
    await ensureLoaded();
    return _state!;
  },
);

export async function persistOutcomeObservations(): Promise<void> {
  await writeStore("outcome-observations", await getOutcomeObservations());
}

export function _resetOutcomeObservationsForTests(): void {
  _state = null;
}

// ── Observation Generation ──

export function generateOutcomeObservation(
  execution: RolloutExecution,
  evidenceRecord: PatternEvidenceRecord | undefined,
  currentCitationCount: number | null,
  scorecardRows: ScorecardRow[],
  outcomeEvents: OutcomeEvent[]
): OutcomeObservation {
  const now = new Date();
  const verifiedAt = execution.verifiedAt ? new Date(execution.verifiedAt) : null;
  const daysSinceVerified = verifiedAt
    ? Math.floor((now.getTime() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const pagePath = execution.targetPage.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";
  const normUrl = execution.targetPage.replace(/\/+$/, "").toLowerCase();

  // ── Citation delta ──
  const preShip = evidenceRecord?.preShipCitationCount ?? null;
  const citationDelta = preShip != null && currentCitationCount != null
    ? currentCitationCount - preShip
    : null;

  // ── Scorecard linkage by page URL ──
  const linkedRows = scorecardRows.filter((r) => {
    if (!r.change.url) return false;
    const changeUrl = r.change.url.replace(/\/+$/, "").toLowerCase();
    return changeUrl === normUrl || changeUrl.endsWith(pagePath);
  });

  const scorecardSignals = linkedRows.length > 0
    ? `${linkedRows.length} linked change${linkedRows.length !== 1 ? "s" : ""}: ${linkedRows.map((r) => `${r.verdict} (score ${Math.round(r.topScore ?? 0)})`).join(", ")}`
    : "No direct scorecard matches";

  // ── Result/event linkage by topic + timing ──
  const linkedTopics = new Set<string>();
  for (const r of linkedRows) {
    for (const t of r.topics) linkedTopics.add(t);
  }

  const postVerifyEvents = outcomeEvents.filter((e) => {
    if (!verifiedAt) return false;
    const eventDate = new Date(e.trigger_date);
    if (eventDate < verifiedAt) return false;
    return linkedTopics.has(e.topic);
  });

  const linkedResultIds = [...new Set(postVerifyEvents.flatMap((e) => e.result_ids))];

  const resultSignals = postVerifyEvents.length > 0
    ? `${postVerifyEvents.length} post-ship event${postVerifyEvents.length !== 1 ? "s" : ""} on overlapping topics`
    : "No post-ship events on linked topics yet";

  // ── Assessment ──
  let outcomeAssessment: OutcomeAssessment;
  let evidenceSummary: string;

  if (daysSinceVerified < TOO_EARLY_DAYS) {
    outcomeAssessment = "too_early";
    evidenceSummary = `Verified ${daysSinceVerified}d ago — too early to assess visibility impact`;
  } else if (daysSinceVerified < INCUBATING_DAYS) {
    if (citationDelta != null && citationDelta > 0) {
      outcomeAssessment = "early_movement";
      evidenceSummary = `+${citationDelta} citations since pre-ship (${preShip} → ${currentCitationCount}). ${resultSignals}`;
    } else if (postVerifyEvents.length > 0) {
      outcomeAssessment = "early_movement";
      evidenceSummary = `${postVerifyEvents.length} post-ship events detected. Citation change: ${citationDelta != null ? (citationDelta >= 0 ? `+${citationDelta}` : String(citationDelta)) : "unknown"}`;
    } else {
      outcomeAssessment = "incubating";
      evidenceSummary = `Still incubating (${daysSinceVerified}d). ${citationDelta != null ? `Citations: ${citationDelta >= 0 ? `+${citationDelta}` : String(citationDelta)}` : "Citation data unavailable"}. No post-ship events yet.`;
    }
  } else {
    if (citationDelta != null && citationDelta > 0 && postVerifyEvents.length > 0) {
      outcomeAssessment = "promising_but_ambiguous";
      evidenceSummary = `+${citationDelta} citations and ${postVerifyEvents.length} post-ship events after ${daysSinceVerified}d. Signal is positive but causal attribution is not confirmed.`;
    } else if (citationDelta != null && citationDelta > 0) {
      outcomeAssessment = "promising_but_ambiguous";
      evidenceSummary = `+${citationDelta} citations after ${daysSinceVerified}d. No clear linked events, but directional signal is positive.`;
    } else if (postVerifyEvents.length > 0 && (citationDelta == null || citationDelta === 0)) {
      outcomeAssessment = "mixed_signal";
      evidenceSummary = `${postVerifyEvents.length} post-ship events but no citation increase detected after ${daysSinceVerified}d.`;
    } else {
      outcomeAssessment = "likely_no_visible_effect_yet";
      evidenceSummary = `${daysSinceVerified}d since verified. ${citationDelta != null ? `Citations: ${citationDelta >= 0 ? `+${citationDelta}` : String(citationDelta)}` : "Citation data unavailable"}. No post-ship events detected.`;
    }
  }

  return {
    outcomeObservationId: `obs-${execution.executionId}-${Date.now()}`,
    issueId: execution.issueId,
    rolloutExecutionId: execution.executionId,
    sourcePatternId: execution.sourcePatternId,
    targetPage: execution.targetPage,
    observedAt: now.toISOString(),
    daysSinceVerified,
    citationCount: currentCitationCount,
    citationDelta,
    scorecardSignals,
    resultSignals,
    outcomeAssessment,
    evidenceSummary,
    linkedResultIds,
    notes: null,
  };
}

// ── Observation for Pages display ──

export type OutcomeWatchSummary = {
  daysSinceVerified: number;
  citationDelta: number | null;
  currentCitations: number | null;
  preShipCitations: number | null;
  outcomeAssessment: OutcomeAssessment;
  evidenceSummary: string;
  linkedResultCount: number;
  observedAt: string | null;
};

export async function getOutcomeWatchForIssue(issueId: string): Promise<OutcomeWatchSummary | null> {
  const outcomeObservations = await getOutcomeObservations();
  const obs = outcomeObservations
    .filter((o) => o.issueId === issueId)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));

  const latest = obs[0];
  if (!latest) return null;

  return {
    daysSinceVerified: latest.daysSinceVerified,
    citationDelta: latest.citationDelta,
    currentCitations: latest.citationCount,
    preShipCitations: latest.citationDelta != null && latest.citationCount != null
      ? latest.citationCount - latest.citationDelta
      : null,
    outcomeAssessment: latest.outcomeAssessment,
    evidenceSummary: latest.evidenceSummary,
    linkedResultCount: latest.linkedResultIds.length,
    observedAt: latest.observedAt,
  };
}

// ── Assessment labels ──

export const OUTCOME_LABELS: Record<OutcomeAssessment, { label: string; color: string }> = {
  too_early: { label: "Too early to judge", color: "text-muted-foreground" },
  incubating: { label: "Still incubating", color: "text-muted-foreground" },
  early_movement: { label: "Early movement", color: "text-accent-primary" },
  likely_no_visible_effect_yet: { label: "No visible effect yet", color: "text-status-warning" },
  mixed_signal: { label: "Mixed signal", color: "text-status-warning" },
  promising_but_ambiguous: { label: "Promising but ambiguous", color: "text-status-success" },
};
