/**
 * daily-plan-types (2026-06-30) - the durable Plan + Control Reservation contracts for the native
 * "Plan today's experiments → Accept" workflow. PURE types + deterministic id/hash helpers only.
 *
 * Scientific invariants this contract exists to protect:
 *  - A plan is reproducible: it snapshots the exact change + controls + the active-experiment
 *    topology at planning time, so acceptance can re-validate against a frozen baseline.
 *  - Acceptance is atomic: every control reserves or nothing does (enforced by the Postgres RPC,
 *    see the migration). Preview NEVER reserves.
 *  - Reservation ids are deterministic (`tenant::plan::experiment::control`) → duplicate acceptance
 *    is idempotent, and "one active reservation per (tenant, control)" is a DB unique constraint.
 */

export type DailyPlanStatus = "preview" | "accepted" | "expired" | "abandoned" | "completed";
export type ReservationStatus = "reserved" | "active" | "released" | "expired" | "invalidated";
// The 3 safe daily levers + the last-resort filler-drop edits (so a plan faithfully records any batch).
export type ExperimentLever = "meta" | "internal_link" | "answer_block" | "title" | "h1";

export type ProposedControlRecord = {
  controlUrl: string;
  controlPath: string; // normalized
  score: number;
  pageFamilyMatch: boolean;
  impressionsRatio?: number;
  positionDifference?: number;
  why: string;
};

export type PlannedExperimentRecord = {
  id: string; // deterministic within a plan: `${planId}::${path}`
  candidateId: string;
  url: string;
  canonicalUrl: string;
  pageLabel: string;
  pageFamily: string;
  lever: ExperimentLever;
  targetQuery: string;
  /** Plain-English reason this move is worth doing now (carried from the candidate). Shown on the
   *  card as the "Why it wins" line so the assistant surface never has to re-derive it. */
  whyNow: string;
  /** Who wrote proposedText: the deterministic proposer, or the LLM (slice D). The card shows a
   *  "Beacon wrote this, edit before you use it" note when this is "llm". Defaults deterministic. */
  draftSource?: "deterministic" | "llm";
  /** LLM-only: one plain-English line on why this wording, shown under the paste box. */
  llmRationale?: string;
  /** Slice E: keyword-research evidence for the "how we know" expander (the page's top searches +
   *  their cached DataForSEO volume + paid-competition level). Absent when no cached demand exists.
   *  Type lives in ./daily-evidence-brief (type-only import - no runtime cycle). */
  evidenceBrief?: import("./daily-evidence-brief").DailyEvidenceBrief;
  /** R1: the specialist team's debate that backed this pick (named voices + objections + verdict),
   *  frozen at planning time so the card shows the REAL argument, not a re-derivation. Absent when
   *  the team abstained. Type lives in ./team-review (type-only import - no runtime cycle). */
  teamReview?: import("./team-review").TeamReview;

  currentText: string;
  proposedText: string;
  placement: string;
  leaveUnchanged: string[];
  rollbackText: string;

  effortMinutes: number;
  risk: "low";

  controls: ProposedControlRecord[];
  influencedUrls: string[];

  /** Frozen hashes so acceptance can detect a changed/stale candidate. */
  evidenceHash: string;
  currentTextHash: string;
  eligibilityHash: string;

  /** Lever-specific operator detail (the exact Wix instruction lives here). */
  detail:
    | { kind: "meta"; source: string }
    | { kind: "internal_link"; destinationUrl: string; anchorText: string; wixInstructions: string; relationship: string }
    | { kind: "answer_block"; question: string; operation: string; exactInstruction: string; paragraphIndex: number }
    | { kind: "edit_field"; field: "title" | "h1" };
};

export type DailyExperimentPlanRecord = {
  version: 1;
  id: string; // content-addressed: `${tenantId}::${date}::${inputHash12}`
  tenantId: string;
  date: string; // YYYY-MM-DD (Pacific operating day, supplied by caller)
  status: DailyPlanStatus;

  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  abandonedAt?: string;
  completedAt?: string;

  inputHash: string;
  plannerVersion: string;

  /** The active-experiment topology frozen at planning time (so acceptance re-validates vs it). */
  activeExperimentSnapshot: {
    proofIds: string[];
    treatedUrls: string[];
    controlUrls: string[];
    influencedUrls: string[];
    capturedAt: string;
  };

  selected: PlannedExperimentRecord[];
  backups: PlannedExperimentRecord[];

  distribution: { byLever: Record<string, number>; byPageFamily: Record<string, number> };
  estimatedMinutes: number;

  acceptanceReceipt?: {
    idempotencyKey: string;
    reservationIds: string[];
    acceptedBy: "operator";
    validatedAt: string;
  };

  /**
   * Post-acceptance execution state (item-by-item apply→verify→activate→GSC). Optional + additive:
   * absent on a fresh preview/accepted plan; written by the activation/skip RPCs + execution actions.
   * Type lives in ./execution-state (type-only import - no runtime cycle).
   */
  execution?: import("./execution-state").PlanExecutionState;
};

export type ControlReservationRecord = {
  version: 1;
  id: string; // deterministic: `${tenantId}::${planId}::${plannedExperimentId}::${controlPath}`
  tenantId: string;
  planId: string;
  plannedExperimentId: string;
  treatedUrl: string;
  controlUrl: string;
  controlPath: string;
  status: ReservationStatus;

  reservedAt: string;
  reservedUntil: string;
  activatedAt?: string;
  activatedProofId?: string;
  releasedAt?: string;
  releaseReason?: string;
  invalidatedAt?: string;
  invalidationReason?: string;

  similarity: {
    score: number;
    pageFamilyMatch: boolean;
    impressionsRatio?: number;
    positionDifference?: number;
  };
};

export type PlanAcceptanceFailureReason =
  | "plan_not_found"
  | "plan_expired"
  | "plan_already_abandoned"
  | "plan_already_accepted"
  | "tenant_mismatch"
  | "input_hash_changed"
  | "candidate_no_longer_eligible"
  | "current_text_changed"
  | "evidence_changed"
  | "control_unavailable"
  | "influenced_page_conflict"
  | "insufficient_controls"
  | "reservation_conflict";

// ── deterministic helpers (no crypto dep; FNV-1a over a canonical string) ──

export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function normalizePath(u: string | null | undefined): string {
  if (!u) return "";
  return ((u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase();
}

export function reservationId(tenantId: string, planId: string, plannedExperimentId: string, controlPath: string): string {
  return `${tenantId}::${planId}::${plannedExperimentId}::${normalizePath(controlPath)}`;
}
