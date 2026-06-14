import "server-only";

/**
 * Phase 2 Stage B.2 — read-only verifier for the dual-write ledger.
 *
 * Compares `public.llm_budget_ledger` against the authoritative
 * sibling tables (`observation_runs`, `prompt_answer_observations`)
 * for a given UTC date and reports per-platform pass/fail/note status.
 *
 * Read-only: no INSERT / UPDATE / DELETE. Safe to run any time.
 *
 * Used by `scripts/verify-budget-ledger.ts` for post-poll ops checks.
 *
 * Empty-state semantics
 * ---------------------
 *   • No observation_runs for the date AND no ledger rows ⇒ status
 *     `pending` for both platforms with reason "no poll yet". Not a
 *     failure — the verifier is also called before the daily poll.
 *   • observation_runs exist but ledger empty ⇒ each platform reports
 *     `failed` with reason "ledger row missing" — this is the
 *     dual-write-flag-not-flipped failure mode, exactly what we want
 *     loud.
 *   • Ledger row present, observation_runs absent ⇒ `failed` with
 *     reason "ledger row without backing observation_run" — would
 *     indicate a stray write or a clock skew.
 *
 * Tolerances
 * ----------
 *   • spent_usd vs scope_label cost: the runner stores
 *     `result.observations.length * costRate` in raw_poll_chunks.cost_usd
 *     and dual-writes the same value. The ledger row's spent_usd MUST
 *     equal the SUM of cost_usd for runs on that (tenant, platform,
 *     date) — any drift > $0.01 fails.
 *   • prompt_count must match the SUM of persisted observations from
 *     prompt_answer_observations (truth via the post-reconciliation
 *     count the runner records).
 *   • chunk_count must match the count of `completed` observation_runs
 *     for the (source, date, tenant).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

// ─── Types ───────────────────────────────────────────────────────────────

export type LedgerVerifyStatus = "ok" | "pending" | "warn" | "failed";

export type LedgerPlatformReport = {
  ledgerPlatform: "perplexity" | "openai";
  /** observation_runs.source value that maps to this ledger platform. */
  observationRunSource: "perplexity-native-poll" | "openai-native-poll";
  /** prompt_answer_observations.platform value. */
  observationsPlatformLabel: "perplexity" | "chatgpt";
  status: LedgerVerifyStatus;
  ledgerRow: {
    tenant_id: string;
    spent_usd: number;
    call_count: number;
    prompt_count: number;
    chunk_count: number;
    last_run_id: string | null;
  } | null;
  observationRuns: {
    completed: number;
    runIds: string[];
    sumCostUsdFromScopeLabel: number | null;
  };
  observationsPersisted: number;
  notes: string[];
};

export type LedgerVerifyReport = {
  date: string;
  /** All ledger rows for this date keyed by `(tenant_id, platform)`. */
  ledgerRows: Array<{
    tenant_id: string;
    platform: string;
    spent_usd: number;
    prompt_count: number;
    chunk_count: number;
    last_run_id: string | null;
  }>;
  /** True if any row repeats the (tenant_id, date_utc, platform) grain. */
  duplicateRowsDetected: boolean;
  perPlatform: LedgerPlatformReport[];
  /** Aggregate verdict — fails if any platform fails or duplicates exist. */
  overall: LedgerVerifyStatus;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * scope_label format used by `runNativePoll`:
 *   "Native perplexity poll · chunk offset=0 limit=all · 100/100 prompts · cost=$0.0917"
 * Returns the parsed cost as a USD float, or null if absent / malformed.
 */
function parseCostUsdFromScopeLabel(scope: string | null | undefined): number | null {
  if (!scope) return null;
  const m = /cost=\$?(\d+(?:\.\d+)?)/i.exec(scope);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const PLATFORM_PAIRS = [
  {
    ledgerPlatform: "perplexity" as const,
    observationRunSource: "perplexity-native-poll" as const,
    observationsPlatformLabel: "perplexity" as const,
  },
  {
    ledgerPlatform: "openai" as const,
    observationRunSource: "openai-native-poll" as const,
    observationsPlatformLabel: "chatgpt" as const,
  },
];

const COST_TOLERANCE_USD = 0.01;

// ─── Public API ──────────────────────────────────────────────────────────

export async function verifyBudgetLedger(
  date: string,
): Promise<LedgerVerifyReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`verifyBudgetLedger: bad date "${date}", expected YYYY-MM-DD`);
  }
  const supabase = getSupabaseAdmin();
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  // 1. Ledger rows for this date.
  // tenant-isolation-exempt: this is a FLEET-WIDE operator/CI ledger-integrity
  // verifier — it intentionally reads every tenant's rows for the date and
  // reports per-tenant (tenant_id is selected + grouped downstream). Not a
  // customer surface.
  const { data: ledgerData, error: ledgerErr } = await supabase
    .from("llm_budget_ledger")
    .select("tenant_id, platform, spent_usd, call_count, prompt_count, chunk_count, last_run_id")
    .eq("date_utc", date);
  if (ledgerErr) {
    throw new Error(`ledger read failed: ${ledgerErr.message}`);
  }
  const ledgerRows = (ledgerData ?? []).map((r) => ({
    tenant_id: String(r.tenant_id),
    platform: String(r.platform),
    spent_usd: Number(r.spent_usd),
    call_count: Number(r.call_count),
    prompt_count: Number(r.prompt_count),
    chunk_count: Number(r.chunk_count),
    last_run_id: r.last_run_id == null ? null : String(r.last_run_id),
  }));

  // Duplicate detection at PK grain.
  const seen = new Set<string>();
  let duplicateRowsDetected = false;
  for (const row of ledgerRows) {
    const key = `${row.tenant_id}|${date}|${row.platform}`;
    if (seen.has(key)) {
      duplicateRowsDetected = true;
      break;
    }
    seen.add(key);
  }

  // 2. observation_runs for this date.
  // tenant-isolation-exempt: fleet-wide ledger verifier (see note 1 above).
  const { data: runsData, error: runsErr } = await supabase
    .from("observation_runs")
    .select("run_id, source, status, scope_label, tenant_id, completed_at")
    .gte("completed_at", dayStart)
    .lte("completed_at", dayEnd)
    .in("source", ["perplexity-native-poll", "openai-native-poll"]);
  if (runsErr) {
    throw new Error(`observation_runs read failed: ${runsErr.message}`);
  }
  const runsBySource = new Map<
    string,
    Array<{
      run_id: string;
      status: string;
      scope_label: string;
      tenant_id: string;
    }>
  >();
  for (const r of runsData ?? []) {
    const arr = runsBySource.get(String(r.source)) ?? [];
    arr.push({
      run_id: String(r.run_id),
      status: String(r.status),
      scope_label: String(r.scope_label ?? ""),
      tenant_id: String(r.tenant_id ?? ""),
    });
    runsBySource.set(String(r.source), arr);
  }

  // 3. prompt_answer_observations counts for this date by platform label.
  // tenant-isolation-exempt: fleet-wide ledger verifier (see note 1 above) —
  // the day-total observation counts span all tenants by design.
  const obsCounts = new Map<string, number>();
  for (const pair of PLATFORM_PAIRS) {
    const { count, error } = await supabase
      .from("prompt_answer_observations")
      .select("*", { count: "exact", head: true })
      .gte("observed_at", dayStart)
      .lte("observed_at", dayEnd)
      .eq("platform", pair.observationsPlatformLabel);
    if (error) {
      throw new Error(
        `prompt_answer_observations count failed for ${pair.observationsPlatformLabel}: ${error.message}`,
      );
    }
    obsCounts.set(pair.observationsPlatformLabel, count ?? 0);
  }

  // 4. Build per-platform reports.
  const perPlatform: LedgerPlatformReport[] = PLATFORM_PAIRS.map((pair) => {
    const ledgerRow =
      ledgerRows.find((r) => r.platform === pair.ledgerPlatform) ?? null;

    const runs = runsBySource.get(pair.observationRunSource) ?? [];
    const completedRuns = runs.filter((r) => r.status === "completed");
    const sumCost = completedRuns.reduce((acc, r) => {
      const c = parseCostUsdFromScopeLabel(r.scope_label);
      return c == null ? acc : acc + c;
    }, 0);
    const obsPersisted = obsCounts.get(pair.observationsPlatformLabel) ?? 0;
    const notes: string[] = [];

    let status: LedgerVerifyStatus;

    if (completedRuns.length === 0 && ledgerRow === null) {
      status = "pending";
      notes.push("no poll yet (no observation_runs and no ledger row)");
    } else if (completedRuns.length === 0 && ledgerRow !== null) {
      status = "failed";
      notes.push(
        "ledger row exists but no completed observation_runs for this date — orphan ledger row or clock skew",
      );
    } else if (completedRuns.length > 0 && ledgerRow === null) {
      status = "failed";
      notes.push(
        `${completedRuns.length} completed run(s) but no ledger row — dual-write flag may be off in the runner`,
      );
    } else {
      // Both present — full verification. Track failed/warn flags so a
      // later warn-level finding cannot demote a prior failed verdict.
      const lr = ledgerRow!;
      let isFailed = false;
      let isWarn = false;
      if (!(lr.spent_usd > 0)) {
        isFailed = true;
        notes.push(`spent_usd is ${lr.spent_usd}; expected > 0`);
      }
      const costDrift = Math.abs(lr.spent_usd - sumCost);
      if (sumCost > 0 && costDrift > COST_TOLERANCE_USD) {
        isWarn = true;
        notes.push(
          `spent_usd ${lr.spent_usd.toFixed(4)} differs from observation_runs cost sum ${sumCost.toFixed(4)} by $${costDrift.toFixed(4)} (>${COST_TOLERANCE_USD})`,
        );
      }
      if (lr.prompt_count !== obsPersisted) {
        isWarn = true;
        notes.push(
          `prompt_count ${lr.prompt_count} ≠ persisted observations ${obsPersisted}`,
        );
      }
      if (lr.chunk_count !== completedRuns.length) {
        isWarn = true;
        notes.push(
          `chunk_count ${lr.chunk_count} ≠ completed observation_runs ${completedRuns.length}`,
        );
      }
      if (
        lr.last_run_id !== null &&
        !completedRuns.some((r) => r.run_id === lr.last_run_id)
      ) {
        isWarn = true;
        notes.push(
          `last_run_id "${lr.last_run_id}" not found in this date's completed runs`,
        );
      }
      status = isFailed ? "failed" : isWarn ? "warn" : "ok";
    }

    return {
      ledgerPlatform: pair.ledgerPlatform,
      observationRunSource: pair.observationRunSource,
      observationsPlatformLabel: pair.observationsPlatformLabel,
      status,
      ledgerRow:
        ledgerRow == null
          ? null
          : {
              tenant_id: ledgerRow.tenant_id,
              spent_usd: ledgerRow.spent_usd,
              call_count: ledgerRow.call_count,
              prompt_count: ledgerRow.prompt_count,
              chunk_count: ledgerRow.chunk_count,
              last_run_id: ledgerRow.last_run_id,
            },
      observationRuns: {
        completed: completedRuns.length,
        runIds: completedRuns.map((r) => r.run_id),
        sumCostUsdFromScopeLabel: completedRuns.length === 0 ? null : sumCost,
      },
      observationsPersisted: obsPersisted,
      notes,
    };
  });

  // 5. Overall verdict.
  let overall: LedgerVerifyStatus = "ok";
  if (duplicateRowsDetected) overall = "failed";
  for (const p of perPlatform) {
    if (p.status === "failed") {
      overall = "failed";
      break;
    }
    if (p.status === "warn" && overall !== "failed") overall = "warn";
    if (p.status === "pending" && overall === "ok") overall = "pending";
  }

  return {
    date,
    ledgerRows,
    duplicateRowsDetected,
    perPlatform,
    overall,
  };
}
