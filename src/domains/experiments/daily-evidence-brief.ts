/**
 * daily-evidence-brief (2026-07-01, assistant-first phase 2 slice E) — the "how we know" battlefield
 * for the daily card. PURE: assembles the keyword-research evidence (the page's top searches + their
 * cached DataForSEO demand) into a compact, render-ready brief. No I/O — the caller passes the cached
 * demand map (readAllCachedKeywordDemand, a $0 reader). Live SERP + competitor teardown attach in a
 * later slice; this is the keyword layer.
 *
 * HONESTY: DataForSEO exposes paid COMPETITION (low/medium/high), NOT a true keyword-difficulty score.
 * We surface competitionLevel and label it "competition", never "difficulty".
 */

/** One researched keyword row: the term, its cached monthly volume, and paid-competition level. */
export type EvidenceKeyword = {
  term: string;
  /** Avg monthly searches from DataForSEO's cache, or null when there is no cached data. */
  volume: number | null;
  /** Paid-competition level (NOT keyword difficulty), or null. */
  competition: "low" | "medium" | "high" | null;
};

export type DailyEvidenceBrief = {
  /** The page's top searches with whatever cached demand we have (best-first). */
  keywords: EvidenceKeyword[];
  /** Sum of known volumes across the shown keywords, or null when none are cached. */
  addressableVolume: number | null;
};

export type CachedDemand = { volume: number | null; competition: "low" | "medium" | "high" | null };

/**
 * Build the keyword-research brief for a page from its top queries + the cached demand map. Returns
 * null unless at least one query has cached demand (so the card never shows an empty section). Pure.
 */
export function buildKeywordBrief(
  queries: string[],
  demandByTerm: Map<string, CachedDemand>,
  opts?: { max?: number },
): DailyEvidenceBrief | null {
  const max = opts?.max ?? 6;
  const seen = new Set<string>();
  const keywords: EvidenceKeyword[] = [];
  for (const raw of queries) {
    const term = (raw ?? "").trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    const d = demandByTerm.get(key);
    keywords.push({ term, volume: d?.volume ?? null, competition: d?.competition ?? null });
    if (keywords.length >= max) break;
  }
  // Only surface a brief when we actually have cached demand for at least one keyword; otherwise it is
  // just the query list with no research value (and would read as an empty "keyword research" box).
  if (!keywords.some((k) => k.volume != null || k.competition != null)) return null;

  const vols = keywords.map((k) => k.volume).filter((v): v is number => typeof v === "number" && v > 0);
  const addressableVolume = vols.length ? vols.reduce((s, v) => s + v, 0) : null;
  return { keywords, addressableVolume };
}
