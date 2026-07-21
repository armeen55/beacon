/**
 * Page issue tracking — persistent state for scanner-detected issues.
 *
 * Issues are identified by {category}-{page_path}, which is deterministic
 * across scans. State persists in .data/page-issues.json.
 */

import { cache } from "react";

import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";

export type IssueStatus =
  | "new"
  | "handed_off"
  | "in_progress"
  | "shipped"
  | "verified"
  | "not_fixed"
  | "dismissed";

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

type State = {
  rolloutExecutions: RolloutExecution[] | null;
  patternEvidence: PatternEvidenceRecord[] | null;
  pageIssues: PersistedIssue[] | null;
};

// Night-shift fix (2026-06-11): 6th instance of the process-global
// cache class — `_state` was keyed by NOTHING, so the first tenant
// pinned its issues/rollouts for every later tenant in a warm process,
// AND the page_issues read pulled EVERY tenant's rows on hosted. Now a
// per-tenant Map; page_issues reads go through forTenant; the two
// disk-backed siblings keep their ambient per-tenant routing.
const _stateByTenant = new Map<string, State>();

async function loadStateForTenant(tenantId: string): Promise<State> {
  const repo = getRepository();
  const [re, pe, pi] = await Promise.all([
    repo.getRolloutExecutions(),
    repo.getPatternEvidence(),
    repo.forTenant(tenantId).getPageIssues(),
  ]);
  return { rolloutExecutions: re, patternEvidence: pe, pageIssues: pi };
}

const ensureLoaded = cache(async (): Promise<State> => {
  const tenantId = await currentTenantId();
  const cached = _stateByTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await loadStateForTenant(tenantId);
  _stateByTenant.set(tenantId, loaded);
  return loaded;
});

export const getRolloutExecutions = cache(
  async (): Promise<RolloutExecution[]> => {
    return (await ensureLoaded()).rolloutExecutions!;
  },
);

export const getPatternEvidence = cache(
  async (): Promise<PatternEvidenceRecord[]> => {
    return (await ensureLoaded()).patternEvidence!;
  },
);

export const getPageIssues = cache(async (): Promise<PersistedIssue[]> => {
  return (await ensureLoaded()).pageIssues!;
});

