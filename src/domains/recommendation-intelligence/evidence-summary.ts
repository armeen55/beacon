/**
 * Customer-facing evidence summary (2026-06-15) — turns the numbers
 * Beacon ALREADY holds on a recommendation into a specific, plain-English
 * "why this, why now" set of stat bullets.
 *
 * The owner asked for maximum evidence per decision: the EXACT search
 * volume, their current rank, their click-through vs what's typical for
 * that spot, and how many visits a fix could win — not a vague "improve
 * this". This helper reads the per-query Google Search signal the rec
 * already carries (`GscPageSignal.topQueries`: query, impressions, clicks,
 * CTR, position) and produces those bullets.
 *
 * HONESTY RAILS (mirrors the rest of the app):
 *   • Uses ONLY numbers present on the passed signal — never fabricates a
 *     keyword difficulty, a competitor, or a volume we don't have. When a
 *     number isn't available, the clause is simply omitted.
 *   • Plain English. No internal enum / jargon / "Profound" / SEO-speak.
 *     "impressions" → "times your page showed up"; "CTR" → "click-through".
 *   • Numbers via `toLocaleString` so 9137 reads as "9,137".
 *
 * PURE FUNCTION — no I/O, no React, no clock. Same signal → same lines.
 * The render layer (v2 card + detail drawer) calls this and renders the
 * returned bullets; it owns no number logic of its own.
 *
 * SCOPE NOTE: only the Google Search signal (`gscSignal`) is attached to a
 * recommendation on the render path today (load-queue.ts decorates it; the
 * SEMrush keyword-difficulty/volume, Microsoft Clarity friction rates, and
 * AI-assistant answer counts live only in the candidate `evidence` array at
 * generation time and are NOT carried onto the rendered row). Enriching
 * those is a follow-up that first needs those signals threaded onto
 * `LiveRecQueueItem` — see the report. This helper covers the data we have.
 */

import type { GscPageSignal, GscQuerySignal } from "./gsc-page-signals";
import { EXPECTED_CTR_BY_POSITION } from "./triggers/gsc-low-ctr";

/** One scannable evidence bullet. `value` is the bold number/phrase, `label`
 *  the plain-English caption. `detail` is an optional full-sentence "why now"
 *  the drawer can show under the stat. */
export type EvidenceLine = {
  key: string;
  value: string;
  label: string;
  detail?: string;
};

/** Minimum 90-day impressions for a query before we quote it. Below this a
 *  CTR/position is noise — mirrors the trigger floor (gsc-low-ctr.ts
 *  MIN_IMPRESSIONS) so the customer copy and the predicate agree on what
 *  counts as real demand. */
const MIN_QUERY_IMPRESSIONS = 200;
/** Striking-distance band (page ranks just short of page one). Mirrors the
 *  first-party GSC band in gsc-low-ctr.ts Rule B (4–15). */
const STRIKING_MIN_POS = 4;
const STRIKING_MAX_POS = 15;
/** Target position a striking-distance push aims for (top 3) — used only to
 *  estimate recoverable clicks, the same convention the trigger uses. */
const STRIKING_TARGET_CTR = EXPECTED_CTR_BY_POSITION[3] ?? 0.102;

function pct(fraction: number): string {
  return (fraction * 100).toFixed(1) + "%";
}

function n(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * The single query worth quoting on a card, picked from the signal's top
 * queries. Preference order, both grounded in real numbers:
 *   1. The worst CTR shortfall vs the typical click-through for its rank
 *      (positions 1–5, the band we have benchmarks for) — "you rank well
 *      but few click".
 *   2. The highest-demand striking-distance query (rank 4–15) — "one push
 *      from page one".
 * Returns null when no query clears the impressions floor / bands.
 */
export function pickHeadlineQuery(
  signal: GscPageSignal,
): { query: GscQuerySignal; kind: "low_ctr" | "striking" } | null {
  const eligible = signal.topQueries.filter(
    (q) => q.impressions >= MIN_QUERY_IMPRESSIONS,
  );
  if (eligible.length === 0) return null;

  // 1 — worst CTR shortfall in the benchmarked 1–5 band.
  let worstShortfall: { query: GscQuerySignal; shortfall: number } | null = null;
  for (const q of eligible) {
    const expected = EXPECTED_CTR_BY_POSITION[Math.round(q.position)];
    if (expected == null) continue; // outside 1–5
    const shortfall = expected - q.ctr;
    if (shortfall <= 0) continue;
    if (worstShortfall == null || shortfall > worstShortfall.shortfall) {
      worstShortfall = { query: q, shortfall };
    }
  }
  if (worstShortfall != null) {
    return { query: worstShortfall.query, kind: "low_ctr" };
  }

  // 2 — highest-demand striking-distance query.
  const striking = eligible
    .filter(
      (q) =>
        q.position >= STRIKING_MIN_POS && q.position <= STRIKING_MAX_POS,
    )
    .sort((a, b) => b.impressions - a.impressions)[0];
  if (striking != null) {
    return { query: striking, kind: "striking" };
  }
  return null;
}

/**
 * Build the customer-facing evidence bullets for a recommendation from its
 * Google Search signal. Returns [] when the signal is absent or carries no
 * quotable demand — the caller then falls back to its existing prose "why".
 *
 * The bullets lead with the page-level demand (so the owner sees the page is
 * really trafficked), then add the specific per-query "why now" when one
 * query stands out.
 */
export function buildGscEvidenceLines(
  signal: GscPageSignal | null | undefined,
): EvidenceLine[] {
  if (signal == null) return [];
  // Need real page demand to quote anything honestly.
  if (signal.impressions90d < MIN_QUERY_IMPRESSIONS) return [];

  const lines: EvidenceLine[] = [];

  const headline = pickHeadlineQuery(signal);
  if (headline != null) {
    const { query, kind } = headline;
    const rank = Math.round(query.position);
    const volume = n(query.impressions);

    if (kind === "low_ctr") {
      const expected = EXPECTED_CTR_BY_POSITION[rank];
      // Recoverable visits if CTR rose to the typical rate for this rank.
      const recoverable =
        expected != null
          ? Math.round(Math.max(0, expected - query.ctr) * query.impressions)
          : 0;
      const ctrClause =
        expected != null
          ? `Your click-through is ${pct(query.ctr)} vs about ${pct(
              expected,
            )} typical for spot #${rank}`
          : `Your click-through is ${pct(query.ctr)}`;
      const recoverClause =
        recoverable > 0
          ? `, so a clearer title could win about ${n(
              recoverable,
            )} more visits over 90 days.`
          : ".";
      lines.push({
        key: "headline_query",
        value: `“${query.query}”`,
        label: `${volume} times shown · you rank #${rank}`,
        detail: `People saw your page for “${query.query}” ${volume} times in the last 90 days and you rank #${rank}. ${ctrClause}${recoverClause}`,
      });
    } else {
      // striking distance
      const recoverable = Math.round(
        Math.max(0, STRIKING_TARGET_CTR - query.ctr) * query.impressions,
      );
      const recoverClause =
        recoverable > 0
          ? ` Reaching the top 3 could win about ${n(
              recoverable,
            )} more visits over 90 days.`
          : "";
      lines.push({
        key: "headline_query",
        value: `“${query.query}”`,
        label: `${volume} times shown · you rank #${rank} (striking distance)`,
        detail: `You already rank #${rank} for “${query.query}” — shown ${volume} times in the last 90 days, just short of page one.${recoverClause}`,
      });
    }
  }

  return lines;
}
