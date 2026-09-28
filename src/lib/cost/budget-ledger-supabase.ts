import "server-only";

/** Read-only totals from the durable spend ledger. The reservation RPCs own writes.
 * A failed read returns null so paid callers can refuse unknown spend. */

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

function sumSpentUsd(rows: Array<{ spent_usd?: number }>): number {
  return rows.reduce((total, row) => total + (typeof row.spent_usd === "number" ? row.spent_usd : 0), 0);
}

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
    return sumSpentUsd(data as Array<{ spent_usd?: number }>);
  } catch {
    return null;
  }
}

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
    return sumSpentUsd(data as Array<{ spent_usd?: number }>);
  } catch { return null; }
}

/** Month-to-date spend for one tenant, optionally one platform; null on an unreadable ledger. */
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
    return sumSpentUsd(data as Array<{ spent_usd?: number }>);
  } catch {
    return null;
  }
}
