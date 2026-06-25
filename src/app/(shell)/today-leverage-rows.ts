/**
 * today-leverage-rows (2026-06-25) — signal FUSION across the lenses: a page that
 * shows up in several opportunity lenses at once (declining AND thin AND rising,
 * say) is the highest-leverage fix — one edit wins several ways. This counts the
 * distinct signals per page and ranks by breadth-then-stake, so the operator sees
 * where a single session pays off most. Pure + dependency-free; the section feeds
 * it already-canonical page + signal rows.
 */

export type PageSignalInput = {
  page: string;
  /** Human label for the signal kind (e.g. "Declining", "Thin", "Rising"). */
  signal: string;
  clicksAtStake: number;
};

export type LeveragePage = {
  page: string;
  signals: string[];
  signalCount: number;
  clicksAtStake: number;
};

/**
 * Group signals by page, keep pages triggering ≥`minSignals` DISTINCT signals,
 * rank by signal breadth (desc) then total clicks-at-stake (desc), cap. The
 * "fix once, win several ways" worklist.
 */
export function buildLeveragePages(
  rows: readonly PageSignalInput[],
  opts: { minSignals?: number; cap?: number } = {},
): LeveragePage[] {
  const minSignals = opts.minSignals ?? 2;
  const cap = opts.cap ?? 8;
  const byPage = new Map<string, { signals: Set<string>; clicks: number }>();
  for (const r of rows) {
    if (!r.page || !r.signal) continue;
    const e = byPage.get(r.page) ?? { signals: new Set<string>(), clicks: 0 };
    e.signals.add(r.signal);
    e.clicks += Math.max(0, r.clicksAtStake);
    byPage.set(r.page, e);
  }
  return [...byPage.entries()]
    .map(([page, e]) => ({
      page,
      signals: [...e.signals].sort(),
      signalCount: e.signals.size,
      clicksAtStake: e.clicks,
    }))
    .filter((p) => p.signalCount >= minSignals)
    .sort((a, b) => b.signalCount - a.signalCount || b.clicksAtStake - a.clicksAtStake)
    .slice(0, cap);
}
