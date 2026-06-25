/**
 * today-measuring-hold (2026-06-25) — Phase 2 of the living loop.
 *
 * A page with an OPEN measurement (a shipped_changes record still "measuring",
 * within the hold window) must NOT receive another Move — a second change to a
 * page mid-experiment contaminates the diff-in-diff and destroys the verdict.
 * This pure helper builds the set of normalized owned-page paths currently on
 * hold, so the cockpit/queue can suppress (and honestly label) those Moves.
 *
 * The window auto-releases the hold after `holdDays` even if a verdict never
 * lands (a stuck "measuring" record shouldn't freeze a page forever).
 */

export type MeasuringLedgerRow = {
  path: string;
  shippedAt: string;
  verdict: string;
};

/** Normalize a path the same way across the ledger + a Move's URL. */
export function normalizeHoldPath(p: string): string {
  return (p || "").replace(/\/+$/, "") || "/";
}

const DEFAULT_HOLD_DAYS = 28;

/**
 * Set of normalized paths whose page is mid-measurement (verdict still
 * "measuring" AND shipped within `holdDays`). Pure + dependency-free.
 */
export function buildMeasuringHold(
  ledger: ReadonlyArray<MeasuringLedgerRow>,
  nowMs: number,
  holdDays: number = DEFAULT_HOLD_DAYS,
): Set<string> {
  const cutoffMs = holdDays * 24 * 60 * 60 * 1000;
  const held = new Set<string>();
  for (const r of ledger) {
    if (!r || r.verdict !== "measuring" || !r.path) continue;
    const t = Date.parse(r.shippedAt ?? "");
    if (!Number.isFinite(t)) continue; // unparseable date → don't hold (fail-open to action)
    if (nowMs - t > cutoffMs) continue; // window elapsed → release the hold
    held.add(normalizeHoldPath(r.path));
  }
  return held;
}

/** Is this owned-page URL currently held for measurement? */
export function isHeldForMeasurement(url: string, held: Set<string>): boolean {
  if (held.size === 0) return false;
  try {
    return held.has(normalizeHoldPath(new URL(url).pathname));
  } catch {
    return held.has(normalizeHoldPath(url));
  }
}
