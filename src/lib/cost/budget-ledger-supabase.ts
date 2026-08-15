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
 *   1. Validates BEFORE any Supabase round-trip: empty tenantId, unknown
 *      platform, or a negative cost outside the reserve-rollback path are
 *      dropped with a warn and no write is attempted.
 *   2. Never throws to the caller. A rejected write, a Supabase error and an
 *      unexpected exception all warn and return false, so a ledger glitch can
 *      never block a paid call; a caller that must fail closed reads the false.
 *   3. Reads answer null on a failed read. getTenantLifetimeSpendUsd fails
 *      CLOSED on that null (unknown spend is not allowance); the monthly read
 *      hands its caller back to the file ledger with the per-run ceiling behind it.
 *
 * UPSERT semantics
 * ----------------
 * Postgres-side `INSERT ... ON CONFLICT DO UPDATE SET col = col + n` is the
 * natural shape for an atomic increment and supabase-js does not expose it, so
 * this is SELECT-then-INSERT-or-UPDATE. THE RACE IS HANDLED, NOT ASSUMED AWAY:
 * a duplicate key means a parallel writer created the day row in between, and
 * the loser folds its spend into that row rather than dropping it, because
 * dropped spend under-counts a cap that is supposed to fail closed. Moving the
 * increment into a Postgres function stays local to this module.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

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

type RecordSpendDualWriteInput = {
  /** Resolved tenant id (e.g. `tenant-ritz-founder`). Must be nonempty. */
  tenantId: string;
  /** Platform enum matching the migration's CHECK constraint. */
  platform: LedgerPlatform;
  /** Cost of THIS call/chunk in USD. Must be finite; nonnegative unless
   *  `allowNegative` is set (the reserve-then-reconcile rollback/refund path). */
  costUsd: number;
  /** Slice 5 (D10): permit a NEGATIVE costUsd (reservation rollback / reconcile
   *  refund); the row is clamped at zero. Omitted = the nonnegative-only path. */
  allowNegative?: boolean;
  /** Optional. Number of prompts polled in this call. Default 0. */
  promptCount?: number;
  /** Optional. Number of chunks completed in this call. Default 0. */
  chunkCount?: number;
  /** Optional. observation_run_id of this run, stamped to last_run_id. */
  runId?: string | null;
  /** Optional. Stamped to the row's `metadata` jsonb (last-writer-wins). */
  metadata?: Record<string, unknown>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * THE durable spend write every cap depends on: getTenantSpentTodayUsd reads
 * this same table. Returns true only when the row durably persisted, and false
 * when validation or the database rejected it, which is what lets the
 * reserve-then-reconcile path in adjudicator-budget.ts refuse to spend.
 */
export async function recordSpendSupabase(
  input: RecordSpendDualWriteInput,
): Promise<boolean> {
  // ── Validation (fail loud BEFORE any Supabase round-trip) ──
  if (typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    console.warn(
      `[budget-ledger] write rejected: empty tenantId platform=${input.platform}`,
    );
    return false;
  }
  if (!VALID_PLATFORMS.has(input.platform)) {
    console.warn(
      `[budget-ledger] write rejected: invalid platform "${input.platform}"`,
    );
    return false;
  }
  // Negative costs are rejected UNLESS `allowNegative` is set (the D10 rollback /
  // reconcile refund path); the row is clamped at zero on write below either way.
  if (!Number.isFinite(input.costUsd) || (input.costUsd < 0 && input.allowNegative !== true)) {
    console.warn(
      `[budget-ledger] write rejected: invalid costUsd=${input.costUsd} tenantId=${input.tenantId}`,
    );
    return false;
  }
  const promptCount = input.promptCount ?? 0;
  const chunkCount = input.chunkCount ?? 0;
  if (!Number.isInteger(promptCount) || promptCount < 0) {
    console.warn(
      `[budget-ledger] write rejected: invalid promptCount=${promptCount}`,
    );
    return false;
  }
  if (!Number.isInteger(chunkCount) || chunkCount < 0) {
    console.warn(
      `[budget-ledger] write rejected: invalid chunkCount=${chunkCount}`,
    );
    return false;
  }

  try {
    // ONE ATOMIC INCREMENT, NOT A READ AND A WRITE. Every charge used to SELECT today's row, add the cost in
    // JavaScript and UPDATE the absolute total back, so two concurrent charges both read the same total and one
    // of them simply disappeared: the fail-closed cap was then reading a number smaller than what was spent.
    // The database adds the delta under an advisory lock for this (tenant, platform), which is the same shape
    // the provider ledger has always used, so nothing depends on what this process last read.
    const { data, error } = await getSupabaseAdmin().rpc("increment_llm_spend", {
      p_tenant_id: input.tenantId, p_platform: input.platform, p_delta: input.costUsd,
      p_prompts: promptCount, p_chunks: chunkCount, p_run_id: input.runId ?? null,
      p_metadata: (input.metadata ?? null) as never,
    });
    if (error) {
      console.warn(`[budget-ledger] increment failed (non-fatal) tenantId=${input.tenantId} platform=${input.platform}: ${error.message}`);
      return false;
    }
    return data === true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[budget-ledger] write threw (non-fatal): ${msg}`);
    return false;
  }
}

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
export async function getTenantSpentThisMonthUsd(
  tenantId: string,
  now: Date = new Date(),
  platform?: LedgerPlatform,
): Promise<number | null> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") return 0;
  if (platform !== undefined && !VALID_PLATFORMS.has(platform)) return null;
  try {
    const supabase = getSupabaseAdmin();
    const monthStart = `${todayUtcDate(now).slice(0, 7)}-01`; // YYYY-MM-01
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
