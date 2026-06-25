/**
 * today-ctrgap-rows (2026-06-25) — the "seen but not clicked" lens: queries where
 * the page already RANKS WELL (good position) but earns far FEWER clicks than that
 * position should — a title/snippet problem, not a ranking one. Distinct from
 * striking-distance (climb a few spots) and decline (losing ground): here the rank
 * is fine, the listing just isn't compelling. Pure + dependency-free (the CTR model
 * is injected) so it's unit-testable. Ranked by clicks left on the table.
 */

export type CtrGapQuery = { query: string; clicks: number; impressions: number; position: number };
export type CtrGapPage = { page: string; queries: CtrGapQuery[] };

export type CtrGapRow = {
  page: string;
  query: string;
  position: number;
  impressions: number;
  actualCtr: number;
  expectedCtr: number;
  /** Estimated monthly clicks left on the table = impressions × (expected − actual). */
  clicksLeft: number;
};

// Only flag a query whose rank is genuinely GOOD (so the fix is the snippet, not
// the ranking), with enough impressions to trust the CTR, and a real shortfall.
const MAX_POSITION = 10; // top page-ish
const MIN_IMPRESSIONS = 200;
const SHORTFALL = 0.5; // actual must be < 50% of expected to count
const MIN_CLICKS_LEFT = 5;

/**
 * Build the CTR-gap rows across pages. `expectedCtrFn` is the injected CTR-by-
 * position model. Dedupes to the worst query per page, ranked by clicks left.
 */
export function buildCtrGapRows(
  pages: CtrGapPage[],
  expectedCtrFn: (position: number) => number,
  opts: { cap?: number } = {},
): CtrGapRow[] {
  const cap = opts.cap ?? 8;
  const byPage = new Map<string, CtrGapRow>();

  for (const p of pages) {
    for (const q of p.queries) {
      if (q.position > MAX_POSITION || q.impressions < MIN_IMPRESSIONS) continue;
      const actualCtr = q.impressions > 0 ? q.clicks / q.impressions : 0;
      const expectedCtr = expectedCtrFn(q.position);
      if (expectedCtr <= 0 || actualCtr >= expectedCtr * SHORTFALL) continue;
      const clicksLeft = Math.round(q.impressions * (expectedCtr - actualCtr));
      if (clicksLeft < MIN_CLICKS_LEFT) continue;
      const row: CtrGapRow = {
        page: p.page,
        query: q.query,
        position: q.position,
        impressions: q.impressions,
        actualCtr,
        expectedCtr,
        clicksLeft,
      };
      const existing = byPage.get(p.page);
      if (!existing || row.clicksLeft > existing.clicksLeft) byPage.set(p.page, row);
    }
  }

  return [...byPage.values()].sort((a, b) => b.clicksLeft - a.clicksLeft).slice(0, cap);
}

/** Total estimated monthly clicks left on the table across the CTR-gap rows. */
export function ctrGapClicksLeft(rows: CtrGapRow[]): number {
  return rows.reduce((s, r) => s + Math.max(0, r.clicksLeft), 0);
}
