import "server-only";

/**
 * Poll Integrity Hardening (2026-05-04, post May 2-4 incident).
 *
 * Centralizes the contract that gates the native-poll pipeline:
 *
 *   1. Reconciliation — count actual persisted observations for a run
 *      and compare to expected. Throw on mismatch so the API endpoint
 *      returns 5xx and the GitHub Actions workflow turns red.
 *
 *   2. Paid-call guards — if cost_usd > 0 and 0 rows persisted, OR if
 *      reported prompts > 0 and 0 rows persisted, OR if completed
 *      chunks but persisted < expected, hard-fail.
 *
 *   3. Auto-disable — gate the next paid run when the latest run on
 *      this (tenant, source) failed for persistence reasons. Operator
 *      must acknowledge or a successful canary must run before paid
 *      polls resume.
 *
 * The heavy lifting lives here; `run-poll.ts` calls these helpers in
 * sequence. All Supabase access is read-only EXCEPT the run-status
 * update path, which is the only legitimate write surface.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

// ── Reconciliation ───────────────────────────────────────────────────

export type ReconciliationVerdict = {
  readonly ok: boolean;
  readonly persistedObsCount: number;
  readonly expectedObsCount: number;
  readonly costUsd: number;
  readonly reasons: ReadonlyArray<string>;
};

export type ReconcilePolledRunArgs = {
  readonly tenantId: string;
  readonly runId: string;
  readonly expectedObsCount: number;
  readonly costUsd: number;
};

/**
 * Read the actual persisted observation count for a (tenant, run_id) and
 * apply the operator-mandated paid-call guards. Returns a verdict the
 * caller can act on.
 *
 * Read-only: SELECT only. The caller is responsible for any state
 * mutation (e.g. flipping the run row to status='failed').
 */
export async function reconcilePolledRun(
  args: ReconcilePolledRunArgs,
): Promise<ReconciliationVerdict> {
  const { tenantId, runId, expectedObsCount, costUsd } = args;
  const sb = getSupabaseAdmin();
  const { data, error, count } = await sb
    .from("prompt_answer_observations")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("run_id", runId);
  if (error) {
    // Failure to query the truth = treat as reconciliation failure.
    return {
      ok: false,
      persistedObsCount: 0,
      expectedObsCount,
      costUsd,
      reasons: [
        `Reconciliation read FAILED for run_id=${runId}: ${error.message ?? String(error)}. Treating as zero-persistence to be safe.`,
      ],
    };
  }
  // Note: data is empty when head:true; only `count` is meaningful.
  void data;
  const persisted = typeof count === "number" ? count : 0;

  const reasons: string[] = [];

  // Operator R2 guard 1: paid call cost > 0 AND zero persisted.
  if (costUsd > 0 && persisted === 0) {
    reasons.push(
      `Paid call cost $${costUsd.toFixed(4)} but ZERO observations persisted (silent-write-failure pattern, May 2-4 incident class).`,
    );
  }

  // Operator R2 guard 2: reported prompts > 0 AND zero persisted.
  if (expectedObsCount > 0 && persisted === 0) {
    reasons.push(
      `Reported ${expectedObsCount} prompts polled but ZERO observations persisted to Supabase.`,
    );
  }

  // Operator R2 guard 3: completed chunks AND persisted < expected.
  // Only fires when costUsd or expectedCount is non-zero AND there's a
  // gap. Equality means clean.
  if (
    expectedObsCount > 0 &&
    persisted > 0 &&
    persisted < expectedObsCount
  ) {
    reasons.push(
      `Run reported ${expectedObsCount} prompts but only ${persisted} observations persisted — ${expectedObsCount - persisted} missing.`,
    );
  }

  return {
    ok: reasons.length === 0,
    persistedObsCount: persisted,
    expectedObsCount,
    costUsd,
    reasons,
  };
}

/**
 * Marks the run row as failed with reconciliation reasons. Called when
 * `reconcilePolledRun` returns ok:false. The reasons are appended to
 * the existing `scope_label` so they surface in /today's poll banner +
 * the canary's CI failure email. This is the ONLY write the
 * poll-integrity module performs.
 */
export async function markRunPersistenceFailed(args: {
  readonly tenantId: string;
  readonly runId: string;
  readonly reasons: ReadonlyArray<string>;
  readonly persistedObsCount: number;
  readonly expectedObsCount: number;
  readonly costUsd: number;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  // Read the current scope_label so we can append the reconciliation note
  // without losing the original cost summary.
  const { data: existing, error: readErr } = await sb
    .from("observation_runs")
    .select("scope_label")
    .eq("tenant_id", args.tenantId)
    .eq("run_id", args.runId)
    .maybeSingle();
  if (readErr) {
    throw new Error(
      `[markRunPersistenceFailed] read failed for run_id=${args.runId}: ${readErr.message ?? String(readErr)}`,
    );
  }
  const baseLabel = existing?.scope_label ?? "";
  const reconciliationNote = ` · PERSISTENCE FAILED: ${args.reasons.join("; ")}`;
  const newScopeLabel = baseLabel.includes("PERSISTENCE FAILED")
    ? baseLabel // already stamped — idempotent
    : baseLabel + reconciliationNote;

  const { error } = await sb
    .from("observation_runs")
    .update({
      status: "failed",
      scope_label: newScopeLabel,
    })
    .eq("tenant_id", args.tenantId)
    .eq("run_id", args.runId);
  if (error) {
    throw new Error(
      `[markRunPersistenceFailed] update failed for run_id=${args.runId}: ${error.message ?? String(error)}`,
    );
  }
}

// ── Auto-disable on prior persistence failure (R6) ───────────────────

export type PersistenceGateVerdict = {
  /** True when the next paid run should be ALLOWED to fire. */
  readonly allow: boolean;
  /** Operator-readable reason for blocking. Empty when allow:true. */
  readonly reason: string;
  /** Most-recent failed run's run_id, if any. Null when allow:true. */
  readonly blockedByRunId: string | null;
};

/**
 * Operator R6: gate the next paid run when the LATEST run on this
 * (tenant, source) had a persistence failure. The gate is cleared by
 * EITHER:
 *   • a successful canary run that touched the same source, OR
 *   • the operator manually flipping the failed run row's
 *     scope_label to remove the "PERSISTENCE FAILED" marker.
 *
 * Both clear paths are operator-friendly: a green canary at 07:45 UTC
 * resumes the next morning's normal cron; manual ack lets the operator
 * resume earlier.
 *
 * Read-only: SELECT only.
 */
export async function checkPersistenceGate(args: {
  readonly tenantId: string;
  readonly source: string;
}): Promise<PersistenceGateVerdict> {
  const sb = getSupabaseAdmin();
  // Latest run on this source (any status).
  const { data: latest, error } = await sb
    .from("observation_runs")
    .select("run_id, status, scope_label, started_at")
    .eq("tenant_id", args.tenantId)
    .eq("source", args.source)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Defensive: fail SAFE (allow). A read failure shouldn't paralyze
    // production. The reconciliation step downstream will still catch
    // a real persistence failure.
    return {
      allow: true,
      reason: `gate-read-failed: ${error.message ?? String(error)}`,
      blockedByRunId: null,
    };
  }
  if (!latest) {
    // No prior runs → not blocked.
    return { allow: true, reason: "", blockedByRunId: null };
  }
  const isPersistenceFailure =
    latest.status === "failed" &&
    typeof latest.scope_label === "string" &&
    latest.scope_label.includes("PERSISTENCE FAILED");
  if (!isPersistenceFailure) {
    return { allow: true, reason: "", blockedByRunId: null };
  }
  return {
    allow: false,
    reason: `Last ${args.source} run (${latest.run_id}) failed persistence. Run a successful canary or manually clear the failure marker on the run row to resume paid polling.`,
    blockedByRunId: latest.run_id,
  };
}
