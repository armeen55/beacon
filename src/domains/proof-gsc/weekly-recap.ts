/**
 * weekly-recap (FINAL PREMIUM PLAN items 7 + 8) - pure math for the Monday recap band and the
 * header streak line, computed from the shipped-change ledger. No I/O. Pinned by
 * weekly-recap.test.ts.
 */

export type RecapRow = {
  shippedAt: string; // ISO
  verdict: string; // won | lost | inconclusive | measuring | insufficient_data
  path: string;
};

export type WeeklyRecap = {
  shipped: number;
  won: number;
  wonPaths: string[];
  noLift: number;
  stillMeasuring: number;
};

const DAY_MS = 86_400_000;

/** Count of changes shipped in the trailing `days` (item 8's streak). */
export function shippedInLastDays(rows: Array<Pick<RecapRow, "shippedAt">>, nowMs: number, days = 14): number {
  const since = nowMs - days * DAY_MS;
  let n = 0;
  for (const r of rows) {
    const t = Date.parse(r.shippedAt);
    if (Number.isFinite(t) && t >= since && t <= nowMs) n += 1;
  }
  return n;
}

/** Recap of LAST calendar week (the 7 days ending yesterday, simple + honest). */
export function buildWeeklyRecap(rows: RecapRow[], nowMs: number): WeeklyRecap {
  const end = nowMs;
  const start = end - 7 * DAY_MS;
  const week = rows.filter((r) => {
    const t = Date.parse(r.shippedAt);
    return Number.isFinite(t) && t >= start && t < end;
  });
  const won = week.filter((r) => r.verdict === "won");
  const noLift = week.filter((r) => r.verdict === "lost" || r.verdict === "inconclusive" || r.verdict === "insufficient_data");
  const measuring = week.filter((r) => r.verdict === "measuring");
  return {
    shipped: week.length,
    won: won.length,
    wonPaths: won.map((r) => r.path).slice(0, 3),
    noLift: noLift.length,
    stillMeasuring: measuring.length,
  };
}

/** One plain sentence for the band. Null when nothing shipped (band self-hides). */
export function weeklyRecapSentence(r: WeeklyRecap): string | null {
  if (r.shipped === 0) return null;
  const parts: string[] = [`${r.shipped} change${r.shipped === 1 ? "" : "s"} shipped`];
  if (r.won > 0) parts.push(`${r.won} win${r.won === 1 ? "" : "s"}${r.wonPaths.length ? ` (${r.wonPaths.join(", ")})` : ""}`);
  if (r.noLift > 0) parts.push(`${r.noLift} with no clear lift`);
  if (r.stillMeasuring > 0) parts.push(`${r.stillMeasuring} still measuring`);
  return `Last 7 days: ${parts.join(", ")}.`;
}
