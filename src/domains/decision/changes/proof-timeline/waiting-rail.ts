/**
 * /changes proof timeline, "Waiting for signal" right-rail builder.
 *
 * Bundle (2026-05-10), second pass at /changes per the maximum-depth UI audit. The right rail surfaces the rows the operator is actively waiting on, plus a plain-English line naming when the next Google
 * reading lands (from the proof ledger's own checkpoint schedule).
 *
 * Verdict-engine consolidation (2026-07-21, CORE 100K Lane F): the timing line used to come from the retired pattern-brain "ready on" guess. It now reads the row's proof-gsc `nextCheckpoint` date, the
 * same schedule Results renders, so the rail never promises a date the measurement engine did not set.
 *
 * Pure module. Consumes a minimal projection of EnrichedChangeRow so tests can pin behavior with plain JSON fixtures.
 *
 * Customer-vocabulary contract:
 *   • Narratives use plain English ("I will take the next Google
 *     reading on July 28."). No maturity enums, no internal
 *     checkpoint/window vocabulary.
 *   • Items have a stable href for navigation to /changes/[id].
 */

export type WaitingRailInput = {
  /** Change row id (drives /changes/[id] href). */
  id: string;
  /** Plain-English change title. */
  title: string;
  /** Customer-friendly target URL or path, when present. */
  targetUrl: string | null;
  /** ISO timestamp from the changelog row. */
  shippedAt: string;
  /** Resolved pill kind from result-pill resolver. */
  pillKind:
    | "helping"
    | "hurting"
    | "too_early"
    | "no_signal_yet"
    | "needs_review"
    | "live"
    | "watching";
  /** Soonest future proof checkpoint (YYYY-MM-DD), when one is scheduled. */
  nextCheckpoint: string | null;
};

export type WaitingRailItem = {
  id: string;
  title: string;
  targetUrl: string | null;
  shippedAt: string;
  narrative: string;
};

/**
 * Filter + project the rows that belong in the right-rail. Sorted newest-first because the operator cares most about the most-recent waiting bet. Caps at `limit` items so the rail stays calm.
 */
export function buildWaitingRail(
  rows: ReadonlyArray<WaitingRailInput>,
  limit: number = 5,
): WaitingRailItem[] {
  const items: WaitingRailItem[] = [];
  for (const row of rows) {
    if (
      row.pillKind !== "too_early" &&
      row.pillKind !== "watching" &&
      row.pillKind !== "live"
    ) {
      continue;
    }
    items.push({
      id: row.id,
      title: row.title,
      targetUrl: row.targetUrl,
      shippedAt: row.shippedAt,
      narrative: narrativeFor(row),
    });
  }

  // Newest-first sort so the most recent waiting bet leads the rail.
  items.sort(
    (a, b) =>
      new Date(b.shippedAt).getTime() - new Date(a.shippedAt).getTime(),
  );

  return items.slice(0, limit);
}

/**
 * Convert the row's pill kind + next-checkpoint date into a single sentence the operator reads under the title. Always plain English, never a promise the measurement engine did not schedule.
 */
function narrativeFor(row: WaitingRailInput): string {
  const formatted = row.nextCheckpoint
    ? formatCheckpointDate(row.nextCheckpoint)
    : null;
  if (formatted) {
    return `I will take the next Google reading on ${formatted}.`;
  }
  if (row.pillKind === "live") {
    return "Live on your site. This one is not on my measured list yet.";
  }
  return "I have not scheduled a Google reading for this one yet.";
}

/** "2026-07-28" -> "July 28". Null on an unparseable date. */
function formatCheckpointDate(isoDate: string): string | null {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
