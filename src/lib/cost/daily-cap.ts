import "server-only";

/**
 * THE OPERATOR'S DAILY CAP, MECHANICALLY ENFORCED AT EVERY PAID DOOR. `daily_budget_usd` sat on every
 * account row read by nothing, so the one number the operator was told bounds a day bounded nothing.
 * Today's total across EVERY platform on the one ledger is held under it, and both paid doors (the LLM
 * budget check and the search-buy reservation) ask this before spending. FAIL CLOSED, both ways: an
 * unreadable ledger refuses, because unknown spend is not allowance, and an unreadable ACCOUNT refuses
 * too. It used to fall back to the provisioning default so a failed account read could not silence every
 * paid path, and that was the wrong trade: an account whose operator had set the day to zero would have
 * spent against the default allowance on one flickering read. A cap of zero or less means the operator
 * turned paid work off for the day, and a cap nobody could read is not the default cap.
 */

import { getTenant } from "@/domains/account";
import { isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getTenantSpentTodayUsd } from "./budget-ledger-supabase";

const DEFAULT_DAILY_CAP_USD = 5;

/** Null = under the cap, spend may proceed. A sentence = the refusal, in the operator's own units.
 *  `share` is the fraction of the day's budget THIS DOOR may consume: the search-buy door passes
 *  SEARCH_SHARE so bulk evidence can never spend the whole day and starve the drafting that turns the
 *  evidence into work. On 17 August 105 observation calls consumed the full dollar before one draft ran. */
export async function dailyCapReason(tenantId: string, now: Date = new Date(), share = 1, projectedUsd = 0): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  // AN UNREADABLE BUDGET IS NOT THE DEFAULT BUDGET. A failed tenant read fell back to the standard allowance, so
  // an account whose operator had set the day's budget to zero, which this file's own contract calls turning paid
  // work off, would have spent against a five dollar cap the moment that read flickered. The line below already
  // refuses when the day's SPEND cannot be read; the budget it is measured against answers the same way.
  const account = await getTenant(tenantId).catch(() => null);
  if (account == null) return "This account's budget for the day could not be read, so no paid work is started.";
  const cap = (account.daily_budget_usd ?? DEFAULT_DAILY_CAP_USD) * share;
  const today = await getTenantSpentTodayUsd(tenantId, now);
  if (today == null) return "Today's spend could not be read, so no more is spent today.";
  // THE CALL ABOUT TO BE MADE COUNTS. Comparing only money already spent admitted the reservation that crossed
  // the line: at 0.769 spent, a 0.21 buy passed a 0.77 ceiling and took the reserve with it (Codex,
  // 2026-08-18). The door asks whether the day can afford THIS call, not whether it could afford the last one.
  return today + Math.max(0, projectedUsd) > cap
    ? `Today's budget for this kind of work is spent (${today.toFixed(2)} of ${cap.toFixed(2)} USD). Paid work resumes tomorrow.` : null;
}

/** What search buying may take of the day: the rest is reserved for the editor that finishes the work. */
export const SEARCH_SHARE = 0.85;
/** HELD BACK FROM EVERY BULK DOOR for the day's fact checking. The run order gives fact_check its TURN ahead
 *  of every paid phase; this holds its MONEY on BOTH doors, so neither bulk search nor non-fact model work can
 *  spend the last of the day before it. At the $1 floor that is $0.08, far above one unit's search and two
 *  source reads. Raising the operator's cap is never the fix for reachability (Codex, 2026-08-18). */
export const FACT_RESERVE_SHARE = 0.08;
/** PURE: the share of the day one call may draw, by the door it knocks on and what it is FOR. Fact checking
 *  may draw the whole cap; bulk search keeps its 0.85 ceiling and bulk model work the rest, each less the reserve. */
export const shareFor = (door: "search" | "model", purpose: "fact_check" | "bulk"): number =>
  purpose === "fact_check" ? 1 : (door === "search" ? SEARCH_SHARE : 1) - FACT_RESERVE_SHARE;
