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

export type CannibalEntry = {
  query: string;
  otherPages: string[];
  /** True when THIS page is the best-ranking (natural canonical) of the group. */
  isLead: boolean;
  /** The best-ranking page's pretty name (the consolidation target). */
  leadPage: string;
  /** Plain-English consolidation directive (the ACTION, not just the diagnosis). */
  fix: string;
};

/**
 * Index cannibalization cases by each competing own-URL → the cases it's in, each
 * with a CONSOLIDATION DIRECTIVE: if this page is the best-ranking one, absorb the
 * others into it; otherwise point this page at the canonical lead (or differentiate
 * intent). Pure (canon + pretty injected) so it's unit-testable.
 */
export function indexCannibalizationByUrl(
  cases: ReadonlyArray<Pick<GscCannibalizationCase, "query" | "competingUrls" | "leadUrl">>,
  canon: (u: string) => string,
  pretty: (u: string) => string,
  maxOthers = 3,
): Map<string, CannibalEntry[]> {
  const out = new Map<string, CannibalEntry[]>();
  for (const c of cases) {
    const leadKey = canon(c.leadUrl);
    const leadPage = pretty(c.leadUrl);
    for (const cu of c.competingUrls) {
      const key = canon(cu.url);
      const others = [...new Set(c.competingUrls.filter((x) => canon(x.url) !== key).map((x) => pretty(x.url)))].slice(0, maxOthers);
      if (others.length === 0) continue;
      const isLead = key === leadKey;
      const fix = isLead
        ? `This is your best-ranking page for "${c.query}" — fold ${others.join(", ")} into it (redirect or internal-link) so they stop splitting its clicks.`
        : `Point this page at "${leadPage}" (your best-ranking one for "${c.query}") with an internal link, or differentiate their intent so they stop competing.`;
      const arr = out.get(key) ?? [];
      arr.push({ query: c.query, otherPages: others, isLead, leadPage, fix });
      out.set(key, arr);
    }
  }
  return out;
}
