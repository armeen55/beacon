/**
 * run-scheduled-generation — P0 wall 1 (2026-06-10): the queue refills
 * while you sleep.
 *
 * Nightly per-tenant recommendation generation: trigger candidates →
 * safety gates → score → dedupe/cooldowns → promote into the
 * recommendation queue (`recommended_edits`, status "recommended").
 * Invoked per tenant by .github/workflows/nightly-generation.yml
 * (matrix from scripts/list-active-tenants.ts — same fleet as scan/poll),
 * AFTER the 04:00 UTC scan (fresh snapshots) and BEFORE the 07:00 UTC
 * poll. Promotion is DETERMINISTIC — no LLM, no paid API calls.
 *
 * Safety:
 *   • Writes are queue-only. NOTHING here publishes — pushes still
 *     require the operator's explicit approve click. (Master-goal
 *     invariant untouched.)
 *   • Honors the SAME env gate as the operator surface:
 *     BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true" → live write;
 *     anything else → dry-run REPORT mode (computes + logs what would
 *     land, writes nothing). The workflow sets it explicitly so the
 *     mode is visible in the job env, never implicit.
 *   • BEACON_GENERATION_DISABLED kill switch (same contract as
 *     BEACON_SCAN_DISABLED): truthy → exit 0 no-op, loudly.
 *   • Idempotent re-runs: rec ids are deterministic; the local persist
 *     upserts by id and the Supabase dual-write upserts on
 *     (tenant_id, rec_id, action_type, target_element_key).
 *   • Per-run caps live in the promotion engine itself (max 5 rows per
 *     page, 10 per trigger family, 13-gate safety ladder + cooldowns).
 *
 * Exit codes: 0 = completed (including dry-run + kill-switch no-op);
 * 1 = generation threw or env was invalid (workflow alerts on failure).
 */

export type GenerationMode = {
  dryRun: boolean;
  reason:
    | "live_write_enabled"
    | "live_write_disabled_report_only";
};

/**
 * Pure mode resolution (exported for tests). STRICT match mirrors
 * isPromotionLiveWriteEnabled(): only the exact string "true" enables
 * live writes; everything else (unset, "1", "True", "yes") is a
 * dry-run report. Deliberately the same semantics as the operator
 * surface so an env value means ONE thing everywhere.
 */
export function resolveGenerationMode(env: NodeJS.ProcessEnv): GenerationMode {
  if (env.BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true") {
    return { dryRun: false, reason: "live_write_enabled" };
  }
  return { dryRun: true, reason: "live_write_disabled_report_only" };
}

/** Kill-switch parse — same truthy set as BEACON_SCAN_DISABLED. */
export function isGenerationDisabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.BEACON_GENERATION_DISABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function main() {
  const startedAt = Date.now();
  const env = process.env;

  if (isGenerationDisabled(env)) {
    console.warn(
      "[scheduled-generation] BEACON_GENERATION_DISABLED is set — exiting 0 without generating",
    );
    process.exit(0);
  }

  const tenantId = env.BEACON_TENANT_ID?.trim();
  const tenantSlug = env.BEACON_TENANT_SLUG?.trim();
  if (!tenantId) {
    console.error("[scheduled-generation] BEACON_TENANT_ID is required");
    process.exit(1);
  }
  if (!tenantSlug) {
    console.error(
      "[scheduled-generation] BEACON_TENANT_SLUG is required for tenant-routed queue writes",
    );
    process.exit(1);
  }

  const mode = resolveGenerationMode(env);
  console.log("[scheduled-generation] starting promoteEligibleCandidates", {
    tenantId,
    tenantSlug,
    mode: mode.reason,
    dryRun: mode.dryRun,
    DATA_SOURCE: env.DATA_SOURCE ?? "(unset)",
    DUAL_WRITE: env.DUAL_WRITE ?? "(unset)",
  });

  // Lazy import — env must be set before tenant context resolves.
  const { promoteEligibleCandidates } = await import(
    "../src/domains/recommendation-intelligence/promotion-writer"
  );

  try {
    const result = await promoteEligibleCandidates({
      tenantId,
      dryRun: mode.dryRun,
    });
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[scheduled-generation] DONE tenant=${tenantId} dryRun=${result.dryRun} ` +
        `candidates=${result.candidate_count} eligible=${result.eligible_count} ` +
        `promoted=${result.promoted_count} skipped=${result.skipped_count} ` +
        `elapsedMs=${elapsedMs}`,
    );
    if (result.sync_warning) {
      // Dual-write degraded — the local write landed but Supabase didn't.
      // Loud (workflow log + ::warning) but not fatal: the runner's local
      // FS is ephemeral, so a sync warning in CI means the night's rows
      // did NOT persist — surface it as a job failure instead.
      console.error(
        `::error::[scheduled-generation] Supabase sync failed — promoted rows did not persist durably: ${result.sync_warning}`,
      );
      process.exit(1);
    }
    if (mode.dryRun && result.eligible_count > 0) {
      console.log(
        `[scheduled-generation] REPORT-ONLY: ${result.eligible_count} eligible row(s) NOT written ` +
          `(set BEACON_PROMOTION_LIVE_WRITE_ENABLED=true to refill the queue nightly)`,
      );
    }
    // Queue hygiene (#114/#49, 2026-06-11): expire stale auto-promoted
    // cards (TTL + per-tenant cap) AFTER tonight's promotion, live mode
    // only. A sweep failure is loud but not fatal — the night's
    // promotion already landed; the sweep retries tomorrow.
    if (!mode.dryRun) {
      try {
        const { sweepQueueForTenant } = await import(
          "../src/domains/recommendations/queue-sweeper"
        );
        const sweep = await sweepQueueForTenant(tenantId);
        console.log(
          `[scheduled-generation] SWEEP tenant=${tenantId} expiredTtl=${sweep.expiredTtl} ` +
            `expiredOverflow=${sweep.expiredOverflow} pendingAfter=${sweep.pendingAfter}` +
            (sweep.sync_warning ? ` sync_warning=${sweep.sync_warning.slice(0, 120)}` : ""),
        );
      } catch (err) {
        console.error(
          `::warning::[scheduled-generation] queue sweep failed (promotion already landed): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(
      `::error::[scheduled-generation] generation failed for ${tenantId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exit(1);
  }
}

// CLI guard (same pattern as list-active-tenants.ts) so tests can import
// the pure helpers without running a generation.
const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /(?:^|\/)run-scheduled-generation\.[cm]?[jt]s$/.test(process.argv[1]);

if (invokedAsCli) {
  main().catch((err) => {
    console.error(
      `::error::[scheduled-generation] crashed: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(1);
  });
}
