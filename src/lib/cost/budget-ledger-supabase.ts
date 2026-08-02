import "server-only";

/**
 * Supabase llm_budget_ledger dual-write — Phase 2 Stage B.2 (2026-05-09).
 *
 * Shadow-mode writer for the per-tenant / per-day / per-platform spend
 * ledger backed by `public.llm_budget_ledger` (Stage A migration).
 *
 * Contract
 * --------
 *   1. Default OFF — `BEACON_BUDGET_LEDGER_DUAL_WRITE === "1"` is the
 *      gate. With the flag unset, every public function in this module
 *      returns immediately without touching Supabase. Production is
 *      unchanged after deploy until an operator flips the flag.
 *   2. Source of truth stays JSON. The existing `recordSpend` in
 *      `src/lib/cost/budget.ts` and `recordSpend`/`writeState` in
 *      `src/domains/recommendations/adjudicator-budget.ts` continue to
 *      run untouched. This module is additive shadow.
 *   3. Never throws to the caller. Validation rejections, Supabase
 *      errors, and unexpected exceptions all log a `console.warn` and
 *      return. Paid API calls must NEVER be blocked by a ledger
 *      glitch.
 *   4. Validates BEFORE the Supabase round-trip. Empty tenantId,
 *      invalid platform, or negative cost are dropped with a warn —
 *      no insert attempt.
 *   5. Read-only snapshot reads are NOT flag-gated. They're safe at
 *      any time; an empty/unavailable table returns `[]` so the
 *      canary can render a calm fallback.
 *
 * Grain
 * -----
 * One row per (tenant_id, date_utc, platform). The poll runner calls
 * this helper ONCE per chunk run with the chunk's totals. The
 * adjudicator path is deferred to a later bundle (per-call writes
 * would be 1 Supabase round-trip per adjudication; the monthly
 * grain of `adjudicator-budget.ts` doesn't map cleanly to the
 * daily/per-platform ledger without first reshaping its accounting).
 *
 * UPSERT semantics
 * ----------------
 * Postgres-side `INSERT ... ON CONFLICT DO UPDATE SET col = col + n`
 * is the natural shape for atomic increments, but supabase-js does
 * not expose it directly. We use SELECT-then-INSERT-or-UPDATE
 * instead. Beacon today is single-tenant single-writer, so the
 * race window is empty in practice. When a second tenant or a
 * concurrent writer arrives, swap to a `rpc()` call against a
 * Postgres function that does the increment atomically — that
 * conversion is local to this module.
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
 * ALWAYS-ON durable spend writer to `public.llm_budget_ledger`. NOT flag-gated —
 * use this for spend that a daily/monthly CAP must actually see (e.g. the page
 * factory): getTenantSpentTodayUsd reads this same table, so gating the write
 * behind the shadow-mode flag made those caps structurally fail-OPEN. Never
 * throws; a Supabase error is logged and swallowed. Returns true when the row
 * durably persisted, false when validation or the DB rejected the write (the
 * reserve-then-reconcile path in adjudicator-budget.ts refuses on false).
 */
export async function recordSpendSupabase(
  input: RecordSpendDualWriteInput,
): Promise<boolean> {
  // ── Validation (fail loud BEFORE any Supabase round-trip) ──
  if (typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    console.warn(
      `[budget-ledger] dual-write rejected: empty tenantId platform=${input.platform}`,
    );
    return false;
  }
  if (!VALID_PLATFORMS.has(input.platform)) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid platform "${input.platform}"`,
    );
    return false;
  }
  // Negative costs are rejected UNLESS `allowNegative` is set (the D10 rollback /
  // reconcile refund path); the row is clamped at zero on write below either way.
  if (!Number.isFinite(input.costUsd) || (input.costUsd < 0 && input.allowNegative !== true)) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid costUsd=${input.costUsd} tenantId=${input.tenantId}`,
    );
    return false;
  }
  const promptCount = input.promptCount ?? 0;
  const chunkCount = input.chunkCount ?? 0;
  if (!Number.isInteger(promptCount) || promptCount < 0) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid promptCount=${promptCount}`,
    );
    return false;
  }
  if (!Number.isInteger(chunkCount) || chunkCount < 0) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid chunkCount=${chunkCount}`,
    );
    return false;
  }

  try {
    const supabase = getSupabaseAdmin();
    const date = todayUtcDate();
    const nowIso = new Date().toISOString();

    // SELECT — current row (if any).
    const { data: existing, error: selErr } = await supabase
      .from("llm_budget_ledger")
      .select("spent_usd, call_count, prompt_count, chunk_count")
      .eq("tenant_id", input.tenantId)
      .eq("date_utc", date)
      .eq("platform", input.platform)
      .maybeSingle();

    if (selErr) {
      console.warn(
        `[budget-ledger] read failed (non-fatal) tenantId=${input.tenantId} ` +
          `platform=${input.platform}: ${selErr.message}`,
      );
      return false;
    }

    if (existing) {
      const { error: updErr } = await supabase
        .from("llm_budget_ledger")
        .update({
          spent_usd: Math.max(0, Number(existing.spent_usd) + input.costUsd),
          call_count: Number(existing.call_count) + 1,
          prompt_count: Number(existing.prompt_count) + promptCount,
          chunk_count: Number(existing.chunk_count) + chunkCount,
          last_run_id: input.runId ?? null,
          updated_at: nowIso,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        })
        .eq("tenant_id", input.tenantId)
        .eq("date_utc", date)
        .eq("platform", input.platform);
      if (updErr) {
        console.warn(
          `[budget-ledger] update failed (non-fatal) tenantId=${input.tenantId} ` +
            `platform=${input.platform}: ${updErr.message}`,
        );
        return false;
      }
      return true;
    }

    const { error: insErr } = await supabase.from("llm_budget_ledger").insert({
      tenant_id: input.tenantId,
      date_utc: date,
      platform: input.platform,
      spent_usd: Math.max(0, input.costUsd),
      call_count: 1,
      prompt_count: promptCount,
      chunk_count: chunkCount,
      last_run_id: input.runId ?? null,
      metadata: input.metadata ?? null,
    });
    if (insErr) {
      // Duplicate key = a PARALLEL writer created the day-row between our SELECT and INSERT
      // (e.g. the nightly team verdicts fire concurrently). The loser must fold its spend into
      // the existing row, not drop it - dropped spend under-counts the fail-closed cap.
      if ((insErr as { code?: string }).code === "23505") {
        const { data: row } = await supabase
          .from("llm_budget_ledger")
          .select("spent_usd, call_count, prompt_count, chunk_count")
          .eq("tenant_id", input.tenantId)
          .eq("date_utc", date)
          .eq("platform", input.platform)
          .maybeSingle();
        if (row) {
          const { error: retryErr } = await supabase
            .from("llm_budget_ledger")
            .update({
              spent_usd: Math.max(0, Number(row.spent_usd) + input.costUsd),
              call_count: Number(row.call_count) + 1,
              prompt_count: Number(row.prompt_count) + promptCount,
              chunk_count: Number(row.chunk_count) + chunkCount,
              last_run_id: input.runId ?? null,
              updated_at: nowIso,
            })
            .eq("tenant_id", input.tenantId)
            .eq("date_utc", date)
            .eq("platform", input.platform);
          if (!retryErr) return true;
        }
      }
      console.warn(
        `[budget-ledger] insert failed (non-fatal) tenantId=${input.tenantId} ` +
          `platform=${input.platform}: ${insErr.message}`,
      );
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[budget-ledger] dual-write threw (non-fatal): ${msg}`);
    return false;
  }
}

/**
 * audit #4 (2026-06-14) — this-MONTH TOTAL spend for a tenant from
 * `llm_budget_ledger` (the durable cross-run ledger). The file-backed
 * monthly cap silently fail-opens wherever `.data` is ephemeral/read-only
 * (Vercel + every GitHub Actions run), so the monthly cap is sourced from
 * Supabase. Same fail-OPEN-on-error contract as getTenantSpentTodayUsd:
 * null on read error → caller falls back to the file ledger, with the
 * per-run cost ceiling as the always-on backstop.
 */
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
    // Platform-scoped read: the adjudicator's MONTHLY cap must count only
    // adjudicator spend, not the much larger native-poll spend that shares
    // this ledger — otherwise poll spend would trip the $10 adjudicator cap
    // almost immediately (fail-CLOSED prematurely).
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
