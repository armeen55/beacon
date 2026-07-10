/**
 * Revert policy (2026-07-02, BEACON 500 item 11; revised 2026-07-09 per the
 * operator product spec E-36: "NEVER auto-revert; ask first").
 *
 * PURE decision layer for "a shipped change is measuring negative - do we
 * offer a one-click restore, or stay quiet?". No I/O here; the executor
 * (run-revert.ts) gathers the inputs (measurement presentation, snapshot
 * existence) and ships a restore ONLY when the operator explicitly clicks
 * (through the existing push path: executePush keeps the Ritz hard-refuse,
 * the daily cap, the pre-push snapshot, and the ledger).
 *
 * The ladder, most-conservative-gate-wins:
 *   none    - not negative, too early, already restored, or no saved copy.
 *   propose - a 7 or 14 or 28 day check reads negative and a saved copy of
 *             the old version exists: offer "Put the old version back" as
 *             one operator click. This is the ONLY way a revert ever ships;
 *             Beacon never puts a change back on its own, no matter how
 *             autopilot is armed for the site.
 *
 * Pinned by tests/domains/autopilot/revert-policy.test.ts.
 */

import { pickProofMetric, type ProofMetric } from "@/domains/proof-gsc/measure";
import { AUTOPILOT_RITZ_TENANT_ID, type AutopilotConfig } from "./autopilot-policy";

/** A negative reading younger than this never earns even a proposal. */
export const MIN_PROPOSE_WINDOW_DAY = 7;

export type RevertAction = "propose" | "none";

export type RevertDecisionInput = {
  /** Optional tenant id; Ritz is advise-only and never gets a revert offer. */
  tenantId?: string | null;
  /** Which way the basis window moved (measurement presentation `direction`). */
  direction: "positive" | "negative" | "neutral" | "unknown";
  /** The closed proof window the reading is based on (7 | 14 | 28), or null. */
  windowDay: number | null;
  /** Comparison-page cleanliness from the measurement presentation. Kept for
   *  callers/telemetry; no longer changes the decision (E-36: every eligible
   *  negative gets the same one-click propose, never an automatic push). */
  attributionQuality: "clean" | "limited" | "compound";
  /** The change type (lever), e.g. edit_title. */
  lever: string;
  /** The operator's autopilot config (item 1 store). Kept for callers; no
   *  longer read here (E-36: autopilot arming never auto-executes a revert). */
  config: Partial<AutopilotConfig> | null | undefined;
  /** A pre-push snapshot exists, so the exact old value can be restored. */
  snapshotAvailable: boolean;
  /** The old version was already put back for this change (idempotency). */
  alreadyReverted: boolean;
  /** Used for the "on July 2" date in the lesson line. */
  now: Date;
  /** Optional plain magnitude for the copy, e.g. "3 clicks" (see plainLiftLabel). */
  liftLabel?: string | null;
};

export type RevertDecision = {
  action: RevertAction;
  /** Operator-readable one-liner: why this action (or why nothing). */
  reason: string;
  /** The lesson sentence recorded on the revert's own shipped-change record. */
  lessonLine: string;
};

// ---------------------------------------------------------------------------
// Plain-language pieces (operator-facing copy - no code words, no dashes)
// ---------------------------------------------------------------------------

const LEVER_PHRASE: Record<string, string> = {
  edit_title: "title change",
  title: "title change",
  edit_meta: "description change",
  improve_meta: "description change",
  meta: "description change",
  change_h1: "headline change",
  h1: "headline change",
  add_answer_block: "direct answer section",
  intro_answer_block: "direct answer section",
  answer_block: "direct answer section",
  add_faq: "FAQ change",
  rewrite_faq: "FAQ change",
  faq: "FAQ change",
  add_schema: "structured data change",
  fix_schema: "structured data change",
  schema: "structured data change",
  add_internal_link: "internal link change",
  add_internal_links: "internal link change",
  update_intro: "intro change",
};

/** "title change", "description change", ... falls back to "change". */
export function leverPhrase(lever: string): string {
  return LEVER_PHRASE[(lever || "").toLowerCase()] ?? "change";
}

const RESTORED_NOUN: Record<string, string> = {
  edit_title: "the old title",
  title: "the old title",
  edit_meta: "the old description",
  improve_meta: "the old description",
  meta: "the old description",
  change_h1: "the old headline",
  h1: "the old headline",
};

/** What gets put back, in plain words: "the old title" ... "the old version". */
export function restoredNoun(lever: string): string {
  return RESTORED_NOUN[(lever || "").toLowerCase()] ?? "the old version";
}

const LESSON_TAIL: Record<string, string> = {
  "the old title": "this style of title is not working on pages like this.",
  "the old description": "this style of description is not working on pages like this.",
  "the old headline": "this style of headline is not working on pages like this.",
};

const METRIC_PHRASE: Record<ProofMetric, string> = {
  ctr: "the click rate",
  position: "the ranking",
  clicks: "clicks",
};

/**
 * A negative lift as a plain magnitude for operator copy ("3 clicks",
 * "0.4 percentage points of click rate", "1.2 spots in ranking").
 * Returns null for non-negative or negligible lifts. Pure.
 */
export function plainLiftLabel(metric: ProofMetric, lift: number): string | null {
  if (!Number.isFinite(lift) || lift >= 0) return null;
  const mag = Math.abs(lift);
  if (metric === "ctr") {
    const pp = Math.round(mag * 1000) / 10;
    if (pp <= 0) return null;
    return `${pp} percentage point${pp === 1 ? "" : "s"} of click rate`;
  }
  if (metric === "position") {
    const spots = Math.round(mag * 10) / 10;
    if (spots <= 0) return null;
    return `${spots} spot${spots === 1 ? "" : "s"} in ranking`;
  }
  const clicks = Math.round(mag);
  if (clicks <= 0) return null;
  return `${clicks} click${clicks === 1 ? "" : "s"}`;
}

/** "July 2" in the Pacific calendar (ship dates live in Pacific time). */
function monthDay(now: Date): string {
  return now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

/**
 * The lesson sentence for the revert record, e.g. "That title change hurt the
 * click rate (0.4 percentage points of click rate behind comparison pages),
 * so I put the old title back on July 2. Lesson: this style of title is not
 * working on pages like this." Pure.
 */
export function buildLessonLine(args: {
  lever: string;
  now: Date;
  liftLabel?: string | null;
}): string {
  const phrase = leverPhrase(args.lever);
  const noun = restoredNoun(args.lever);
  const metric = METRIC_PHRASE[pickProofMetric(args.lever)];
  const liftPart = args.liftLabel ? ` (${args.liftLabel} behind comparison pages)` : "";
  const tail = LESSON_TAIL[noun] ?? "this kind of change is not working on pages like this.";
  return `That ${phrase} hurt ${metric}${liftPart}, so I put ${noun} back on ${monthDay(args.now)}. Lesson: ${tail}`;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a negative measurement earns a one-click restore offer, or
 * nothing. Deterministic given its inputs; gates in most-conservative order.
 * Per E-36 (operator product spec, 2026-07-09: "NEVER auto-revert; ask
 * first"), the only positive outcome is "propose" - Beacon never puts a
 * change back on its own, no matter how autopilot is armed for the site.
 */
export function decideRevert(input: RevertDecisionInput): RevertDecision {
  const none = (reason: string): RevertDecision => ({ action: "none", reason, lessonLine: "" });

  if (input.tenantId === AUTOPILOT_RITZ_TENANT_ID) {
    return none(
      "This site is advise only. I never publish or restore here; copy the before text and make the change by hand.",
    );
  }
  if (input.alreadyReverted) {
    return none("I already put the old version back for this change.");
  }
  if (input.direction !== "negative") {
    return none("This change is not measuring negative, so there is nothing to put back.");
  }
  if (input.windowDay == null || input.windowDay < MIN_PROPOSE_WINDOW_DAY) {
    return none("No check-in window has closed yet, so it is too early to judge this change.");
  }
  if (!input.snapshotAvailable) {
    return none(
      "I do not have a saved copy of the old version for this change. Use the before text to restore it by hand.",
    );
  }

  const phrase = leverPhrase(input.lever);
  const noun = restoredNoun(input.lever);
  const lessonLine = buildLessonLine({
    lever: input.lever,
    now: input.now,
    liftLabel: input.liftLabel ?? null,
  });

  const behind = input.liftLabel ? `${input.liftLabel} behind` : "behind";
  return {
    action: "propose",
    reason: `This ${phrase} is ${behind} its comparison pages at the ${input.windowDay} day check. I never put a change back on my own. Want me to prepare the restore? One click puts ${noun} back, and nothing happens until you say so.`,
    lessonLine,
  };
}
