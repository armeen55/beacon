/**
 * Single source of truth for “which changes link to this result?” in the Results UI.
 *
 * Two different mechanisms exist in Beacon:
 * 1) **Stored IDs** — `result.attributed_changelog_ids` (import / workbook / bridge).
 * 2) **Event drivers** — outcome events + triage + Review decisions (this map).
 *
 * Diagnostics “Attribution coverage” counts (1) only. This map implements (2).
 */

import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { EventDecision } from "@/domains/attribution/types";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { classifyEvidenceTier } from "@/domains/pages/evidence-tier";
import type { AttributionConfidence } from "@/domains/attribution/types";
import type { EvidenceTier } from "@/domains/pages/types";

export type ResultDriverTrust =
  | "confirmed"
  | "auto_cleared"
  | "system_primary"
  | "contributing"
  | "unresolved";

export type ResultDriverInfo = {
  changeName: string;
  changeId: string;
  trust: ResultDriverTrust;
  confidence: AttributionConfidence | string;
  evidenceTier: EvidenceTier;
  score: number | null;
  eventType: string | null;
};

export function buildAttributionDriverMap(
  allResults: Result[],
  changelogEntries: ChangelogEntry[],
  opportunities: Opportunity[],
  eventDecisions: EventDecision[]
): Map<string, ResultDriverInfo> {
  const { attribution: attrResults } = partitionResultsByMode(allResults);
  const events = detectOutcomeEvents(attrResults);

  const rejectedByResult = new Map<string, Set<string>>();
  for (const d of eventDecisions) {
    for (const rid of d.rejected_change_ids) {
      let set = rejectedByResult.get(d.result_id);
      if (!set) {
        set = new Set();
        rejectedByResult.set(d.result_id, set);
      }
      set.add(rid);
    }
  }

  const driverMap = new Map<string, ResultDriverInfo>();

  for (const d of eventDecisions) {
    if (d.cause_type === "change" && d.primary_change_id) {
      const change = changelogEntries.find((c) => c.id === d.primary_change_id);
      if (change) {
        driverMap.set(d.result_id, {
          changeName: change.asset_name,
          changeId: change.id,
          trust: "confirmed",
          confidence:
            d.operator_confidence === "high"
              ? "high"
              : d.operator_confidence === "medium"
                ? "medium"
                : "low",
          evidenceTier: classifyEvidenceTier(change).tier,
          score: null,
          eventType: null,
        });
      }
    } else if (d.cause_type !== "change") {
      driverMap.set(d.result_id, {
        changeName:
          d.cause_type === "competitor"
            ? "Competitor action"
            : d.cause_type === "algorithm"
              ? "Algorithm shift"
              : "Unknown cause",
        changeId: "",
        trust: "confirmed",
        confidence: d.operator_confidence,
        evidenceTier: "inferred",
        score: null,
        eventType: null,
      });
    }
  }

  for (const event of events) {
    const resultId = event.anchor_result_id;
    if (driverMap.has(resultId)) continue;

    const result = allResults.find((r) => r.id === resultId);
    if (!result) continue;

    const candidates = discoverCandidates(result, changelogEntries, opportunities);
    const triaged = triageCandidates(candidates);
    const rejected = rejectedByResult.get(resultId);
    const isRejected = (changeId: string) => rejected?.has(changeId) ?? false;

    if (triaged.primary && !isRejected(triaged.primary.change.id)) {
      const ch = triaged.primary.change;
      driverMap.set(resultId, {
        changeName: ch.asset_name,
        changeId: ch.id,
        trust: triaged.autoResolved ? "auto_cleared" : "system_primary",
        confidence: triaged.primary.attribution.confidence,
        evidenceTier:
          triaged.primary.attribution.evidence_tier ?? classifyEvidenceTier(ch).tier,
        score: triaged.primary.score,
        eventType: event.type.replace(/_/g, " "),
      });
    } else {
      const validContrib = triaged.contributing.filter(
        (c) => !isRejected(c.change.id)
      );
      if (validContrib.length > 0) {
        const top = validContrib[0];
        driverMap.set(resultId, {
          changeName: top.change.asset_name,
          changeId: top.change.id,
          trust: "contributing",
          confidence: top.attribution.confidence,
          evidenceTier:
            top.attribution.evidence_tier ?? classifyEvidenceTier(top.change).tier,
          score: top.score,
          eventType: event.type.replace(/_/g, " "),
        });
      } else {
        const validReview = triaged.needsReview.filter(
          (c) => !isRejected(c.change.id)
        );
        if (validReview.length > 0) {
          const top = validReview[0];
          driverMap.set(resultId, {
            changeName: top.change.asset_name,
            changeId: top.change.id,
            trust: "unresolved",
            confidence: top.attribution.confidence,
            evidenceTier:
              top.attribution.evidence_tier ?? classifyEvidenceTier(top.change).tier,
            score: top.score,
            eventType: event.type.replace(/_/g, " "),
          });
        }
      }
    }
  }

  return driverMap;
}

export type DriverCoverageSummary = {
  /** Results in attribution mode (eligible for event pipeline). */
  attributionModeResultCount: number;
  /** Those rows with non-empty `attributed_changelog_ids` (import/workbook). */
  withStoredChangeIds: number;
  /** Those with a driver from this map (event + triage + Review). */
  withEventDriver: number;
  byTrust: Record<ResultDriverTrust, number>;
};

export function summarizeDriverCoverage(
  allResults: Result[],
  driverMap: Map<string, ResultDriverInfo>
): DriverCoverageSummary {
  const { attribution: attrResults } = partitionResultsByMode(allResults);
  const byTrust: Record<ResultDriverTrust, number> = {
    confirmed: 0,
    auto_cleared: 0,
    system_primary: 0,
    contributing: 0,
    unresolved: 0,
  };

  let withStoredChangeIds = 0;
  let withEventDriver = 0;

  for (const r of attrResults) {
    if (r.attributed_changelog_ids.length > 0) withStoredChangeIds++;
    const d = driverMap.get(r.id);
    if (d) {
      withEventDriver++;
      byTrust[d.trust]++;
    }
  }

  return {
    attributionModeResultCount: attrResults.length,
    withStoredChangeIds,
    withEventDriver,
    byTrust,
  };
}
