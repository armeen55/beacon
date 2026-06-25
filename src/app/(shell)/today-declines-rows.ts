import type { TodayMove } from "./today-moves-data";

/**
 * Pure helpers for the "Recover lost ground" section — no server imports, so they
 * are safely unit-testable. The section component consumes these.
 */

export type RecoveryRow = {
  moveId: string;
  page: string;
  targetUrl: string;
  query: string;
  dropPct: number;
  priorClicks: number;
  recentClicks: number;
  positionSlip: number;
};

/**
 * Flatten the worklist's per-move declines into one recovery list, ranked by
 * clicks at stake (prior clicks desc) and capped.
 */
export function buildRecoveryRows(
  moves: ReadonlyArray<Pick<TodayMove, "id" | "pageLabel" | "targetUrl" | "declines">>,
  cap = 8,
): RecoveryRow[] {
  return moves
    .flatMap((m) =>
      m.declines.map((d) => ({
        moveId: m.id,
        page: m.pageLabel,
        targetUrl: m.targetUrl,
        query: d.query,
        dropPct: d.dropPct,
        priorClicks: d.priorClicks,
        recentClicks: d.recentClicks,
        positionSlip: d.positionSlip,
      })),
    )
    .sort((a, b) => b.priorClicks - a.priorClicks)
    .slice(0, cap);
}

/** Total monthly clicks slipping across the recovery rows (never negative). */
export function recoveryClicksLost(rows: ReadonlyArray<RecoveryRow>): number {
  return rows.reduce((s, r) => s + Math.max(0, r.priorClicks - r.recentClicks), 0);
}
