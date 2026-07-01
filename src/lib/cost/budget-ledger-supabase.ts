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

export type LedgerPlatform =
  | "perplexity"
  | "openai"
  | "adjudicator-openai"
  | "dataforseo-serp"
  | "other";

const VALID_PLATFORMS: ReadonlySet<string> = new Set<LedgerPlatform>([
  "perplexity",
  "openai",
  "adjudicator-openai",
  "dataforseo-serp",
  "other",
]);

export type RecordSpendDualWriteInput = {
  /** Resolved tenant id (e.g. `tenant-ritz-founder`). Must be nonempty. */
  tenantId: string;
  /** Platform enum matching the migration's CHECK constraint. */
  platform: LedgerPlatform;
  /** Cost of THIS call/chunk in USD. Must be a finite nonnegative number. */
  costUsd: number;
  /** Optional. Number of prompts polled in this call. Default 0. */
  promptCount?: number;
  /** Optional. Number of chunks completed in this call. Default 0. */
  chunkCount?: number;
  /** Optional. observation_run_id of this run, stamped to last_run_id. */
  runId?: string | null;
  /** Optional. Stamped to the row's `metadata` jsonb (last-writer-wins). */
  metadata?: Record<string, unknown>;
};

export type SpendSnapshotRow = {
  tenant_id: string;
  platform: string;
  spent_usd: number;
  cap_usd: number | null;
  prompt_count: number;
};

// ─── Flag check ──────────────────────────────────────────────────────────

export function isBudgetLedgerDualWriteEnabled(): boolean {
  return process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE === "1";
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Dual-write a spend event to `public.llm_budget_ledger`.
 *
 * No-op when `BEACON_BUDGET_LEDGER_DUAL_WRITE !== "1"`. Never throws.
 *
 * Callers MUST already have written to the JSON ledger (the source of
 * truth in shadow mode). This helper is purely additive: a Supabase
 * read failure, validation rejection, or insert error WILL NOT
 * affect the JSON ledger or the polling pipeline.
 */
/**
 * Flag-gated dual-write for the SHADOW poll path: a no-op unless
 * `BEACON_BUDGET_LEDGER_DUAL_WRITE === "1"`. Delegates to the always-on writer.
 */
export async function recordSpendDualWrite(
  input: RecordSpendDualWriteInput,
): Promise<void> {
  if (!isBudgetLedgerDualWriteEnabled()) return;
  await recordSpendSupabase(input);
}

/**
 * ALWAYS-ON durable spend writer to `public.llm_budget_ledger`. NOT flag-gated —
 * use this for spend that a daily/monthly CAP must actually see (e.g. the page
 * factory): getTenantSpentTodayUsd reads this same table, so gating the write
 * behind the shadow-mode flag made those caps structurally fail-OPEN. Never
 * throws; a Supabase error is logged and swallowed.
 */
export async function recordSpendSupabase(
  input: RecordSpendDualWriteInput,
): Promise<void> {
  // ── Validation (fail loud BEFORE any Supabase round-trip) ──
  if (typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    console.warn(
      `[budget-ledger] dual-write rejected: empty tenantId platform=${input.platform}`,
    );
    return;
  }
  if (!VALID_PLATFORMS.has(input.platform)) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid platform "${input.platform}"`,
    );
    return;
  }
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid costUsd=${input.costUsd} tenantId=${input.tenantId}`,
    );
    return;
  }
  const promptCount = input.promptCount ?? 0;
  const chunkCount = input.chunkCount ?? 0;
  if (!Number.isInteger(promptCount) || promptCount < 0) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid promptCount=${promptCount}`,
    );
    return;
  }
  if (!Number.isInteger(chunkCount) || chunkCount < 0) {
    console.warn(
      `[budget-ledger] dual-write rejected: invalid chunkCount=${chunkCount}`,
    );
    return;
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
      return;
    }

    if (existing) {
      const { error: updErr } = await supabase
        .from("llm_budget_ledger")
        .update({
          spent_usd: Number(existing.spent_usd) + input.costUsd,
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
      }
      return;
    }

    const { error: insErr } = await supabase.from("llm_budget_ledger").insert({
      tenant_id: input.tenantId,
      date_utc: date,
      platform: input.platform,
      spent_usd: input.costUsd,
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
              spent_usd: Number(row.spent_usd) + input.costUsd,
              call_count: Number(row.call_count) + 1,
              prompt_count: Number(row.prompt_count) + promptCount,
              chunk_count: Number(row.chunk_count) + chunkCount,
              last_run_id: input.runId ?? null,
              updated_at: nowIso,
            })
            .eq("tenant_id", input.tenantId)
            .eq("date_utc", date)
            .eq("platform", input.platform);
          if (!retryErr) return;
        }
      }
      console.warn(
        `[budget-ledger] insert failed (non-fatal) tenantId=${input.tenantId} ` +
          `platform=${input.platform}: ${insErr.message}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[budget-ledger] dual-write threw (non-fatal): ${msg}`);
  }
}

/**
 * Read-only spend snapshot for a UTC date (YYYY-MM-DD). Returns `[]`
 * on any error or when the table is empty/unavailable. NOT flag-gated
 * — safe to call from canary/diagnostic code at any time.
 */
export async function readSpendSnapshotForDate(
  date: string,
): Promise<SpendSnapshotRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.warn(`[budget-ledger] readSpendSnapshotForDate: bad date "${date}"`);
    return [];
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("llm_budget_ledger")
      .select("tenant_id, platform, spent_usd, daily_cap_usd, prompt_count")
      .eq("date_utc", date);
    if (error) {
      console.warn(
        `[budget-ledger] read snapshot failed (non-fatal): ${error.message}`,
      );
      return [];
    }
    return (data ?? []).map((r) => ({
      tenant_id: String(r.tenant_id),
      platform: String(r.platform),
      spent_usd: Number(r.spent_usd),
      cap_usd:
        r.daily_cap_usd === null || r.daily_cap_usd === undefined
          ? null
          : Number(r.daily_cap_usd),
      prompt_count: Number(r.prompt_count),
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[budget-ledger] read snapshot threw (non-fatal): ${msg}`);
    return [];
  }
}

/**
 * 2026-06-10 (audit #31/#35) — today's TOTAL spend for a tenant across
 * all platforms, from `llm_budget_ledger`. Powers the per-tenant daily
 * spend CEILING enforced in the poll runner. Fail-OPEN: a read error
 * returns null (caller treats null as "unknown → allow") so a transient
 * Supabase hiccup never blocks legitimate polling — the per-run cost
 * ceiling remains the backstop.
 */
export async function getTenantSpentTodayUsd(
  tenantId: string,
  now: Date = new Date(),
): Promise<number | null> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") return 0;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("llm_budget_ledger")
      .select("spent_usd")
      .eq("tenant_id", tenantId)
      .eq("date_utc", todayUtcDate(now));
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
 * audit #4 (2026-06-14) — this-MONTH TOTAL spend for a tenant from
 * `llm_budget_ledger` (the durable cross-run ledger). The file-backed
 * monthly cap silently fail-opens wherever `.data` is ephemeral/read-only
 * (Vercel + every GitHub Actions run), so the monthly cap is sourced from
 * Supabase. Same fail-OPEN-on-error contract as getTenantSpentTodayUsd:
 * null on read error → caller falls back to the file ledger, with the
 * per-run cost ceiling as the always-on backstop.
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
