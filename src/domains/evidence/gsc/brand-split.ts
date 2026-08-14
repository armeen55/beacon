/**
 * brand-split (BEACON_500 R17a / P2 slice 1, v1 item 265) - THE one brand vs
 * non-brand query classifier.
 *
 * R9 built brand-token detection inside tenant-ctr-curve.ts (brand queries must
 * not teach the CTR curve). This module is now that logic's canonical home -
 * tenant-ctr-curve.ts imports and re-exports it, so there is exactly ONE
 * implementation - and it adds the split itself: given daily query rows and the
 * tenant's brand tokens, how many clicks came from searches that mention the
 * business by name versus searches that do not.
 *
 * WHY the split matters: brand clicks are people who already knew the name.
 * Non-brand clicks are the growth that finds NEW people - the number an SEO
 * change can actually move. Mixed totals hide that, so growth surfaces lead
 * with the non-brand lens and SAY so.
 *
 * HONESTY RULES:
 *  - Only queries Google SHOWS us can be classified. Anonymized (hidden)
 *    queries are absent from these rows, so the non-brand count is a floor,
 *    never an estimate - the sub-line says where it was counted from.
 *  - No brand tokens (tenant has no configured name) -> no lens at all. We
 *    never guess which searches are brand.
 *
 * PURE, no I/O. The loader edge is load-brand-split.ts.
 */

/** Brand tokens from the tenant's name ("Ritz Builders" -> ["ritz builders",
 *  "ritz"]) - the same shape answer-intelligence uses. Empty name -> no tokens.
 *  (Moved verbatim from tenant-ctr-curve.ts / R9 - one implementation.) */
export function brandTokensFor(brandName: string | null | undefined): string[] {
  const full = (brandName ?? "").toLowerCase().trim();
  if (!full) return [];
  const tokens = [full];
  const words = full.split(/\s+/);
  if (words.length > 1 && words[0]!.length >= 3) tokens.push(words[0]!);
  return tokens;
}

/** A brand query clicks like a brand query (position 1, huge CTR) regardless of
 *  how well the page converts its rank - it must not teach the curve, and it
 *  is not growth that found a NEW person. (Moved verbatim from
 *  tenant-ctr-curve.ts / R9 - one implementation.) */
export function isBrandQuery(query: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const q = query.toLowerCase();
  return tokens.some((t) => q.includes(t));
}

/**
 * Brand tokens from the tenant's configured business identity: the name's
 * tokens (R9 rule above) plus the domain's own label ("iranopedia.com" ->
 * "iranopedia") - someone searching the domain word already knows the brand.
 * Dedupes; empty config -> no tokens (no lens, never a guess).
 */
export function brandTokensForConfig(cfg: {
  name?: string | null;
  domain?: string | null;
}): string[] {
  const tokens = new Set(brandTokensFor(cfg.name));
  const domain = (cfg.domain ?? "").toLowerCase().trim();
  if (domain) {
    const label = domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]!
      .split(".")[0]!
      .trim();
    // A 1-2 char label ("go", "x") would classify half the language as brand.
    if (label.length >= 3) tokens.add(label);
  }
  return [...tokens];
}

/** One visible query row for the split (page grain is irrelevant here). */
export type BrandSplitRow = { date: string; query: string; clicks: number };

type WeekBrandSplit = {
  /** Clicks from searches that do NOT mention the business name. */
  nonBrandClicks: number;
  /** Clicks from searches that DO mention the business name. */
  brandClicks: number;
};

export type ScoreboardBrandLens = {
  last7: WeekBrandSplit;
  prior7: WeekBrandSplit;
  /** Non-brand week-over-week percent change; null when the prior week had
   *  no non-brand clicks (no honest percentage exists). */
  nonBrandDeltaPct: number | null;
  /** The quiet sub-line under the scoreboard verdict. Plain language, states
   *  its own counting basis, no dashes, no lab words. */
  subLine: string;
};

/**
 * Build the scoreboard's non-brand lens from visible query rows.
 *
 *  - `reportedDates` are the scoreboard's own ascending REPORTED dates (from
 *    gsc_daily_totals), so this lens windows on exactly the same last-7 /
 *    prior-7 days the headline uses - never a calendar guess.
 *  - Returns null when there are under 14 reported days, no brand tokens, or
 *    no visible clicks in either week (nothing honest to say).
 */
export function buildScoreboardBrandLens(args: {
  rows: readonly BrandSplitRow[];
  tokens: readonly string[];
  reportedDates: readonly string[];
}): ScoreboardBrandLens | null {
  const { rows, tokens } = args;
  if (tokens.length === 0) return null;
  const dates = [...args.reportedDates].filter(Boolean).sort();
  if (dates.length < 14) return null;
  const last7 = new Set(dates.slice(-7));
  const prior7 = new Set(dates.slice(-14, -7));

  const sum = { last7: { nonBrandClicks: 0, brandClicks: 0 }, prior7: { nonBrandClicks: 0, brandClicks: 0 } };
  for (const r of rows) {
    const clicks = Number(r.clicks) || 0;
    if (clicks <= 0 || !r.date || typeof r.query !== "string") continue;
    const day = r.date.slice(0, 10);
    const bucket = last7.has(day) ? sum.last7 : prior7.has(day) ? sum.prior7 : null;
    if (!bucket) continue;
    if (isBrandQuery(r.query, tokens)) bucket.brandClicks += clicks;
    else bucket.nonBrandClicks += clicks;
  }

  const anyVisible =
    sum.last7.nonBrandClicks + sum.last7.brandClicks + sum.prior7.nonBrandClicks + sum.prior7.brandClicks > 0;
  if (!anyVisible) return null;

  const nonBrandDeltaPct =
    sum.prior7.nonBrandClicks > 0
      ? Math.round(((sum.last7.nonBrandClicks - sum.prior7.nonBrandClicks) / sum.prior7.nonBrandClicks) * 100)
      : null;

  const deltaClause =
    nonBrandDeltaPct == null
      ? ""
      : nonBrandDeltaPct > 2
        ? `, up ${nonBrandDeltaPct}% vs the week before`
        : nonBrandDeltaPct < -2
          ? `, down ${Math.abs(nonBrandDeltaPct)}% vs the week before`
          : ", about even with the week before";
  const subLine =
    `Non-brand clicks: ${sum.last7.nonBrandClicks.toLocaleString("en-US")} (the growth that finds NEW people)` +
    `${deltaClause}. Counted from searches where Google shows the words.`;

  return { last7: sum.last7, prior7: sum.prior7, nonBrandDeltaPct, subLine };
}
