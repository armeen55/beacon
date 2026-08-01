import "server-only";

/**
 * cost-breaker (BEACON_500 R22a / N43, 2026-07-03) - the GLOBAL cost circuit
 * breaker: one outer guard OVER every per-platform cap.
 *
 * WHY, given we already have per-platform caps. The adjudicator cap ($10/mo),
 * the DataForSEO SERP cap ($250/mo per account), the retrieval-twin embeddings
 * cap, and the page-factory daily cap each protect ONE spend lane. None of them
 * can see the
 * others. A month where every lane runs near its own ceiling still adds up to a
 * bill nobody approved. This breaker sums the WHOLE `llm_budget_ledger` for the
 * current UTC month (every tenant, every platform) and TRIPS CLOSED when the
 * combined total crosses a single global ceiling. It is belt-and-suspenders:
 * it never LOOSENS a per-platform cap, only ever adds an outer refusal.
 *
 * Contract (mirrors the fail-closed posture of dataforseo-serp's monthly cap):
 *   1. It is consulted by every PAID entrypoint (SERP gauntlet, LLM gateway)
 *      BEFORE that entrypoint's own per-platform cap runs. A trip here refuses
 *      the call before the inner cap is even read.
 *   2. It NEVER blocks free work. It is only ever called on the paid path, so a
 *      cache hit, a dry-run, or any deterministic no-LLM code path never reaches
 *      it. `assertPaidCallAllowed` is the only enforcement seam.
 *   3. Ceiling: env BEACON_GLOBAL_MONTHLY_CAP_USD, default 500. A missing /
 *      NaN / non-positive env resolves to the SAFE default (500), never to
 *      "unlimited" - an unset ceiling can never mean no ceiling.
 *   4. FAIL-CLOSED on an unreadable ledger: if the paid path asks and the spend
 *      total cannot be read (no env, Supabase error), the breaker trips (no
 *      call). This matches dataforseo-serp: "monthly spend unknown, failing
 *      closed". It is only reached when a paid call is ATTEMPTED, so free work
 *      is never affected by a ledger read failure.
 *
 * Honest status line (Beacon voice, first person, a concrete number, no lab
 * words, no dashes): "I have spent $0.42 of my $500 monthly ceiling across all
 * research." Rendered wherever cross-lane spend is shown.
 *
 * Pure decision core (`decideBreaker`) + a thin I/O wrapper so tests never touch
 * a real ledger. Every dependency is injectable.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/** The safe default ceiling when the env is unset / NaN / non-positive. Raised from $100 to $500 on
 *  operator authority (2026-07-31), in step with the per-account DataForSEO ceiling: this is the OUTER
 *  guard over every lane, so it has to sit above what the lanes beneath it are now allowed to spend. It
 *  still never loosens a per-platform cap and still fails closed on an unreadable ledger. */
export const DEFAULT_GLOBAL_MONTHLY_CAP_USD = 500;

/**
 * Resolve the global monthly ceiling. A missing, non-numeric, or non-positive
 * env value resolves to the SAFE default - an unset ceiling never means
 * "unlimited". Pure.
 */
export function globalMonthlyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BEACON_GLOBAL_MONTHLY_CAP_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GLOBAL_MONTHLY_CAP_USD;
}

export type BreakerVerdict =
  | { tripped: false; spentUsd: number; capUsd: number; projectedUsd: number }
  | { tripped: true; reason: string; spentUsd: number | null; capUsd: number; projectedUsd: number };

/**
 * PURE breaker decision. Trips CLOSED when:
 *   - spend is unknown (null) - fail-closed, the paid path asked and we could
 *     not confirm the total is under the ceiling, so refuse; OR
 *   - the current total is ALREADY at/over the ceiling; OR
 *   - this call's projected cost would push the total OVER the ceiling.
 *
 * The at-boundary clause (`spent >= cap`) matches the per-platform caps
 * (budget.ts `spent >= cap`, adjudicator `spendUsd >= capUsd`) so the outer
 * guard is never LESS strict than the inner ones.
 */
export function decideBreaker(args: {
  spentUsd: number | null;
  capUsd: number;
  projectedUsd?: number;
}): BreakerVerdict {
  const projectedUsd = Number.isFinite(args.projectedUsd) && (args.projectedUsd ?? 0) > 0 ? args.projectedUsd! : 0;
  const capUsd = args.capUsd;

  if (args.spentUsd === null) {
    return {
      tripped: true,
      reason: `I could not confirm my total spend this month, so I held the paid call to stay under my $${capUsd} ceiling.`,
      spentUsd: null,
      capUsd,
      projectedUsd,
    };
  }
  const spentUsd = args.spentUsd;
  if (spentUsd >= capUsd || spentUsd + projectedUsd > capUsd) {
    return {
      tripped: true,
      reason: `I have spent $${round2(spentUsd)} this month across all research, which is at my $${capUsd} ceiling, so I held this paid call.`,
      spentUsd,
      capUsd,
      projectedUsd,
    };
  }
  return { tripped: false, spentUsd, capUsd, projectedUsd };
}

export type CostBreakerDeps = {
  env: NodeJS.ProcessEnv;
  /** Combined month-to-date spend across ALL tenants + platforms, or null on a
   *  read failure (fail-closed on the paid path). */
  readGlobalMonthSpendUsd: (now: Date) => Promise<number | null>;
  now: () => Date;
};

const defaultDeps: CostBreakerDeps = {
  env: process.env,
  readGlobalMonthSpendUsd: readGlobalMonthSpendSupabase,
  now: () => new Date(),
};

/**
 * The combined month-to-date spend across every tenant + platform in
 * `llm_budget_ledger` (the same durable table the per-platform caps read, so
 * the outer guard can never disagree with them). Fail-soft to null on any read
 * error / no env - the caller treats null as fail-closed on the paid path.
 */
async function readGlobalMonthSpendSupabase(now: Date): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseAdmin();
    const monthStart = `${now.toISOString().slice(0, 7)}-01`; // YYYY-MM-01
    // tenant-isolation-exempt: N43 is a GLOBAL cost ceiling by design - it must
    // sum spend across EVERY tenant + platform, not one tenant, so this read is
    // deliberately tenant-blind. It aggregates to a single scalar total; no
    // per-tenant data ever crosses a boundary.
    const { data, error } = await supabase
      .from("llm_budget_ledger")
      .select("spent_usd")
      .gte("date_utc", monthStart);
    if (error || !Array.isArray(data)) return null;
    let total = 0;
    for (const row of data as Array<{ spent_usd?: number | string }>) {
      const n = Number(row.spent_usd);
      if (Number.isFinite(n)) total += n;
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * The read-only status snapshot for surfaces + the enforcement path. Reads the
 * combined month spend and the resolved ceiling. `spentUsd` is null when the
 * total could not be read (surfaces render a calm "checking" fallback; the paid
 * path treats it as fail-closed). Never throws.
 */
export async function getGlobalSpendStatus(
  depsOverride: Partial<CostBreakerDeps> = {},
): Promise<{ spentUsd: number | null; capUsd: number }> {
  const deps = { ...defaultDeps, ...depsOverride };
  const capUsd = globalMonthlyCapUsd(deps.env);
  const spentUsd = await deps.readGlobalMonthSpendUsd(deps.now()).catch(() => null);
  return { spentUsd, capUsd };
}

/**
 * The honest one-line status. Beacon voice: first person, a concrete number, no
 * lab words, no dashes. Falls back to a calm "checking" line when the total is
 * not yet readable (never a bare zero pretending to be real). Pure.
 */
export function globalSpendStatusLine(status: { spentUsd: number | null; capUsd: number }): string {
  if (status.spentUsd === null) {
    return `I am checking my total spend against my $${status.capUsd} monthly ceiling across all research.`;
  }
  return `I have spent $${round2(status.spentUsd)} of my $${status.capUsd} monthly ceiling across all research.`;
}

/**
 * THE enforcement seam. Call this on the PAID path only, BEFORE the per-platform
 * cap. Returns the verdict; a tripped verdict means the outer global ceiling
 * refuses the call regardless of what the inner per-platform cap would say.
 *
 * NEVER call this on a free path (cache hit, dry-run, deterministic code) - it
 * is designed to be reached only when real money is about to be spent, so it can
 * never block free work.
 */
export async function assertPaidCallAllowed(
  args: { projectedCostUsd?: number } = {},
  depsOverride: Partial<CostBreakerDeps> = {},
): Promise<BreakerVerdict> {
  const deps = { ...defaultDeps, ...depsOverride };
  const capUsd = globalMonthlyCapUsd(deps.env);
  const spentUsd = await deps.readGlobalMonthSpendUsd(deps.now()).catch(() => null);
  const verdict = decideBreaker({ spentUsd, capUsd, projectedUsd: args.projectedCostUsd });
  if (verdict.tripped) {
    log.warn("[cost-breaker] global monthly ceiling tripped - paid call held", {
      spentUsd: verdict.spentUsd,
      capUsd: verdict.capUsd,
      projectedUsd: verdict.projectedUsd,
    });
  }
  return verdict;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const __testing = { readGlobalMonthSpendSupabase };
