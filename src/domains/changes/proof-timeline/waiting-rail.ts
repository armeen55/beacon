/**
 * /changes proof timeline — "Waiting for signal" right-rail builder.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit (~/.claude/plans/i-want-a-maximum-depth-curried-curry.md).
 * The right rail surfaces the rows the operator is actively waiting
 * on, plus a plain-English line ("Similar changes usually show signal
 * around day N") rewritten from the existing pattern-timing
 * `readyOn` field.
 *
 * Pure module. Consumes a minimal projection of EnrichedChangeRow so
 * tests can pin behavior without rebuilding the whole scorecard
 * pipeline.
 *
 * Customer-vocabulary contract:
 *   • Narratives use plain English ("Similar changes usually show
 *     signal around day N"). No median-landing-day terminology, no
 *     references to the pattern brain, no edit-type/asset-type
 *     vocabulary.
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
  /** Pattern-timing prediction, when one exists. */
  readyOn: {
    daysFromChange: number;
    confidenceTier: "high" | "medium" | "low" | null;
  } | null;
};

export type WaitingRailItem = {
  id: string;
  title: string;
  targetUrl: string | null;
  shippedAt: string;
  narrative: string;
};

/**
 * Filter + project the rows that belong in the right-rail. Sorted
 * newest-first because the operator cares most about the most-recent
 * waiting bet. Caps at `limit` items so the rail stays calm.
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
 * Convert the row's pill kind + readyOn into a single sentence the
 * operator reads under the title. Always plain English.
 */
function narrativeFor(row: WaitingRailInput): string {
  if (row.readyOn) {
    const days = row.readyOn.daysFromChange;
    const tierClause =
      row.readyOn.confidenceTier === "high"
        ? " in your history"
        : row.readyOn.confidenceTier === "medium"
          ? " in your history"
          : "";
    return `Similar changes usually show signal around day ${days}${tierClause}.`;
  }
  if (row.pillKind === "live") {
    return "Live on your site. Beacon is watching for AI to respond.";
  }
  return "Beacon is watching for the first signal.";
}
