import "server-only";

/**
 * THE OPERATOR'S DAILY CAP, MECHANICALLY ENFORCED AT EVERY PAID DOOR. `daily_budget_usd` sat on every
 * account row read by nothing, so the one number the operator was told bounds a day bounded nothing.
 * Today's total across EVERY platform on the one ledger is held under it, and both paid doors (the LLM
 * budget check and the search-buy reservation) ask this before spending. FAIL CLOSED where it matters:
 * an unreadable ledger refuses, because unknown spend is not allowance; an unreadable ACCOUNT falls back
 * to the provisioning default rather than refusing, because the account read failing must not silence
 * every paid path. A cap of zero or less means the operator turned paid work off for the day.
 */

import { getTenant } from "@/domains/account";
import { isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getTenantSpentTodayUsd } from "./budget-ledger-supabase";

const DEFAULT_DAILY_CAP_USD = 5;

/** Null = under the cap, spend may proceed. A sentence = the refusal, in the operator's own units.
 *  `share` is the fraction of the day's budget THIS DOOR may consume: the search-buy door passes
 *  SEARCH_SHARE so bulk evidence can never spend the whole day and starve the drafting that turns the
 *  evidence into work. On 17 August 105 observation calls consumed the full dollar before one draft ran. */
export async function dailyCapReason(tenantId: string, now: Date = new Date(), share = 1): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const cap = ((await getTenant(tenantId).catch(() => null))?.daily_budget_usd ?? DEFAULT_DAILY_CAP_USD) * share;
  const today = await getTenantSpentTodayUsd(tenantId, now);
  if (today == null) return "Today's spend could not be read, so no more is spent today.";
  return today >= cap ? `Today's budget for this kind of work is spent (${today.toFixed(2)} of ${cap.toFixed(2)} USD). Paid work resumes tomorrow.` : null;
}

/** What search buying may take of the day: the rest is reserved for the editor that finishes the work. */
export const SEARCH_SHARE = 0.85;
/** RESERVED FOR ONE FACT UNIT A DAY, inside the search share. Bulk observations ran first and consumed the
 *  whole search allowance, so at the operator's real cap the fact check never bought its first call (Codex,
 *  2026-08-18). Bulk stops early; fact-check buys may use the full search share. At the $1 floor this holds
 *  $0.08 for fact sources, ~20 provider calls, far above one unit's search + two reads. Raising the cap is
 *  never the fix for reachability. */
export const FACT_RESERVE_SHARE = 0.08;
/** PURE: the share of the day's budget one search buy may draw, by what the buy is FOR. */
export const searchShareFor = (purpose: "fact_check" | "bulk"): number =>
  purpose === "fact_check" ? SEARCH_SHARE : SEARCH_SHARE - FACT_RESERVE_SHARE;
