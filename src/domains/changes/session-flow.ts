/**
 * session-flow (BEACON 500 D6, the daily ritual loop, static mode) - PURE logic for the
 * /changes "no dead ends" session: after the operator acts on a row (marks it done, skips it,
 * or says not-now), always point at the next actionable row. No I/O, no ranking of its own, it
 * walks the SAME ordered list the caller already ranked/filtered (strategy.ts's `rankChanges` +
 * the goal/status predicates), so "next best" always agrees with what the list itself shows.
 *
 * A row counts as "actionable" for this loop when it is still something the operator can DO
 * something with right now (to do or ready/apply/verify), never blocked, measuring, a settled
 * result, or already excluded this session. That mirrors the same statuses `strategy.ts`'s
 * `rankChanges` keeps in the pool; this module never re-derives status, just walks the caller's
 * order and skips ids already handled this session.
 */
import type { CanonicalChange, CanonicalStatus } from "./canonical-change";

const ACTIONABLE_STATUSES = new Set<CanonicalStatus>(["suggested", "ready", "apply", "verify"]);

export function isActionableRow(c: Pick<CanonicalChange, "status">): boolean {
  return ACTIONABLE_STATUSES.has(c.status);
}

/**
 * Find the next actionable row after acting on `justHandledId`, walking `orderedChanges` (already
 * ranked + filtered by the caller, same order the list renders). `excludeIds` carries every row
 * already handled this session (done, skipped, not-now) so a repeat action never re-offers a row
 * the operator already moved past, even if it's still technically actionable (e.g. "not now").
 *
 * Returns null only when truly nothing actionable remains, the honest end of the queue, not a
 * dead end mid-list.
 */
export function findNextActionable(
  orderedChanges: ReadonlyArray<CanonicalChange>,
  justHandledId: string | null,
  excludeIds: ReadonlySet<string> = new Set(),
): CanonicalChange | null {
  for (const c of orderedChanges) {
    if (c.id === justHandledId) continue;
    if (excludeIds.has(c.id)) continue;
    if (!isActionableRow(c)) continue;
    return c;
  }
  return null;
}

/** One short line naming the next best row - the D6 "Next best: <exactWhat>" banner text. */
export function nextBestLine(next: CanonicalChange | null): string | null {
  if (!next) return null;
  const page = next.pageLabel || next.pagePath;
  return `Next best: ${next.recommendation} on ${page}.`;
}

export type SessionAction = "done" | "skip" | "not_now";

/**
 * No-dead-end invariant, exposed as pure logic so a component (or test) can assert it directly:
 * given the ordered list and everything handled so far, is there ALWAYS still a next actionable
 * row offered until the queue genuinely empties? Returns true either when a next row exists, or
 * when there is honestly nothing left (both are "no dead end"; a dead end is only a UI that goes
 * silent while actionable rows remain).
 */
export function noDeadEnd(
  orderedChanges: ReadonlyArray<CanonicalChange>,
  handledIds: ReadonlySet<string>,
): boolean {
  const remaining = orderedChanges.filter((c) => !handledIds.has(c.id) && isActionableRow(c));
  if (remaining.length === 0) return true; // honest end of queue
  const next = findNextActionable(orderedChanges, null, handledIds);
  return next !== null;
}
