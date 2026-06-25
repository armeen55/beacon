import type { TodayMove } from "./today-moves-data";
import type { GscCannibalizationCase } from "@/domains/recommendation-intelligence/gsc-cannibalization";

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

/**
 * Index cannibalization cases by each competing own-URL → the cases it's in (with
 * the OTHER competing pages named). Pure (canon + pretty injected) so it's unit-
 * testable. A self-competing case needs ≥2 own-URLs; the URL's own entry is
 * excluded from its "otherPages".
 */
export function indexCannibalizationByUrl(
  cases: ReadonlyArray<Pick<GscCannibalizationCase, "query" | "competingUrls">>,
  canon: (u: string) => string,
  pretty: (u: string) => string,
  maxOthers = 3,
): Map<string, { query: string; otherPages: string[] }[]> {
  const out = new Map<string, { query: string; otherPages: string[] }[]>();
  for (const c of cases) {
    for (const cu of c.competingUrls) {
      const key = canon(cu.url);
      const others = c.competingUrls.filter((x) => canon(x.url) !== key).map((x) => pretty(x.url));
      if (others.length === 0) continue;
      const arr = out.get(key) ?? [];
      arr.push({ query: c.query, otherPages: [...new Set(others)].slice(0, maxOthers) });
      out.set(key, arr);
    }
  }
  return out;
}
