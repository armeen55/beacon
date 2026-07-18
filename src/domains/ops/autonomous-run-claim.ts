import "server-only";

/**
 * autonomous-run-claim - the CROSS-INSTANCE atomic lock for the on-visit
 * autonomous research cycle (src/domains/ops/on-visit-refresh.ts).
 *
 * THE PROBLEM this closes: the cycle's only dedup was a per-process
 * `const scheduled = new Set()` (useless across Vercel instances) plus a
 * read-then-write daily receipt check with two awaited network round-trips in
 * between. Two concurrent requests landing on two different lambdas both passed
 * the check and both ran the PAID pipeline (DataForSEO + LLM). There were no
 * advisory locks or conditional writes anywhere in the codebase.
 *
 * THE FIX: an INSERT into `autonomous_run_claims` keyed by
 * (tenant_id, day_key) is atomic. Exactly one instance wins ("claimed"); every
 * concurrent instance loses on the unique-violation ("already-claimed") and
 * exits quietly. When Supabase is unreachable or the table is not migrated in
 * yet, we return "unavailable" and the caller falls back to its best-effort
 * in-memory + receipt behavior - the product must never block on DB health.
 *
 * LIFECYCLE / RETRY DESIGN (why the row is short-lived, not a day-long marker):
 *   - The claim is a LOCK, not the idempotency record. The durable warm receipt
 *     (shouldRunAutonomousResearch) is the source of truth for "did today's pass
 *     already succeed?" and for the retry cooldown after a failure.
 *   - The winning instance therefore RELEASES the claim (releaseAutonomousRun)
 *     in a finally, whatever the outcome. This keeps all three requirements:
 *       1. a failed run can retry after cooldown - the receipt gates the retry,
 *          and the released row lets a later visit re-own the cycle;
 *       2. a successful run does not rerun the same day - the receipt's
 *          shouldRun=false blocks it, so the released row is harmless;
 *       3. concurrent duplicates are impossible WHILE a claim row exists - the
 *          row exists for exactly the owning instance's active cycle window,
 *          which is precisely when a second paid pipeline must be prevented.
 *   - Releasing on success (instead of leaving a day-long marker) is what keeps
 *     the per-visit maintenance (connector refresh, ready-queue replenishment)
 *     running on later same-day visits, exactly as before this lock existed.
 *
 * Mirrors the storage idiom of confirmation-reads-store.ts / cron-runs-store.ts:
 * service-role admin client; getSupabaseAdmin() throwing (no env, local dev) or
 * a missing table (PGRST205 / 42P01 / PGRST204) routes to "unavailable" rather
 * than throwing.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

const TABLE = "autonomous_run_claims";

/** Postgres unique-violation SQLSTATE (a duplicate primary key). */
const UNIQUE_VIOLATION = "23505";

export type ClaimResult = "claimed" | "already-claimed" | "unavailable";

function isMissingTable(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (
    typeof e.code === "string" &&
    (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")
  ) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /schema cache|could not find the table/i.test(e.message)
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === UNIQUE_VIOLATION;
}

/**
 * Atomically claim today's autonomous cycle for one tenant.
 *   - "claimed"        -> this instance won; it OWNS the cycle and MUST call
 *                         releaseAutonomousRun(tenantId, dayKey) when done.
 *   - "already-claimed"-> another instance owns today's cycle right now; the
 *                         caller must exit quietly and write nothing.
 *   - "unavailable"    -> Supabase is not configured / not reachable / the table
 *                         is not migrated yet; the caller falls back to its
 *                         best-effort in-memory + receipt behavior.
 * NEVER throws.
 */
export async function claimAutonomousRun(tenantId: string, dayKey: string): Promise<ClaimResult> {
  if (!tenantId || !dayKey) return "unavailable";

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return "unavailable"; // no Supabase env (local dev) -> best-effort fallback
  }

  try {
    const { error } = await admin
      .from(TABLE)
      .insert({ tenant_id: tenantId, day_key: dayKey });
    if (error == null) return "claimed";
    if (isUniqueViolation(error)) return "already-claimed";
    if (isMissingTable(error)) {
      console.warn(
        `[autonomous-run-claim] table not migrated yet, running without the cross-instance lock (apply migrations/2026-07-18_autonomous_run_claims.sql): ${
          (error as { code?: string }).code ?? "?"
        } ${(error as { message?: string }).message ?? String(error)}`,
      );
      return "unavailable";
    }
    log.warn("[autonomous-run-claim] claim insert failed", {
      tenantId,
      dayKey,
      error: (error as { message?: string }).message ?? String(error),
    });
    return "unavailable";
  } catch (e) {
    log.warn("[autonomous-run-claim] claim insert threw", {
      tenantId,
      dayKey,
      error: e instanceof Error ? e.message : String(e),
    });
    return "unavailable";
  }
}

/**
 * Release a claim previously won by claimAutonomousRun. The owning instance
 * calls this in a finally regardless of outcome (see the lifecycle note above):
 * the claim is a lock, not the daily idempotency record. FAIL-SOFT: never
 * throws. A missed release is self-healing - the row would only block the same
 * tenant's next visit, and the daily receipt still prevents a duplicate paid
 * pass; a stuck lock is corrected by its own age on the next Pacific day-key.
 */
export async function releaseAutonomousRun(tenantId: string, dayKey: string): Promise<void> {
  if (!tenantId || !dayKey) return;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return; // nothing durable was claimed
  }

  try {
    const { error } = await admin
      .from(TABLE)
      .delete()
      .eq("tenant_id", tenantId)
      .eq("day_key", dayKey);
    if (error != null && !isMissingTable(error)) {
      log.warn("[autonomous-run-claim] release delete failed", {
        tenantId,
        dayKey,
        error: (error as { message?: string }).message ?? String(error),
      });
    }
  } catch (e) {
    log.warn("[autonomous-run-claim] release delete threw", {
      tenantId,
      dayKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const __testing = { isMissingTable, isUniqueViolation };
