import type { Opportunity } from "./types";
import type { Brief } from "@/domains/briefs/types";
import type { FreshnessStatus } from "./freshness";
import type { OpportunityScore } from "./scoring";

export type GuidanceUrgency = "critical" | "high" | "medium" | "low";

export type GuidanceItem = {
  action: string;
  reason: string;
  urgency: GuidanceUrgency;
};

export function getOpportunityGuidance(
  opp: Opportunity,
  linkedBriefs: Brief[],
  freshness: FreshnessStatus,
  score: OpportunityScore
): GuidanceItem[] {
  const items: GuidanceItem[] = [];

  if (opp.current_status === "new") {
    if (score.total >= 60) {
      items.push({
        action: "Create a brief and start executing",
        reason: `Score is ${score.total} — this is a strong opportunity waiting for action`,
        urgency: "high",
      });
    } else {
      items.push({
        action: "Assess and prioritize this opportunity",
        reason: "New opportunity needs evaluation before committing resources",
        urgency: "medium",
      });
    }
  }

  if (opp.current_status === "queued" && linkedBriefs.length === 0) {
    items.push({
      action: "Create a brief to plan execution",
      reason: "Opportunity is queued but has no execution plan",
      urgency: "high",
    });
  }

  if (opp.current_status === "queued" && linkedBriefs.length > 0) {
    items.push({
      action: "Start executing the linked brief",
      reason: "Plan exists — begin implementation",
      urgency: "medium",
    });
  }

  if (opp.current_status === "executing") {
    const activeBriefs = linkedBriefs.filter(
      (b) => b.status === "in_progress"
    );
    if (activeBriefs.length === 0) {
      items.push({
        action: "Check on brief progress — no active briefs found",
        reason: "Opportunity is marked as executing but no briefs are in progress",
        urgency: "high",
      });
    }
  }

  if (opp.current_status === "validating") {
    items.push({
      action: "Check results and verify impact",
      reason: "Execution is complete — validate whether the opportunity was captured",
      urgency: "medium",
    });
  }

  if (opp.current_status === "regressed") {
    items.push({
      action: "Investigate regression and consider re-executing",
      reason: "Previously captured position has been lost",
      urgency: "critical",
    });
  }

  if (opp.current_status === "partially_captured") {
    items.push({
      action: "Extend execution to close remaining gaps",
      reason: "Partial progress — additional work could complete the capture",
      urgency: "medium",
    });
  }

  if (opp.current_status === "monitoring") {
    items.push({
      action: "Re-verify current position and competitive landscape",
      reason: "Monitoring phase — ensure stability",
      urgency: "low",
    });
  }

  if (freshness.level === "abandoned") {
    items.push({
      action: "Close or defer this opportunity",
      reason: freshness.message,
      urgency: "critical",
    });
  } else if (freshness.level === "stale") {
    items.push({
      action: "Review and take action or defer",
      reason: freshness.message,
      urgency: "high",
    });
  }

  if (
    opp.competitor_ids.length > 0 &&
    opp.current_status !== "captured" &&
    opp.current_status !== "closed"
  ) {
    items.push({
      action: "Review competitive landscape for changes",
      reason: "Competitors are active in this space",
      urgency: "low",
    });
  }

  return items;
}
