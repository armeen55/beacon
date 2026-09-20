import "server-only";

/**
 * THE durable spend ledger: `public.llm_budget_ledger`, one row per (tenant_id,
 * date_utc, platform). ALWAYS ON and the SOURCE OF TRUTH for the caps, never a
 * shadow and never flag-gated: the daily, monthly and lifetime cap reads below
 * all come off this same table, so a gated write would make every one of them
 * fail OPEN. The file ledger under `.data` is the fallback only, because it is
 * ephemeral or read-only wherever this actually runs.
 *
 * Contract
 * --------
 *   1. This module is read-only. `reserve_spend` and `reconcile_spend` are the
 *      sole write authority, so no caller can charge after the fact or bypass
 *      the reservation lock.
 *   2. Reads answer null on a failed read. getTenantLifetimeSpendUsd fails
 *      CLOSED on that null (unknown spend is not allowance); the monthly read
 *      hands its caller back to the file ledger with the per-run ceiling behind it.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { reportingDay } from "@/lib/reporting-day";

// ─── Types ───────────────────────────────────────────────────────────────

type LedgerPlatform =
  | "perplexity"
  | "openai"
  | "adjudicator-openai"
  | "onboarding-openai"
  | "dataforseo-serp"
  | "other";

const VALID_PLATFORMS: ReadonlySet<string> = new Set<LedgerPlatform>([
  "perplexity",
  "openai",
  "adjudicator-openai",
  "onboarding-openai",
  "dataforseo-serp",
  "other",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────

/** THE LEDGER DAY IS THE REPORTING DAY. It was a UTC slice while research ran on Pacific, so the two rolled
 *  over seven hours apart: a new Pacific day opened against a budget the UTC day had already spent, and one
 *  Pacific day could draw parts of two UTC allowances (Codex, 2026-08-18). The RPCs stamp the same zone
 *  (migration 2026-08-18c); the column keeps its historical name. Exported so a test can PIN the identity. */
export const ledgerDay = (now: Date = new Date()): string => reportingDay(now);

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Slice 5 (2026-07-24) - LIFETIME spend for a tenant on ONE platform, summed
 * across ALL dates in `llm_budget_ledger`. Powers the $2 pre-activation
 * onboarding cap, which is a lifetime cap, not a monthly one. FAIL CLOSED on any
 * read error: returns null so the caller must treat "unknown spend" as "not
 * allowed" (an unreadable ledger must never let uncapped pre-activation spend
 * through). An empty/absent ledger is a real 0, not an error.
 */
export async function getTenantLifetimeSpendUsd(
  tenantId: string,
  platform: LedgerPlatform,
): Promise<number | null> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") return null;
  if (!VALID_PLATFORMS.has(platform)) return null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("llm_budget_ledger")
      .select("spent_usd")
      .eq("tenant_id", tenantId)
      .eq("platform", platform);
    if (error || !Array.isArray(data)) return null;
    let total = 0;
    for (const row of data as Array<{ spent_usd?: number }>) {
      if (typeof row.spent_usd === "number") total += row.spent_usd;
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * THIS MONTH's total spend for a tenant, optionally on ONE platform (the
 * adjudicator's own monthly cap must not count the much larger poll spend that
 * shares this ledger). Null on a read error: the caller falls back to the file
 * ledger, with the per-run cost ceiling as the always-on backstop.
 */
/** TODAY's total spend for a tenant across EVERY platform on this ledger: the number the operator's daily
 *  cap is enforced against, so search buys and model calls cannot each spend a whole day's budget. Null on
 *  a read error, and the daily gate FAILS CLOSED on that null: unknown spend is not allowance. */
export async function getTenantSpentTodayUsd(tenantId: string, now: Date = new Date()): Promise<number | null> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") return 0;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("llm_budget_ledger").select("spent_usd")
      .eq("tenant_id", tenantId).eq("date_utc", ledgerDay(now));
    if (error || !Array.isArray(data)) return null;
    let total = 0;
    for (const row of data as Array<{ spent_usd?: number }>) {
      if (typeof row.spent_usd === "number") total += row.spent_usd;
    }
    return total;
  } catch { return null; }
}

export async function getTenantSpentThisMonthUsd(
  tenantId: string,
  now: Date = new Date(),
  platform?: LedgerPlatform,
): Promise<number | null> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") return 0;
  if (platform !== undefined && !VALID_PLATFORMS.has(platform)) return null;
  try {
    const supabase = getSupabaseAdmin();
    const monthStart = `${ledgerDay(now).slice(0, 7)}-01`; // YYYY-MM-01
    let query = supabase
      .from("llm_budget_ledger")
      .select("spent_usd")
      .eq("tenant_id", tenantId)
      .gte("date_utc", monthStart);
    // Platform-scoped read: without it, poll spend sharing this ledger would trip
    // the $10 adjudicator cap almost at once and fail it CLOSED prematurely.
    if (platform !== undefined) query = query.eq("platform", platform);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return null;
    let total = 0;
    for (const row of data as Array<{ spent_usd?: number }>) {
      if (typeof row.spent_usd === "number") total += row.spent_usd;
    }
    return total;
  } catch {
    return null;
  }
}
