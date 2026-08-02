/**
 * The `revenue_facts.source` vocabulary.
 *
 * This module used to hold the unit-economics producer (BEACON_500 item 3):
 * `computeUnitEconomicsFacts` turned measured GA4 traffic into per-page dollar
 * rows and `runRevenueFactsPass` upserted them nightly. Both were removed in the
 * V1 consolidation because nothing in the tree called either one, and the test
 * this header used to cite no longer exists. What survives is the one thing with
 * a live reader: the source tag `load-revenue.ts` reads off stored rows.
 *
 * The honesty contract those rows carry still holds for whatever writes them
 * next: only `ad_network` is a measured payout. `unit_economics` is the
 * operator's own rate applied to real traffic and must never be shown as money
 * anyone actually paid.
 */

export type RevenueSource =
  | "ad_network"
  | "unit_economics"
  | "affiliate"
  | "operator_manual";
