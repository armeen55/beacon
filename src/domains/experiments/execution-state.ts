/**
 * execution-state (2026-07-01) — the PURE post-acceptance execution state machine for the Daily
 * Experiment Cycle. After a plan is ACCEPTED (controls reserved), each item is executed one-by-one:
 * operator applies the change in Wix → Beacon verifies it LIVE → atomic activation (proof row +
 * reservations active) → GSC submission tracked → results measure at 7/14/28d.
 *
 * No I/O. No LLM. Deterministic transitions only. The execution state lives inside the plan jsonb
 * under `execution` (no new table); the atomic activation/skip RPCs and the server actions are the
 * only writers. The acceptance lifecycle (DailyPlanStatus: preview/accepted/...) is SEPARATE and is
 * never overloaded by the execution layer.
 */
import type { ExperimentLever } from "./daily-plan-types";

/** Per-item execution status. */
export type DailyExperimentItemStatus =
  | "ready_to_apply"
  | "verification_pending"
  | "verification_failed"
  | "verified_live"
  | "activation_pending"
  | "active"
  | "gsc_submission_pending"
  | "gsc_submitted"
  | "skipped"
  | "rolled_back";

/** Plan-level execution rollup (DERIVED from item statuses + the acceptance lifecycle). */
export type DailyPlanExecutionStatus =
  | "preview"
  | "accepted"
  | "in_progress"
  | "partially_active"
  | "active"
  | "completed"
  | "abandoned";

/** Deterministic verification failure reasons (lever-specific, no LLM). */
export type VerificationFailureReason =
  | "page_unreachable"
  | "expected_text_missing"
  | "old_text_still_present"
  | "multiple_values_found"
  | "unrelated_field_changed"
  | "link_missing"
  | "wrong_destination"
  | "answer_not_at_expected_location"
  | "snapshot_stale"
  | "verification_source_unavailable";

export type UnchangedCheck = { field: string; ok: boolean; detail?: string };
export type VerificationReceipt = { verifiedAt: string; method: string; observedValue: string; source: string };

/** The deterministic live-verification contract (Phase 3). */
export type LiveVerificationResult =
  | {
      verified: true;
      observedAt: string;
      observedValue: string;
      unchangedChecks: UnchangedCheck[];
      receipt: VerificationReceipt;
    }
  | {
      verified: false;
      reason: VerificationFailureReason;
      expected: string;
      observed?: string;
      retryable: boolean;
    };

/** A persisted transition receipt (audit trail; every state change appends one). */
export type TransitionReceipt = {
  from: DailyExperimentItemStatus | "none";
  to: DailyExperimentItemStatus;
  at: string; // ISO
  actor: "operator" | "beacon";
  reason?: string;
  idempotencyKey?: string;
};

/** Per-item execution record (persisted inside plan.execution.items[experimentId]). */
export type ItemExecutionRecord = {
  experimentId: string;
  status: DailyExperimentItemStatus;
  receipts: TransitionReceipt[];
  verifiedAt?: string;
  verification?: LiveVerificationResult;
  activatedAt?: string;
  proofId?: string;
  gscSubmittedAt?: string;
  skippedAt?: string;
  skipReason?: string;
};

/** The execution block stored in the plan jsonb (source of truth for item state). */
export type PlanExecutionState = {
  items: Record<string, ItemExecutionRecord>;
  updatedAt: string;
};

/**
 * Allowed item transitions. The map IS the safety contract — anything not listed is forbidden
 * (notably ready_to_apply → active and verification_failed → active can never happen: there is no
 * path to `active` that doesn't pass through `verified_live`).
 */
const ALLOWED_TRANSITIONS: Record<DailyExperimentItemStatus, DailyExperimentItemStatus[]> = {
  ready_to_apply: ["verification_pending", "skipped"],
  verification_pending: ["verified_live", "verification_failed"],
  verification_failed: ["verification_pending", "skipped"],
  verified_live: ["activation_pending", "active"],
  activation_pending: ["active", "verified_live"],
  active: ["gsc_submission_pending", "gsc_submitted"],
  gsc_submission_pending: ["gsc_submitted"],
  gsc_submitted: [],
  skipped: [],
  rolled_back: [],
};

export function canTransition(from: DailyExperimentItemStatus, to: DailyExperimentItemStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** lever → canonical proof action_type (see action-types.ts). */
export const LEVER_TO_ACTION_TYPE: Record<ExperimentLever, string> = {
  meta: "edit_meta",
  internal_link: "add_internal_link",
  answer_block: "add_answer_block",
  title: "edit_title",
  h1: "change_h1",
};

/** Read an item's status from the (optional) execution block; default ready_to_apply once accepted. */
export function itemStatus(execution: PlanExecutionState | undefined, experimentId: string): DailyExperimentItemStatus {
  return execution?.items?.[experimentId]?.status ?? "ready_to_apply";
}

const ACTIVE_STATES: DailyExperimentItemStatus[] = ["active", "gsc_submission_pending", "gsc_submitted"];
export function isActiveStatus(s: DailyExperimentItemStatus): boolean {
  return ACTIVE_STATES.includes(s);
}

/**
 * Derive the plan-level execution status from the acceptance lifecycle + item statuses. Honest: a
 * plan is "active" only when every non-skipped item is active; "completed" is decided elsewhere from
 * proof verdicts (all active items reached the final window), never merely because edits were applied.
 */
export function derivePlanExecutionStatus(
  acceptanceStatus: "preview" | "accepted" | "expired" | "abandoned" | "completed",
  itemStatuses: DailyExperimentItemStatus[],
): DailyPlanExecutionStatus {
  if (acceptanceStatus === "preview") return "preview";
  if (acceptanceStatus === "abandoned") return "abandoned";
  if (acceptanceStatus === "completed") return "completed";
  const actionable = itemStatuses.filter((s) => s !== "skipped");
  if (actionable.length === 0) return "accepted";
  const activeCount = itemStatuses.filter(isActiveStatus).length;
  if (activeCount >= actionable.length) return "active";
  if (activeCount > 0) return "partially_active";
  const anyProgress = itemStatuses.some((s) => s !== "ready_to_apply" && s !== "skipped");
  return anyProgress ? "in_progress" : "accepted";
}

/** Build a fresh transition receipt. */
export function transitionReceipt(
  from: DailyExperimentItemStatus | "none",
  to: DailyExperimentItemStatus,
  at: string,
  actor: "operator" | "beacon",
  extra?: { reason?: string; idempotencyKey?: string },
): TransitionReceipt {
  return { from, to, at, actor, ...(extra?.reason ? { reason: extra.reason } : {}), ...(extra?.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}) };
}
