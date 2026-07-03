/**
 * verdict-revisions (R14a, P1 trust receipts, 2026-07-03) - the APPEND-ONLY trail of
 * verdict CHANGES on a shipped-change record.
 *
 * The stored verdict gets rewritten by every re-measurement (that is correct - the
 * newest read is the best read), but rewriting it SILENTLY means an operator who saw
 * "won" on Jul 5 and sees "no clear effect" on Jul 19 has no idea whether they
 * misremembered or Beacon changed its mind. This module records exactly that flip,
 * once, at the measureRecord seam, and only when the verdict ACTUALLY changed:
 *
 *   { at, from, to, reason }   e.g. { at: "...", from: "won", to: "inconclusive",
 *                                     reason: "the 28-day read" }
 *
 * Rules (pinned by verdict-revisions.test.ts):
 *   - The FIRST measurement is never a revision (nothing was announced before it).
 *   - No change, no entry - re-measuring an unchanged verdict appends NOTHING.
 *   - Past entries are NEVER rewritten or dropped; we only ever append.
 *
 * PURE module: no I/O, no imports beyond the verdict type.
 */

import type { GscProofVerdict } from "./measure";

export type VerdictRevision = {
  /** ISO timestamp the re-measurement changed the stored verdict. */
  at: string;
  from: GscProofVerdict;
  to: GscProofVerdict;
  /** Tiny plain provenance: which read changed it ("the 28-day read") or the operator override. */
  reason: string;
};

/** Plain words for a verdict in operator-facing revision sentences (Beacon voice). */
export const VERDICT_PLAIN: Record<GscProofVerdict, string> = {
  won: "a win",
  lost: "hurting",
  inconclusive: "no clear effect",
  measuring: "still measuring",
  insufficient_data: "not enough data to judge",
};

/** Lower rank = worse news. won above everything, lost below everything, the three
 *  undecided states level in the middle - so "won -> inconclusive" and
 *  "measuring -> lost" both read as downward, but "inconclusive -> measuring"
 *  (a windows-reopen quirk) does not. */
const VERDICT_RANK: Record<GscProofVerdict, number> = {
  won: 2,
  measuring: 1,
  inconclusive: 1,
  insufficient_data: 1,
  lost: 0,
};

/** Did this revision take GOOD news away (a retracted win, or a slide into "hurting")?
 *  The /results "We got this wrong" recap only owns these - an upgrade needs no apology. */
export function isDownwardRevision(rev: Pick<VerdictRevision, "from" | "to">): boolean {
  return (VERDICT_RANK[rev.to] ?? 1) < (VERDICT_RANK[rev.from] ?? 1);
}

/**
 * The measureRecord seam. Returns the record's next verdictRevisions value:
 * the existing entries untouched, plus AT MOST one appended entry when the
 * stored verdict actually changed on a RE-measurement. Returns null when there
 * is nothing to keep (parity with the record's other nullable fields).
 */
export function appendVerdictRevision(args: {
  existing: VerdictRevision[] | null | undefined;
  /** The verdict as it was STORED before this measurement pass. */
  previousVerdict: GscProofVerdict;
  /** The stored measuredAt BEFORE this pass - null means this is the first
   *  measurement ever, which announces a verdict rather than revising one. */
  previousMeasuredAt: string | null;
  /** The verdict this pass computed (post operator-override). */
  nextVerdict: GscProofVerdict;
  /** The basis window that produced the new verdict (7/14/28), when one ran. */
  basisDay: number | null;
  /** True when the change is the operator's own "exclude from learning" pin. */
  overrideApplied: boolean;
  now: Date;
}): VerdictRevision[] | null {
  const existing = Array.isArray(args.existing) ? args.existing : [];
  const keepExisting = existing.length > 0 ? existing : null;
  if (args.previousMeasuredAt == null) return keepExisting; // first measure: an announcement, not a revision
  if (args.nextVerdict === args.previousVerdict) return keepExisting; // no change, no entry
  const reason = args.overrideApplied
    ? "you set this result aside from learning"
    : args.basisDay != null
      ? `the ${args.basisDay}-day read`
      : "a re-measurement";
  // APPEND-ONLY: never rewrite or drop a past entry.
  return [
    ...existing,
    { at: args.now.toISOString(), from: args.previousVerdict, to: args.nextVerdict, reason },
  ];
}

/**
 * Operator-facing sentences for the /results card expand, one per revision,
 * oldest first. Example: "I first called this a win; the 28-day read on
 * 2026-07-19 revised it to no clear effect."
 */
export function buildVerdictRevisionLines(
  revisions: ReadonlyArray<VerdictRevision>,
): string[] {
  return revisions.map((rev, i) => {
    const when = rev.at.slice(0, 10);
    const to = VERDICT_PLAIN[rev.to] ?? rev.to;
    const from = VERDICT_PLAIN[rev.from] ?? rev.from;
    return i === 0
      ? `I first called this ${from}; ${rev.reason} on ${when} revised it to ${to}.`
      : `Then ${rev.reason} on ${when} revised it from ${from} to ${to}.`;
  });
}
