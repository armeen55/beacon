/**
 * /changes proof timeline — top-of-page proof counters.
 *
 * Polish bundle (2026-05-11) — hosted visual review caught the
 * v1 counter triplet ("Shipped this month / Working / Needs
 * review") reading as 0/0/0 even though the timeline showed many
 * change cards. Root cause: every shipped change in the Ritz
 * workspace was stamped in April, the page was viewed in May, so
 * the calendar-month anchor honestly counted zero — but a
 * counter strip of "0 / 0 / 0" makes the product feel empty even
 * when the underlying data is rich.
 *
 * Fix: switch to a calendar-free triplet that reflects the
 * shape of the page in front of the customer:
 *
 *   • Recent changes  — every row in the timeline view.
 *   • Watching        — rows where Beacon is still looking for
 *                       a result (pill kind ∈ {watching, too_early,
 *                       live, no_signal_yet}).
 *   • Needs attention — rows the customer should look at
 *                       (pill kind ∈ {hurting, needs_review}).
 *
 * The "Helping" rows DON'T have their own counter — the customer
 * sees those directly in the timeline cards (green pill +
 * positive blurb), so a separate "Helping" counter would be
 * redundant. The three counters answer the three questions a
 * customer asks when they open this page: "How many changes are
 * tracked?", "How many is Beacon still measuring?", and "How
 * many do I need to look at right now?".
 *
 * Pure module. No I/O, no DOM, no React. Lives next to result-pill
 * and title-projection so the timeline client can call them all
 * from one boundary, and tests can pin truth tables in Node.
 */
import type { ProofPillKind } from "@/domains/changes/proof-timeline/result-pill";

export type ProofCounterInput = {
  /** Resolved pill kind from the result-pill resolver. */
  pillKind: ProofPillKind;
};

export type ProofCounters = {
  /** Total rows in the timeline view. Equals `rows.length` for
   *  any non-empty page. */
  recentChanges: number;
  /** Rows Beacon is still measuring — calm, in-flight bucket. */
  watching: number;
  /** Rows the customer should review — hurting + needs_review. */
  needsAttention: number;
};

/**
 * Customer-facing pill-kind sets that drive the two action-
 * meaningful counters. Exported so tests and consumers can verify
 * the mapping without re-deriving it.
 */
export const WATCHING_PILL_KINDS: ReadonlySet<ProofPillKind> = new Set<ProofPillKind>([
  "watching",
  "too_early",
  "live",
  "no_signal_yet",
]);

export const NEEDS_ATTENTION_PILL_KINDS: ReadonlySet<ProofPillKind> = new Set<ProofPillKind>([
  "hurting",
  "needs_review",
]);

/**
 * Compute the three proof counters from already-resolved pill
 * kinds. Pure projection — no time math, no calendar gates, no
 * lifecycle classification leaks.
 */
export function computeProofCounters(
  rows: ReadonlyArray<ProofCounterInput>,
): ProofCounters {
  let watching = 0;
  let needsAttention = 0;
  for (const row of rows) {
    if (WATCHING_PILL_KINDS.has(row.pillKind)) watching += 1;
    if (NEEDS_ATTENTION_PILL_KINDS.has(row.pillKind)) needsAttention += 1;
  }
  return {
    recentChanges: rows.length,
    watching,
    needsAttention,
  };
}

export const PROOF_COUNTER_LABEL: Record<keyof ProofCounters, string> = {
  recentChanges: "Recent changes",
  watching: "Watching for signal",
  needsAttention: "Needs attention",
};
