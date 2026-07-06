/**
 * resolve-monthly-dollars (RANK-2, 2026-07-06 - "real dollar / revenue ROI").
 *
 * THE ONE MONEY MODEL
 * -------------------
 * A single pure function that turns an already-computed change-level dollar
 * attachment (ChangeDollarValue from proof-gsc/change-dollar-value.ts) into an
 * honest {usd, basis} pair, and builds the two operator-facing lines the highest
 * value screens render: the GROUNDED "this change earned about $X a month" line
 * when a real basis exists, and the UNGROUNDED honest connect-prompt when it
 * does not.
 *
 * NO INVENTED NUMBERS (the load-bearing contract):
 *   resolveMonthlyDollars NEVER returns a usd number without a real basis. usd
 *   is non-null ONLY when both hold:
 *     1. the operator configured a usable revenue model (rpm or per_lead), which
 *        is the ONLY thing that turns measured traffic into dollars for a change
 *        (change-level dollars are always the operator's own rate x the extra
 *        visits/leads THIS change earned - there is no per-change GA4
 *        purchaseRevenue path; that revenue lives page-level in revenue_facts), and
 *     2. change-dollar-value.ts already priced a finite usdPerMonth from it.
 *   Absent either, usd is null, basis is null, and the caller shows the honest
 *   connect-prompt - never a fabricated $0 and never a default rate.
 *
 * BASIS (honest provenance the copy names):
 *   - "value_per_conversion": operator set a value per lead (per_lead model);
 *     dollars = value per lead x extra leads this change earned.
 *   - "value_per_visit": operator set a value per 1,000 visits (rpm model);
 *     dollars = that rate x the extra visits this change earned.
 *   - "ga4_revenue": reserved for a TRULY MEASURED payout basis (a connected ad
 *     network / real GA4 purchase revenue attributed to the change). No such
 *     per-change path exists today, so resolveMonthlyDollars never emits it yet;
 *     it is in the union so the surfaces are ready the day a measured payout can
 *     be attributed to a single change, and the type documents the honest
 *     distinction between measured revenue and rate x traffic.
 *   - null: no usable basis - show the connect-prompt.
 *
 * These estimates are the operator's own rate applied to measured traffic. The
 * grounded copy always says "based on ... your $N value per lead", never
 * "measured revenue", matching change-dollar-value.ts / load-revenue.ts.
 *
 * PURE. No I/O, no dates, deterministic. Beacon voice: first person, a concrete
 * number, a next step, no lab words, no em or en dashes anywhere.
 *
 * Pinned by tests/domains/money/resolve-monthly-dollars.test.ts.
 */

import type { ChangeRevenueModel } from "@/domains/proof-gsc/change-dollar-value";

/** How a dollar figure was grounded. null = no usable basis (show the prompt). */
export type MonthlyDollarsBasis =
  | "ga4_revenue"
  | "value_per_conversion"
  | "value_per_visit"
  | null;

export type MonthlyDollars = {
  /** Estimated dollars a month, or null when no real basis exists. NEVER a
   *  number without a non-null basis. */
  usd: number | null;
  /** The provenance the copy names. null exactly when usd is null. */
  basis: MonthlyDollarsBasis;
};

/** The minimal change shape the money model reads - structurally satisfied by
 *  ShippedChangeRecord and by the WinCard builder. Only the already-priced
 *  dollar attachment is consulted; the money model never re-derives dollars. */
export type MonthlyDollarsInput = {
  /** The operator's-rate dollar attachment computed at measure time
   *  (change-dollar-value.ts). Null/absent when no traffic outcome or no
   *  revenue model - which the model reports as usd:null, basis:null. */
  dollarValue?: { usdPerMonth: number | null } | null;
  /** The operator's configured revenue model (business-config), or null. Used
   *  ONLY to name the basis - never to compute a number (the number already
   *  lives in dollarValue.usdPerMonth). */
  revenueModel?: ChangeRevenueModel | null;
};

/** Map a usable revenue model to its honest basis label. rpm prices per-visit,
 *  per_lead prices per-conversion. */
function basisOfRevenueModel(model: ChangeRevenueModel | null | undefined): Exclude<MonthlyDollarsBasis, null> | null {
  if (model == null) return null;
  if (model.kind === "rpm") {
    return Number.isFinite(model.rpmUsd) && model.rpmUsd > 0 ? "value_per_visit" : null;
  }
  if (model.kind === "per_lead") {
    return Number.isFinite(model.dollarsPerLead) && model.dollarsPerLead > 0
      ? "value_per_conversion"
      : null;
  }
  return null;
}

/**
 * THE money model. Returns {usd, basis} - usd non-null ONLY with a real basis.
 * A change whose dollarValue.usdPerMonth is null (no traffic outcome, or no
 * usable revenue model) resolves to {usd: null, basis: null}, and the caller
 * shows the honest connect-prompt.
 */
export function resolveMonthlyDollars(input: MonthlyDollarsInput): MonthlyDollars {
  const usd = input.dollarValue?.usdPerMonth;
  const basis = basisOfRevenueModel(input.revenueModel);
  // Both must line up: a finite priced number AND a usable rate that names the
  // basis. If change-dollar-value priced a number, a usable model was present at
  // measure time; requiring the basis here keeps the pair internally consistent
  // and guarantees usd never leaves without a provenance the copy can name.
  if (usd != null && Number.isFinite(usd) && basis != null) {
    return { usd, basis };
  }
  return { usd: null, basis: null };
}

/** Whole-dollar formatter (no cents on the celebratory line), abs so the
 *  sentence's own verb carries the sign. */
function fmtUsd(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** The honest source phrase per basis, for the grounded line. */
function basisPhrase(basis: Exclude<MonthlyDollarsBasis, null>): string {
  switch (basis) {
    case "value_per_conversion":
      return "your Search Console clicks and the value you set per lead";
    case "value_per_visit":
      return "your Search Console clicks and the value you set per 1,000 visits";
    case "ga4_revenue":
      return "the revenue your analytics attributed to this change";
  }
}

/**
 * The GROUNDED celebratory line for a win's export card, e.g.
 *   "This change earned about $420 a month, based on your Search Console clicks
 *    and the value you set per lead. This is an estimate at your own rate, not
 *    measured revenue."
 * Null unless the money model resolved a positive dollar figure - a zero or
 * negative figure never renders as a celebrated "earned" line (the card shows
 * clicks + the prompt instead). Beacon voice, no dashes, always says "estimate".
 */
export function groundedDollarLine(money: MonthlyDollars): string | null {
  if (money.usd == null || money.basis == null || money.usd <= 0) return null;
  const measured = money.basis === "ga4_revenue";
  const tail = measured
    ? ""
    : " This is an estimate at your own rate, not measured revenue.";
  return `This change earned about $${fmtUsd(money.usd)} a month, based on ${basisPhrase(money.basis)}.${tail}`;
}

/**
 * The ONE ungrounded honest prompt shown wherever a dollar figure would sit but
 * no usable basis exists. One constant so every surface asks in the same words.
 * Beacon voice: first person, a next step, no fake number, no dashes.
 */
export const CONNECT_REVENUE_PROMPT =
  "Connect revenue or tell me what a lead is worth, and I will show these wins in dollars.";
