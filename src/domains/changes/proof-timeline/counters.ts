/**
 * /changes proof timeline — top-of-page proof counters.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit (~/.claude/plans/i-want-a-maximum-depth-curried-curry.md):
 * the proof-timeline header carries three counters
 * ("Shipped this month", "Working", "Needs review") so the operator
 * gets the customer-shaped headline before scanning the timeline.
 *
 * Pure module. No I/O, no DOM, no React. Lives next to result-pill so
 * the timeline client can call both from one boundary, and tests can
 * pin truth tables in Node.
 *
 * The lifecycle vocabulary (`live_verified`, `pending_implementation`,
 * etc.) is internal to the classifier; it stays as code identifiers
 * and is never rendered as customer copy. The counter LABELS are the
 * customer surface; this module exposes both pieces and the renderer
 * picks the labels.
 */
import type { LifecycleTabClass } from "@/domains/attribution/lifecycle-classification";

export type ProofCounterInput = {
  /** ISO timestamp string from the changelog row. */
  timestamp: string;
  /** Classifier output for the row. `null` is treated as unclassified. */
  lifecycleClass: LifecycleTabClass | null;
};

export type ProofCounters = {
  /** Rows verified-live or detected by scan that landed in the
   *  current calendar month, relative to `now`. Excludes pending /
   *  needs-review / imported_legacy. */
  shippedThisMonth: number;
  /** Accepted-but-not-yet-on-the-page rows. */
  working: number;
  /** Needs-review rows (ambiguous scan match). */
  needsReview: number;
};

/**
 * Compute the three proof counters from already-classified rows.
 *
 * @param rows  An array of {timestamp, lifecycleClass} objects. The
 *              minimal projection of EnrichedChangeRow needed for
 *              counting — keeps this module testable in isolation
 *              from the heavy types in `scorecard-client`.
 * @param now   Override the "current time" for tests. Defaults to
 *              `new Date()`.
 */
export function computeProofCounters(
  rows: ReadonlyArray<ProofCounterInput>,
  now: Date = new Date(),
): ProofCounters {
  let shippedThisMonth = 0;
  let working = 0;
  let needsReview = 0;

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth(); // 0-indexed

  for (const row of rows) {
    if (row.lifecycleClass === "pending_implementation") {
      working += 1;
    } else if (row.lifecycleClass === "needs_review") {
      needsReview += 1;
    }

    // "Shipped" = the change is actually on the page (verified-live
    // or detected by scan). Pending rows are NOT shipments — they are
    // future shipments waiting on confirmation. Imported legacy
    // entries pre-date Beacon's tracking and are excluded too.
    if (
      row.lifecycleClass === "live_verified" ||
      row.lifecycleClass === "scan_confirmed"
    ) {
      const t = new Date(row.timestamp);
      if (
        !Number.isNaN(t.getTime()) &&
        t.getUTCFullYear() === currentYear &&
        t.getUTCMonth() === currentMonth
      ) {
        shippedThisMonth += 1;
      }
    }
  }

  return { shippedThisMonth, working, needsReview };
}

export const PROOF_COUNTER_LABEL: Record<keyof ProofCounters, string> = {
  shippedThisMonth: "Shipped this month",
  working: "Working",
  needsReview: "Needs review",
};
