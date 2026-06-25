/**
 * today-position-bands-rows (2026-06-25) — a PORTFOLIO lens (not per-page action):
 * the tenant's query ranking distribution across position bands, so the operator
 * sees the opportunity funnel at a glance — how many queries sit in striking
 * distance (the near-term pool), how many on page 2 (the next wave), etc. Pure +
 * dependency-free; dedupes a query to its best (lowest) position across pages.
 */

export type BandQuery = { query: string; clicks: number; impressions: number; position: number };

export type PositionBand = {
  key: "top3" | "striking" | "page2" | "beyond";
  label: string;
  /** Distinct queries whose best position falls in this band. */
  queries: number;
  clicks: number;
  impressions: number;
};

function bandKeyFor(position: number): PositionBand["key"] {
  if (position <= 3) return "top3";
  if (position <= 10) return "striking";
  if (position <= 20) return "page2";
  return "beyond";
}

const BAND_LABEL: Record<PositionBand["key"], string> = {
  top3: "Top 3 (winning)",
  striking: "Striking distance (pos 4-10)",
  page2: "Page 2 (pos 11-20)",
  beyond: "Beyond (pos 21+)",
};
const ORDER: PositionBand["key"][] = ["top3", "striking", "page2", "beyond"];

/**
 * Build the position-band distribution. Each distinct query counts once, in the
 * band of its BEST position across all the pages it appears on (its strongest rank).
 */
export function buildPositionBands(queries: BandQuery[]): PositionBand[] {
  // Best position + summed metrics per distinct query.
  const best = new Map<string, BandQuery>();
  for (const q of queries) {
    const k = q.query.toLowerCase().trim();
    if (!k || q.impressions <= 0) continue;
    const cur = best.get(k);
    if (!cur || q.position < cur.position) {
      best.set(k, { ...q, query: k });
    }
  }

  const acc = new Map<PositionBand["key"], { queries: number; clicks: number; impressions: number }>();
  for (const key of ORDER) acc.set(key, { queries: 0, clicks: 0, impressions: 0 });
  for (const q of best.values()) {
    const a = acc.get(bandKeyFor(q.position))!;
    a.queries += 1;
    a.clicks += q.clicks;
    a.impressions += q.impressions;
  }

  return ORDER.map((key) => ({ key, label: BAND_LABEL[key], ...acc.get(key)! }));
}

/** Total distinct queries across all bands. */
export function totalBandQueries(bands: PositionBand[]): number {
  return bands.reduce((s, b) => s + b.queries, 0);
}
