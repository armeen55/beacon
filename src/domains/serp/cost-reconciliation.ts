/**
 * cost-reconciliation (BEACON_500 R23 P19, v1 item 417, 2026-07-03) - reconcile
 * what Beacon ESTIMATED it would spend on live research against what it ACTUALLY
 * spent, so the operator gets an honest receipt like "I estimated $0.05 and
 * actually spent $0.048 on research this month."
 *
 * The estimate is deterministic: every DataForSEO SERP call has a fixed per-call
 * cost (dataforseo-serp.ts SERP_COST_USD) and every recorded ledger row carries
 * its call_count, so the estimate for a platform is call_count x per-call cost.
 * The actual is the ledger's own spent_usd for the same platform. Comparing the
 * two catches drift (a price change on DataForSEO's side, a partial charge, a
 * miscount) without any new API call - it is pure arithmetic over already-
 * persisted llm_budget_ledger rows.
 *
 * PURE, no I/O. The caller reads the month's spend rows
 * (budget-ledger-supabase.ts readMonthlySpendByPlatform / readRecentSpendRows)
 * and passes them in as plain numbers.
 *
 * HONESTY RULE: with no spend rows at all, this returns an empty reconciliation
 * and says so plainly ("I have not spent anything on research yet") - it never
 * fabricates a dollar figure. Beacon voice: first person, a concrete dollar
 * amount, no lab words, no em or en dashes.
 */

/** The DataForSEO SERP per-call price. Byte-identical to dataforseo-serp.ts's
 *  SERP_COST_USD (pinned by a test) - inlined here so this module stays PURE
 *  (dataforseo-serp.ts is `server-only`, and this reconciliation math must be
 *  importable and testable anywhere, exactly like winnability.ts). If the SERP
 *  price ever changes there, change it here too; the pin test will fail loudly
 *  if the two ever drift. */
export const SERP_PER_CALL_USD = 0.003;

/** Per-call estimate by platform. Only the DataForSEO SERP platform has a known
 *  fixed per-call price in this codebase; other platforms have no deterministic
 *  per-call estimate, so their estimate falls back to their actual (no drift
 *  claimed for something we cannot independently estimate). */
const PER_CALL_ESTIMATE_USD: Record<string, number> = {
  "dataforseo-serp": SERP_PER_CALL_USD,
};

/** One platform's month-to-date spend, as read from the ledger. `calls` is the
 *  ledger's call_count (how many billable calls); `spentUsd` is the ledger's
 *  spent_usd (what was actually charged). */
export type PlatformSpendRow = {
  platform: string;
  spentUsd: number;
  calls: number;
};

export type PlatformReconciliation = {
  platform: string;
  /** call_count x per-call estimate, or equal to actual when no per-call price
   *  is known for the platform. */
  estimatedUsd: number;
  /** The ledger's own spent_usd. */
  actualUsd: number;
  /** actual - estimated (positive = we spent MORE than estimated). */
  deltaUsd: number;
  calls: number;
  /** True only when we HAVE a deterministic per-call estimate for this platform
   *  (so the delta is meaningful drift, not an estimate that just mirrors actual). */
  hasEstimate: boolean;
};

export type CostReconciliation = {
  perPlatform: PlatformReconciliation[];
  totalEstimatedUsd: number;
  totalActualUsd: number;
  totalDeltaUsd: number;
  /** One first-person receipt sentence, or the honest "nothing spent yet" line.
   *  Never a lab word, never a dash. */
  sentence: string;
};

/** Format a small dollar figure the way a receipt reads: cents-precise under
 *  $10 ($0.048), dollars-and-cents otherwise ($12.40). */
function money(n: number): string {
  const v = Math.max(0, n);
  if (v < 10) return `$${v.toFixed(3).replace(/0$/, "")}`;
  return `$${v.toFixed(2)}`;
}

/**
 * Reconcile estimated vs actual DataForSEO/research spend from ledger rows. PURE.
 *
 * For each platform with a known per-call price, estimated = calls x price and
 * the delta is real drift; for platforms without one, estimated mirrors actual
 * (hasEstimate = false) so the total is never distorted by a made-up estimate.
 * With no rows, returns an empty reconciliation and the honest nothing-spent line.
 */
export function reconcileCost(rows: readonly PlatformSpendRow[]): CostReconciliation {
  const usable = rows.filter(
    (r) =>
      typeof r.platform === "string" &&
      r.platform.trim().length > 0 &&
      Number.isFinite(r.spentUsd) &&
      r.spentUsd >= 0 &&
      Number.isFinite(r.calls) &&
      r.calls >= 0,
  );

  if (usable.length === 0) {
    return {
      perPlatform: [],
      totalEstimatedUsd: 0,
      totalActualUsd: 0,
      totalDeltaUsd: 0,
      sentence: "I have not spent anything on live research yet this month, so there is nothing to reconcile.",
    };
  }

  const perPlatform: PlatformReconciliation[] = usable.map((r) => {
    const perCall = PER_CALL_ESTIMATE_USD[r.platform];
    const hasEstimate = typeof perCall === "number";
    const estimatedUsd = hasEstimate ? r.calls * perCall : r.spentUsd;
    return {
      platform: r.platform,
      estimatedUsd,
      actualUsd: r.spentUsd,
      deltaUsd: r.spentUsd - estimatedUsd,
      calls: r.calls,
      hasEstimate,
    };
  });
  perPlatform.sort((a, b) => b.actualUsd - a.actualUsd);

  const totalEstimatedUsd = perPlatform.reduce((s, p) => s + p.estimatedUsd, 0);
  const totalActualUsd = perPlatform.reduce((s, p) => s + p.actualUsd, 0);
  const totalDeltaUsd = totalActualUsd - totalEstimatedUsd;

  // The receipt sentence names the total estimate vs actual, and calls out drift
  // ONLY when we have a real per-call estimate to compare against.
  const anyEstimated = perPlatform.some((p) => p.hasEstimate);
  let sentence: string;
  if (!anyEstimated) {
    sentence = `I actually spent ${money(totalActualUsd)} on live research this month.`;
  } else {
    const driftCents = Math.abs(totalDeltaUsd);
    if (driftCents < 0.001) {
      sentence = `I estimated ${money(totalEstimatedUsd)} and spent exactly that on live research this month.`;
    } else {
      const direction = totalDeltaUsd > 0 ? "actually spent" : "actually spent only";
      sentence = `I estimated ${money(totalEstimatedUsd)} and ${direction} ${money(totalActualUsd)} on live research this month.`;
    }
  }

  return { perPlatform, totalEstimatedUsd, totalActualUsd, totalDeltaUsd, sentence };
}
