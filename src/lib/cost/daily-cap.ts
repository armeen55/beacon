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

/** Null = under the cap, spend may proceed. A sentence = the refusal, in the operator's own units. */
export async function dailyCapReason(tenantId: string, now: Date = new Date()): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const cap = (await getTenant(tenantId).catch(() => null))?.daily_budget_usd ?? DEFAULT_DAILY_CAP_USD;
  const today = await getTenantSpentTodayUsd(tenantId, now);
  if (today == null) return "Today's spend could not be read, so no more is spent today.";
  return today >= cap ? `Today's budget is spent (${today.toFixed(2)} of ${cap.toFixed(2)} USD). Paid work resumes tomorrow.` : null;
}
