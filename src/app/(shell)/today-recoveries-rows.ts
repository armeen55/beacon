/**
 * today-recoveries-rows (2026-06-25) — the emotional payoff of the recover loop:
 * pages you SHIPPED a fix on that have since climbed back in Google. Pure +
 * dependency-free (type-only inputs) so it's unit-testable without the ledger or
 * GSC loaders. Derived entirely from existing data (shipped ledger + before/after
 * GSC clicks around the ship date) — NO new storage.
 */

export type RecoveryStatus = "recovered" | "improving" | "flat" | "slipping";

export type RecoveryInput = {
  page: string;
  label: string;
  /** Clicks in the 28d window BEFORE the change shipped. */
  beforeClicks: number;
  /** Clicks in the 28d window AFTER the change shipped. */
  afterClicks: number;
};

export type RecoveryWin = {
  page: string;
  label: string;
  beforeClicks: number;
  afterClicks: number;
  /** Signed % change after vs before (rounded). */
  deltaPct: number;
  status: RecoveryStatus;
};

// A change must move clicks by at least this fraction to count as real movement
// (filters GSC noise on low-traffic pages).
const MEANINGFUL = 0.1; // 10%

/**
 * Classify a page's post-ship movement. "recovered" = a strong climb (≥25% AND
 * ≥5 net clicks); "improving" = a real but smaller climb; "slipping" = it fell;
 * else "flat". Requires a non-trivial before-baseline so we don't over-celebrate
 * a page that went 1→3 clicks.
 */
export function classifyRecovery(beforeClicks: number, afterClicks: number): RecoveryStatus {
  const before = Math.max(0, beforeClicks);
  const after = Math.max(0, afterClicks);
  const net = after - before;
  const base = Math.max(before, 1);
  const pct = net / base;
  if (pct <= -MEANINGFUL) return "slipping";
  if (pct >= 0.25 && net >= 5) return "recovered";
  // Net floor of 3 so a tiny 1→3 page isn't celebrated as "improving".
  if (pct >= MEANINGFUL && net >= 3) return "improving";
  return "flat";
}

function deltaPct(before: number, after: number): number {
  const base = Math.max(before, 1);
  return Math.round(((after - before) / base) * 100);
}

/**
 * Build the celebratory list: only pages that recovered or are improving, ranked
 * by net clicks regained (desc).
 */
export function buildRecoveryWins(inputs: RecoveryInput[], opts: { cap?: number } = {}): RecoveryWin[] {
  const cap = opts.cap ?? 6;
  const wins: RecoveryWin[] = [];
  for (const i of inputs) {
    const status = classifyRecovery(i.beforeClicks, i.afterClicks);
    if (status !== "recovered" && status !== "improving") continue;
    wins.push({
      page: i.page,
      label: i.label,
      beforeClicks: i.beforeClicks,
      afterClicks: i.afterClicks,
      deltaPct: deltaPct(i.beforeClicks, i.afterClicks),
      status,
    });
  }
  wins.sort((a, b) => b.afterClicks - b.beforeClicks - (a.afterClicks - a.beforeClicks));
  return wins.slice(0, cap);
}

/** Total net monthly clicks regained across the recovery wins. */
export function recoveryClicksRegained(wins: RecoveryWin[]): number {
  return wins.reduce((s, w) => s + Math.max(0, w.afterClicks - w.beforeClicks), 0);
}
