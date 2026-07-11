/**
 * Proof window roles (Lane P2, protocol Section 4.2 "Repeated looks").
 *
 * PURE, deterministic, no I/O. This is the CONTRACT PIN for the single-primary /
 * demote-only correction the validation protocol mandates over alpha spending.
 * It does NOT build the classifier (that is Lane P3) and it does NOT change any
 * verdict threshold; it only fixes, in types + a helper, WHICH window may do
 * what to the verdict enum:
 *
 *   - 28 days is the single PRIMARY decision window. The verdict enum
 *     (won / lost / inconclusive) is set exactly once, when 28 closes.
 *   - 7 and 14 days are CONTEXT-only early reads. They may NEVER write the
 *     verdict enum and NEVER enter won/lost counts on any surface.
 *   - 56 days is DEMOTE-ONLY: a won that has reversed by 56 demotes to
 *     "no clear effect (did not hold)". It never upgrades anything, so the joint
 *     rule "won at 28 AND held at 56" fires at most as often as "won at 28" and
 *     adds ZERO false-win alpha (protocol 4.2). Its power cost needs 56 day
 *     placebo history, which waits on backfill; until then a 56 day demotion is
 *     PROVISIONAL (see applyDemoteOnly56).
 *   - 84 days is durability CONTEXT-only, never touches the enum.
 */

import type { GscProofVerdict, ProofWindowDay } from "./measure";

export type WindowRole = "context" | "primary" | "demote_only";

/** The single window whose close sets the verdict enum. */
export const PRIMARY_WINDOW_DAY: ProofWindowDay = 28;

/** The role a window plays in the verdict. Total over ProofWindowDay. Pure. */
export function windowRole(day: ProofWindowDay): WindowRole {
  if (day === 28) return "primary";
  if (day === 56) return "demote_only";
  return "context"; // 7, 14, 84
}

/** True only for the primary window (28): the ONLY window allowed to SET the
 *  verdict enum. Context and demote-only windows return false. */
export function windowCanSetVerdict(day: ProofWindowDay): boolean {
  return windowRole(day) === "primary";
}

/** True only for a demote-only window (56): may take a won away, never grant one. */
export function windowCanDemote(day: ProofWindowDay): boolean {
  return windowRole(day) === "demote_only";
}

export type WindowPlanEntry = { day: ProofWindowDay; role: WindowRole };

/**
 * The window plan every new ship predeclares (protocol 4.2): 7 context,
 * 14 context, 28 primary, 56 demote_only, 84 context. Stamped once at ship into
 * the record's windowPlan field and never rewritten.
 */
export const DEFAULT_WINDOW_PLAN: ReadonlyArray<WindowPlanEntry> = [
  { day: 7, role: "context" },
  { day: 14, role: "context" },
  { day: 28, role: "primary" },
  { day: 56, role: "demote_only" },
  { day: 84, role: "context" },
];

export type DemoteOnlyInput = {
  /** The verdict set at the 28 day primary close. */
  primaryVerdict: GscProofVerdict;
  /** Did the 28 day win still hold when the 56 day window closed? */
  heldAt56: boolean;
  /** False until this tenant's history depth supports a 56 day placebo lane
   *  (protocol Section 2.2). A demotion computed before that is PROVISIONAL. */
  placeboHistorySupports56?: boolean;
};

export type DemoteOnlyResult = {
  /** The verdict after the demote-only 56 day check. */
  verdict: GscProofVerdict;
  /** True when the 56 day check actually took a won away. */
  demoted: boolean;
  /** True when a demotion was computed before 56 day placebo history supports
   *  the window (protocol 4.2): the demotion stands but is labeled provisional. */
  provisional: boolean;
};

/**
 * The demote-only 56 day rule. PURE. A won that did not hold at 56 demotes to
 * "inconclusive" ("no clear effect (did not hold)"); every other verdict passes
 * through untouched. It can NEVER upgrade a verdict (a lost or inconclusive at 28
 * stays exactly that regardless of the 56 day read), so it adds no false-win
 * alpha. A demotion computed before placebo history supports the 56 day window
 * is flagged provisional so the surface can say so.
 */
export function applyDemoteOnly56(input: DemoteOnlyInput): DemoteOnlyResult {
  const supports = input.placeboHistorySupports56 === true;
  if (input.primaryVerdict === "won" && !input.heldAt56) {
    return { verdict: "inconclusive", demoted: true, provisional: !supports };
  }
  return { verdict: input.primaryVerdict, demoted: false, provisional: false };
}
