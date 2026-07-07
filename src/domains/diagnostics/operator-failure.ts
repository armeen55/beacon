/**
 * operator-failure (2026-07-01, Move 3) — ONE small, pure translator from an internal
 * reason code / thrown error into operator-facing copy. Internal codes (RPC names,
 * Supabase/PostgREST errors, scanner statuses, action reason enums) must be LOGGED via
 * `technicalCode`, never rendered as the primary message. Deterministic; no I/O.
 *
 * Used wherever an action result `reason`/`error` could otherwise reach the UI raw
 * (daily-plan panel, proof recompute, route error boundary). Keep this map small —
 * add a row when a new reason can surface to the operator, not for every internal code.
 */

export type OperatorFailureKind =
  | "temporary_unavailable" // a source/service failed transiently — safe to retry
  | "stale_data" // last-known data shown; a fresh read failed
  | "waiting_for_source" // expected data hasn't arrived yet — NOT an error
  | "action_blocked" // a real product rule prevents the action
  | "action_needs_review" // the plan/recommendation changed; confirm again
  | "verification_pending" // the live site may not have propagated yet
  | "verification_mismatch" // the expected change is genuinely not visible
  | "no_data_yet" // valid empty state, not a failure
  | "unexpected_error"; // genuine unknown failure

export type OperatorFailure = {
  kind: OperatorFailureKind;
  title: string;
  message: string;
  nextAction: string | null;
  retryable: boolean;
  /** The internal code — for logging/telemetry, NOT the primary user message. */
  technicalCode: string | null;
};

type Copy = Pick<OperatorFailure, "kind" | "title" | "message" | "nextAction" | "retryable">;

/** Known action reason codes → operator copy. The single source of failure language. */
const REASON_COPY: Record<string, Copy> = {
  // ── plan lifecycle ──
  // Cold-Today (2026-07-07): a brand-new tenant clicks "Show me today's changes"
  // before enough data has arrived to plan a clean batch. This is the expected cold
  // state, NOT an error, so it reads as calm "still gathering data", never alarming.
  no_eligible_today: { kind: "waiting_for_source", title: "Nothing is queued for today yet.", message: "I don't have a clean change to suggest yet. I'm still gathering data. Connect Google Search Console so I can see which pages to work on.", nextAction: "Connect Search Console", retryable: true },
  plan_expired: { kind: "action_needs_review", title: "This plan needed fresh comparison pages.", message: "Beacon refreshed today’s batch. Review what changed before accepting.", nextAction: "Review refreshed plan", retryable: false },
  plan_refreshed: { kind: "action_needs_review", title: "Beacon refreshed today’s plan.", message: "It had timed out, so Beacon rebuilt it with fresh comparison pages. Review the list and accept again.", nextAction: "Review refreshed plan", retryable: false },
  plan_refreshed_empty: { kind: "waiting_for_source", title: "No clean experiments right now.", message: "There aren’t enough untouched comparison pages to plan a batch yet. Try again later.", nextAction: "Try again later", retryable: true },
  plan_not_found: { kind: "action_needs_review", title: "That plan is no longer available.", message: "Plan a fresh batch to continue.", nextAction: "Plan today’s experiments", retryable: false },
  plan_already_accepted: { kind: "action_needs_review", title: "This plan is already accepted.", message: "Scroll down to the checklist to apply each change.", nextAction: null, retryable: false },
  plan_already_abandoned: { kind: "action_needs_review", title: "This plan was discarded.", message: "Plan a new batch to continue.", nextAction: "Plan today’s experiments", retryable: false },
  input_hash_changed: { kind: "action_needs_review", title: "The plan changed since you opened it.", message: "Beacon refreshed it. Review the updated list and accept again.", nextAction: "Review refreshed plan", retryable: false },
  refresh_failed: { kind: "temporary_unavailable", title: "Couldn’t refresh the plan just now.", message: "Your last saved plan is still shown. Try “Re-plan” in a moment.", nextAction: "Re-plan", retryable: true },
  // ── apply / verify ──
  verification_pending: { kind: "verification_pending", title: "The change may still be publishing.", message: "Beacon couldn’t confirm the live version yet. Wix can take a few minutes to update.", nextAction: "Check again", retryable: true },
  verification_failed: { kind: "verification_mismatch", title: "The live page doesn’t match the planned change yet.", message: "Nothing was marked shipped. Fix it in Wix, then retry verification.", nextAction: "Retry verification", retryable: true },
  proof_id_collision: { kind: "action_blocked", title: "This page already has a change recorded today.", message: "Beacon can’t start a second measurement for the same page on the same day.", nextAction: "View measurement", retryable: false },
  topology_unavailable: { kind: "temporary_unavailable", title: "Couldn’t read the experiment ledger just now.", message: "Try again in a moment.", nextAction: "Try again", retryable: true },
  insufficient_controls: { kind: "action_blocked", title: "Not enough clean comparison pages.", message: "Beacon can’t measure this honestly right now. Re-plan to pick fresh comparison pages.", nextAction: "Re-plan", retryable: false },
  reservation_state_inconsistent: { kind: "action_needs_review", title: "This item’s comparison pages are out of sync.", message: "Re-plan this item to reset its comparison pages.", nextAction: "Re-plan", retryable: false },
  item_skipped: { kind: "no_data_yet", title: "This item was skipped.", message: "Its comparison pages were released. Nothing was changed.", nextAction: null, retryable: false },
  item_not_found: { kind: "action_needs_review", title: "That item is no longer in the plan.", message: "Refresh and try again.", nextAction: "Refresh", retryable: true },
};

const FALLBACK: Copy = {
  kind: "unexpected_error",
  title: "Something didn’t go through.",
  message: "Your data is safe and nothing was published. Try again in a moment.",
  nextAction: "Try again",
  retryable: true,
};

/** Translate a known action `reason` code into operator copy. The raw code is kept in
 *  `technicalCode` for logging only. Unknown codes fall back to a safe, non-jargon message. */
export function failureForReason(reason: string | null | undefined): OperatorFailure {
  const code = (reason ?? "").trim();
  const copy = (code && REASON_COPY[code]) || FALLBACK;
  return { ...copy, technicalCode: code || null };
}

/** Translate a thrown error (or an action error string) into operator copy. Never renders
 *  the raw message; preserves it in `technicalCode` for logging. */
export function toOperatorFailure(error: unknown): OperatorFailure {
  // An action may return a known reason code as a string — prefer the mapped copy.
  if (typeof error === "string" && REASON_COPY[error.trim()]) return failureForReason(error);
  const technicalCode =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  return { ...FALLBACK, technicalCode };
}

/** True when this reason maps to a known, non-`unexpected_error` operator message. */
export function isKnownReason(reason: string | null | undefined): boolean {
  return !!(reason && REASON_COPY[reason.trim()]);
}
