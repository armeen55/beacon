import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type {
  Attribution,
  AttributionConfidence,
  ChangeVerdict,
  EventDecision,
} from "./types";
import type { EvidenceTier, EvidenceTierMeta } from "@/domains/pages/types";
import type { OutcomeEvent } from "./events";
import { detectOutcomeEvents, isNegativeEvent } from "./events";
import { discoverCandidates } from "./candidates";
import { triageCandidates } from "./triage";
import { partitionResultsByMode } from "./result-mode";
import { classifyEvidenceTier } from "@/domains/pages/evidence-tier";
import { ATTRIBUTION_CONFIG } from "./config";

export type TrustSource =
  | "operator_confirmed"
  | "auto_cleared"
  | "system_primary"
  | "contributing"
  | "candidate"
  | "operator_rejected";

export type EventAttribution = {
  event: OutcomeEvent;
  score: number;
  confidence: AttributionConfidence;
  role: "primary" | "contributing" | "candidate" | "suppressed";
  trustSource: TrustSource;
  matches: Attribution["matches"];
  explanation: string;
};

export type ScorecardRow = {
  change: ChangelogEntry;
  verdict: ChangeVerdict;
  verdictSummary: string;
  evidenceTier: EvidenceTier;
  evidenceFlags: string[];
  topScore: number | null;
  topConfidence: AttributionConfidence | null;
  topTrust: TrustSource | null;
  eventAttributions: EventAttribution[];
  platforms: string[];
  topics: string[];
  totalEventsLinked: number;
  operatorConfirmedCount: number;
  daysSinceChange: number;
};

const TOO_EARLY_DAYS = 14;

const TRUST_RANK: Record<TrustSource, number> = {
  operator_confirmed: 0,
  auto_cleared: 1,
  system_primary: 2,
  contributing: 3,
  candidate: 4,
  operator_rejected: 5,
};

export function computeScorecard(
  changes: ChangelogEntry[],
  allResults: Result[],
  allOpportunities: Opportunity[],
  decisions: EventDecision[]
): ScorecardRow[] {
  const { attribution: attrResults } = partitionResultsByMode(allResults);
  const events = detectOutcomeEvents(attrResults);

  // Index operator decisions by event_id
  const decisionByEvent = new Map<string, EventDecision>();
  for (const d of decisions) {
    decisionByEvent.set(d.event_id, d);
  }
  // Index rejected change IDs across all decisions
  const globalRejected = new Set<string>();
  for (const d of decisions) {
    for (const rid of d.rejected_change_ids) {
      globalRejected.add(`${d.result_id}|${rid}`);
    }
  }

  // For each event, compute candidates and triage
  const eventCandidateMap = new Map<
    string,
    { event: OutcomeEvent; triaged: ReturnType<typeof triageCandidates> }
  >();

  for (const event of events) {
    const result = allResults.find((r) => r.id === event.anchor_result_id);
    if (!result) continue;
    const candidates = discoverCandidates(result, changes, allOpportunities);
    const triaged = triageCandidates(candidates);
    eventCandidateMap.set(event.id, { event, triaged });
  }

  const now = Date.now();

  return changes.map((change) => {
    const tierMeta: EvidenceTierMeta = classifyEvidenceTier(change);
    const daysSinceChange = Math.round(
      (now - new Date(change.timestamp).getTime()) / (1000 * 60 * 60 * 24)
    );

    const eventAttributions: EventAttribution[] = [];

    for (const [eventId, { event, triaged }] of eventCandidateMap) {
      const decision = decisionByEvent.get(eventId);
      const resultId = event.anchor_result_id;

      // If operator explicitly rejected this change for this event, mark it
      if (
        decision &&
        decision.rejected_change_ids.includes(change.id)
      ) {
        // Find the candidate data for score/matches
        const allCands = [
          triaged.primary,
          ...triaged.contributing,
          ...triaged.needsReview,
          ...triaged.suppressed,
        ].filter(Boolean);
        const cand = allCands.find((c) => c!.change.id === change.id);
        if (cand) {
          eventAttributions.push({
            event,
            score: cand.score,
            confidence: cand.attribution.confidence,
            role: "suppressed",
            trustSource: "operator_rejected",
            matches: cand.attribution.matches,
            explanation: cand.attribution.explanation,
          });
        }
        continue;
      }

      // If operator confirmed this change as the primary for this event
      if (
        decision &&
        decision.cause_type === "change" &&
        decision.primary_change_id === change.id
      ) {
        const allCands = [
          triaged.primary,
          ...triaged.contributing,
          ...triaged.needsReview,
          ...triaged.suppressed,
        ].filter(Boolean);
        const cand = allCands.find((c) => c!.change.id === change.id);
        eventAttributions.push({
          event,
          score: cand?.score ?? 100,
          confidence: decision.operator_confidence as AttributionConfidence,
          role: "primary",
          trustSource: "operator_confirmed",
          matches: cand?.attribution.matches ?? { platform: "unknown", topic: "unknown", url: "unknown", geo: "unknown", temporal: "unknown", sourceCategory: "unknown" },
          explanation: cand?.attribution.explanation ?? "Operator confirmed",
        });
        continue;
      }

      // System triage (no operator decision for this event, or decision was non-change)
      if (triaged.primary?.change.id === change.id) {
        eventAttributions.push({
          event,
          score: triaged.primary.score,
          confidence: triaged.primary.attribution.confidence,
          role: "primary",
          trustSource: triaged.autoResolved ? "auto_cleared" : "system_primary",
          matches: triaged.primary.attribution.matches,
          explanation: triaged.primary.attribution.explanation,
        });
        continue;
      }

      const contrib = triaged.contributing.find(
        (c) => c.change.id === change.id
      );
      if (contrib) {
        eventAttributions.push({
          event,
          score: contrib.score,
          confidence: contrib.attribution.confidence,
          role: "contributing",
          trustSource: "contributing",
          matches: contrib.attribution.matches,
          explanation: contrib.attribution.explanation,
        });
        continue;
      }

      const review = triaged.needsReview.find(
        (c) => c.change.id === change.id
      );
      if (review) {
        eventAttributions.push({
          event,
          score: review.score,
          confidence: review.attribution.confidence,
          role: "candidate",
          trustSource: "candidate",
          matches: review.attribution.matches,
          explanation: review.attribution.explanation,
        });
        continue;
      }

      const supp = triaged.suppressed.find(
        (c) => c.change.id === change.id
      );
      if (supp) {
        eventAttributions.push({
          event,
          score: supp.score,
          confidence: supp.attribution.confidence,
          role: "suppressed",
          trustSource: "candidate",
          matches: supp.attribution.matches,
          explanation: supp.attribution.explanation,
        });
      }
    }

    // Only show non-suppressed attributions
    const meaningful = eventAttributions.filter(
      (a) => a.role !== "suppressed"
    );
    const positiveEvents = meaningful.filter(
      (a) => !isNegativeEvent(a.event),
    );
    const negativeEvents = meaningful.filter(
      (a) => isNegativeEvent(a.event),
    );
    const operatorConfirmed = meaningful.filter(
      (a) => a.trustSource === "operator_confirmed"
    );
    const primaries = positiveEvents.filter((a) => a.role === "primary");
    const contribs = positiveEvents.filter((a) => a.role === "contributing");

    const platforms = [
      ...new Set(meaningful.map((a) => a.event.platform)),
    ];
    const topics = [...new Set(meaningful.map((a) => a.event.topic))];
    const topScore =
      meaningful.length > 0
        ? Math.max(...meaningful.map((a) => a.score))
        : null;

    // Top trust: operator > auto_cleared > system_primary > contributing > candidate
    const bestTrust =
      meaningful.length > 0
        ? meaningful.sort(
            (a, b) => TRUST_RANK[a.trustSource] - TRUST_RANK[b.trustSource]
          )[0]
        : null;
    const topConfidence = bestTrust?.confidence ?? null;
    const topTrust = bestTrust?.trustSource ?? null;

    // Verdict — operator-confirmed overrides everything
    let verdict: ChangeVerdict;
    let verdictSummary: string;

    // Negative-only: all linked events are declines/losses
    if (meaningful.length > 0 && positiveEvents.length === 0 && negativeEvents.length > 0) {
      const negPrimaries = negativeEvents.filter((a) => a.role === "primary");
      if (negPrimaries.length >= 1) {
        verdict = "negative";
        const topicStr = topics.slice(0, 2).join(", ");
        verdictSummary = `Visibility declined for ${topicStr} after this change — ${negativeEvents.length} negative event${negativeEvents.length > 1 ? "s" : ""}`;
      } else {
        verdict = "inconclusive";
        verdictSummary = `Linked to ${negativeEvents.length} decline event${negativeEvents.length > 1 ? "s" : ""} as candidate — not confirmed`;
      }
    } else if (operatorConfirmed.length >= 1) {
      if (primaries.length >= 2 || (primaries.length >= 1 && contribs.length >= 1)) {
        verdict = "validated";
      } else {
        verdict = "validated";
      }
      verdictSummary =
        operatorConfirmed.length === 1
          ? `Operator-confirmed cause for ${operatorConfirmed[0].event.topic}`
          : `Operator-confirmed across ${operatorConfirmed.length} events`;
    } else if (primaries.length >= 2) {
      verdict = "validated";
      const topicStr = topics.slice(0, 2).join(", ");
      verdictSummary = `Primary cause in ${primaries.length} events across ${topicStr}`;
    } else if (primaries.length === 1 && contribs.length >= 1) {
      verdict = "validated";
      verdictSummary = `Primary in 1 event, contributing in ${contribs.length} more`;
    } else if (primaries.length === 1) {
      verdict = "partial";
      const ev = primaries[0].event;
      verdictSummary = `Primary cause for ${ev.topic} on ${platformLabel(ev.platform)}`;
    } else if (contribs.length >= 2) {
      verdict = "partial";
      verdictSummary = `Contributing factor in ${contribs.length} events`;
    } else if (contribs.length === 1) {
      verdict = "inconclusive";
      verdictSummary = `Contributing in 1 event — not strong enough alone`;
    } else if (
      meaningful.length > 0 &&
      meaningful.every((a) => a.role === "candidate")
    ) {
      verdict = "inconclusive";
      verdictSummary = `Candidate for ${meaningful.length} event${meaningful.length !== 1 ? "s" : ""} — not yet resolved`;
    } else if (meaningful.length === 0 && daysSinceChange <= TOO_EARLY_DAYS) {
      verdict = "too_early";
      verdictSummary = `Changed ${daysSinceChange} days ago — waiting for outcome signals`;
    } else if (meaningful.length === 0) {
      const maxDays = ATTRIBUTION_CONFIG.discovery.maxDays;
      if (daysSinceChange > maxDays) {
        verdict = "no_impact";
        verdictSummary = `No outcome events detected within ${maxDays}-day attribution window`;
      } else {
        verdict = "too_early";
        verdictSummary = `Changed ${daysSinceChange} days ago — still within attribution window`;
      }
    } else {
      verdict = "pending";
      verdictSummary = "Awaiting more evidence";
    }

    return {
      change,
      verdict,
      verdictSummary,
      evidenceTier: tierMeta.tier,
      evidenceFlags: tierMeta.flags,
      topScore,
      topConfidence,
      topTrust,
      eventAttributions: meaningful,
      platforms,
      topics,
      totalEventsLinked: meaningful.length,
      operatorConfirmedCount: operatorConfirmed.length,
      daysSinceChange,
    };
  });
}

function platformLabel(p: string): string {
  const labels: Record<string, string> = {
    chatgpt: "ChatGPT",
    google_aio: "Google AI Overviews",
    perplexity: "Perplexity",
  };
  return labels[p] ?? p;
}
