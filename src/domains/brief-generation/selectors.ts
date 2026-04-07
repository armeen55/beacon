import type { ProposedBrief, ProposedBriefStatus } from "./types";

export function proposedBriefs(briefs: ProposedBrief[]): ProposedBrief[] {
  return briefs.filter((b) => b.status === "proposed");
}

export function acceptedBriefs(briefs: ProposedBrief[]): ProposedBrief[] {
  return briefs.filter((b) => b.status === "accepted");
}

export function readyToExecute(briefs: ProposedBrief[]): ProposedBrief[] {
  return proposedBriefs(briefs).filter(
    (b) =>
      b.confidence !== "low" &&
      b.blockedBy.length === 0 &&
      b.score >= 40
  );
}

export function needsValidation(briefs: ProposedBrief[]): ProposedBrief[] {
  return proposedBriefs(briefs).filter(
    (b) => b.confidence === "low" || b.caveats.length >= 4
  );
}

export function systemFixBriefs(briefs: ProposedBrief[]): ProposedBrief[] {
  return proposedBriefs(briefs).filter(
    (b) => b.briefType === "measurement_fix" || b.briefType === "crawlability_fix"
  );
}

export function riskyBriefs(briefs: ProposedBrief[]): ProposedBrief[] {
  return proposedBriefs(briefs).filter(
    (b) => b.caveats.length >= 3 && b.confidence !== "high"
  );
}

export function briefForAction(
  briefs: ProposedBrief[],
  actionId: string
): ProposedBrief | null {
  return briefs.find((b) => b.sourceActionId === actionId) ?? null;
}

export function briefsForOpportunity(
  briefs: ProposedBrief[],
  opportunityId: string
): ProposedBrief[] {
  return briefs.filter((b) => b.sourceOpportunityId === opportunityId);
}

export type BriefQueueSummary = {
  total: number;
  proposed: number;
  accepted: number;
  rejected: number;
  readyToExecute: number;
  needsValidation: number;
  systemFixes: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
};

export function summarizeBriefQueue(briefs: ProposedBrief[]): BriefQueueSummary {
  let proposed = 0;
  let accepted = 0;
  let rejected = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const b of briefs) {
    switch (b.status) {
      case "proposed":
        proposed++;
        break;
      case "accepted":
        accepted++;
        break;
      case "rejected":
        rejected++;
        break;
    }
    switch (b.confidence) {
      case "high":
        high++;
        break;
      case "medium":
        medium++;
        break;
      case "low":
        low++;
        break;
    }
  }

  return {
    total: briefs.length,
    proposed,
    accepted,
    rejected,
    readyToExecute: readyToExecute(briefs).length,
    needsValidation: needsValidation(briefs).length,
    systemFixes: systemFixBriefs(briefs).length,
    highConfidence: high,
    mediumConfidence: medium,
    lowConfidence: low,
  };
}
