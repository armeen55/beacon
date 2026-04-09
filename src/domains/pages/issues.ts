/**
 * Page issue tracking — persistent state for scanner-detected issues.
 *
 * Issues are identified by {category}-{page_path}, which is deterministic
 * across scans. State persists in .data/page-issues.json.
 */

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";

export type IssueStatus =
  | "new"
  | "handed_off"
  | "in_progress"
  | "shipped"
  | "verified"
  | "not_fixed"
  | "dismissed";

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  new: "New",
  handed_off: "Handed off",
  in_progress: "In progress",
  shipped: "Shipped",
  verified: "Verified",
  not_fixed: "Not fixed",
  dismissed: "Dismissed",
};

export type PersistedIssue = {
  issueId: string;
  pageUrl: string;
  pagePath: string;
  category: string;
  status: IssueStatus;
  handedOffAt: string | null;
  shippedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
  verifyResult: {
    cleared: boolean;
    remaining: string[];
    summary: string;
  } | null;
  /**
   * ObservationRun id for the live verify fetch that produced the persisted snapshot
   * (`website_verify`). Present for verifications after this field shipped.
   */
  verificationObservationRunId?: string | null;
  /**
   * Snapshot / crawl ObservationRun id on disk immediately before verify ran (nullable legacy).
   */
  verificationBaselineObservationRunId?: string | null;
};

export type RolloutExecution = {
  executionId: string;
  briefId: string;
  issueId: string;
  sourcePatternId: string;
  targetPage: string;
  briefTitle: string;
  briefType: "fix" | "growth";
  createdAt: string;
  handedOffAt: string | null;
  shippedAt: string | null;
  verifiedAt: string | null;
  verificationResult: string | null;
  notes: string | null;
};

export type OutcomeStatus =
  | "shipped_not_verified"
  | "verification_failed"
  | "structurally_verified_outcome_too_early"
  | "structurally_verified_no_clear_impact_yet"
  | "structurally_verified_with_positive_signal";

export type PatternEvidenceRecord = {
  patternEvidenceId: string;
  sourcePatternId: string;
  briefId: string;
  issueId: string;
  rolloutExecutionId: string;
  targetPage: string;
  createdAt: string;
  shippedAt: string | null;
  verifiedAt: string | null;
  structuralVerificationResult: string | null;
  preShipCitationCount: number | null;
  postShipCitationCount: number | null;
  outcomeStatus: OutcomeStatus;
  notes: string | null;
};

const repo = getRepository();

export const rolloutExecutions: RolloutExecution[] =
  await repo.getRolloutExecutions();
export const patternEvidence: PatternEvidenceRecord[] =
  await repo.getPatternEvidence();
export const pageIssues: PersistedIssue[] = await repo.getPageIssues();

export async function persistRolloutExecutions(): Promise<void> {
  await writeStore("rollout-executions", rolloutExecutions);
}

export function issueIdFromBrief(briefId: string, url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";
  return `rollout-${briefId}-${path.replace(/\//g, "-").replace(/^-/, "")}`;
}

export function issueIdFromAlert(category: string, url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";
  return `issue-${category}-${path.replace(/\//g, "-").replace(/^-/, "")}`;
}

export async function persistPatternEvidence(): Promise<void> {
  await writeStore("pattern-evidence", patternEvidence);
}

export async function persistPageIssues(): Promise<void> {
  await writeStore("page-issues", pageIssues);
}
